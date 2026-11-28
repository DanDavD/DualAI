/**
 * DUALAI - Low-Latency Audio Ingestion Engine
 * Orchestrates dual-channel input (Local Mic + System Loopback),
 * AudioWorklet thread isolation, circular FIFO buffering,
 * and client-side Silero VAD v5 ONNX segmentation.
 */

import { ChannelId, AudioLevelMetric, VADEvent, LoopbackSourceStatus } from '../../../types/audio'
import { CircularAudioBuffer } from './CircularAudioBuffer'
import { PCM_PROCESSOR_CODE } from './PcmProcessorCode'
import { downsampleInt16Pcm, TARGET_STREAM_SAMPLE_RATE } from './pcmDownsampler'
import { SileroVadEngine } from './vad/SileroVadEngine'
import { isWindows } from '../utils/platform'

export interface AudioEngineCallbacks {
  onLevelMetric: (metric: AudioLevelMetric) => void
  onPcmChunk: (channelId: ChannelId, pcmData: Int16Array) => void
  onVadTelemetry?: (
    channelId: ChannelId,
    probability: number,
    isSpeech: boolean,
    inferenceLatencyMs: number
  ) => void
  onSpeechStart?: (event: VADEvent, preSpeechPcm: Int16Array) => void
  onSpeechFrame?: (channelId: ChannelId, pcmData: Int16Array, probability: number) => void
  onSpeechEnd?: (event: VADEvent) => void
  onVadStatusChange?: (status: 'initializing' | 'ready' | 'error', error?: string) => void
  onLoopbackStatusChange?: (status: LoopbackSourceStatus, detail?: string) => void
  onDeviceDisconnected?: (event: Event) => void
  onError?: (err: Error) => void
}

export class AudioIngestionEngine {
  private audioContext: AudioContext | null = null
  private workletLoaded: boolean = false

  // Channel A (Local Mic)
  private streamChannelA: MediaStream | null = null
  private sourceNodeA: MediaStreamAudioSourceNode | null = null
  private gainNodeA: GainNode | null = null
  private workletNodeA: AudioWorkletNode | null = null
  private bufferChannelA: CircularAudioBuffer = new CircularAudioBuffer(16000)
  private vadAccumulatorA: Int16Array = new Int16Array(512)
  private vadAccumulatorIndexA: number = 0

  // Channel B (System Loopback)
  private streamChannelB: MediaStream | null = null
  private displayVideoTracks: MediaStreamTrack[] = []
  private sourceNodeB: MediaStreamAudioSourceNode | null = null
  private gainNodeB: GainNode | null = null
  private workletNodeB: AudioWorkletNode | null = null
  private bufferChannelB: CircularAudioBuffer = new CircularAudioBuffer(16000)
  private vadAccumulatorB: Int16Array = new Int16Array(512)
  private vadAccumulatorIndexB: number = 0
  private loopbackStatus: LoopbackSourceStatus = 'inactive'

  // VAD Engine
  private vadEngine: SileroVadEngine | null = null

  // Local-Only Self-Voice Echo Blocker (measures ONLY local mic RMS energy via AnalyserNode;
  // ZERO microphone PCM bytes are ever captured, sent to VAD, or transmitted to Soniox)
  private echoBlockerEnabled: boolean = false
  private echoMonitorStream: MediaStream | null = null
  private echoMonitorSource: MediaStreamAudioSourceNode | null = null
  private echoMonitorAnalyser: AnalyserNode | null = null
  private echoMonitorTimer: ReturnType<typeof setInterval> | null = null
  private echoMonitorBuffer: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(512 * 4))
  private echoMicNoiseFloorRms: number = 0.0025
  private echoVoiceStreak: number = 0
  private lastLocalVoiceAtMs: number = 0
  private echoMonitorGeneration: number = 0
  private readonly echoTailHoldMs: number = 500
  private boundDeviceChangeHandler: ((event: Event) => void) | null = null

  // Cough Mute, System Audio Mute & Output Sink State
  private isCoughMuted: boolean = false
  private isSystemAudioMuted: boolean = false
  private activeGainA: number = 1.0
  private activeGainB: number = 1.0
  private outputDeviceId: string = 'default'
  private isMonitorLoopbackActive: boolean = false
  private monitorGainNode: GainNode | null = null

  private isRunning: boolean = false
  private callbacks: AudioEngineCallbacks

  constructor(callbacks: AudioEngineCallbacks) {
    this.callbacks = callbacks
    this.setupDeviceChangeDetection()
  }

  private setupDeviceChangeDetection(): void {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      this.boundDeviceChangeHandler = (event: Event) => {
        if (this.callbacks.onDeviceDisconnected) {
          this.callbacks.onDeviceDisconnected(event)
        }
      }
      navigator.mediaDevices.addEventListener('devicechange', this.boundDeviceChangeHandler)
    }
  }

  public dispose(): void {
    this.stop()
    if (
      this.boundDeviceChangeHandler &&
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices
    ) {
      navigator.mediaDevices.removeEventListener('devicechange', this.boundDeviceChangeHandler)
      this.boundDeviceChangeHandler = null
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close().catch(() => undefined)
      this.audioContext = null
      this.workletLoaded = false
    }
  }

  private async ensureAudioContext(): Promise<AudioContext> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      // On Windows WASAPI shared mode, omit forced 16kHz sampleRate to prevent setSinkId/resampler glitches;
      // downstream AudioWorklet + downsampleInt16Pcm already converts native 48kHz/44.1kHz -> 16kHz cleanly.
      this.audioContext = new AudioCtx(
        isWindows
          ? { latencyHint: 'interactive' }
          : { sampleRate: 16000, latencyHint: 'interactive' }
      )
      this.workletLoaded = false
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }

    await this.applyOutputSinkId(this.audioContext, this.outputDeviceId)

    if (!this.workletLoaded) {
      const blob = new Blob([PCM_PROCESSOR_CODE], { type: 'application/javascript' })
      const blobUrl = URL.createObjectURL(blob)
      await this.audioContext.audioWorklet.addModule(blobUrl)
      URL.revokeObjectURL(blobUrl)
      this.workletLoaded = true
    }

    return this.audioContext
  }

  private setLoopbackStatus(status: LoopbackSourceStatus, detail?: string): void {
    this.loopbackStatus = status
    this.callbacks.onLoopbackStatusChange?.(status, detail)
  }

  /**
   * Acquire Channel B (System Loopback / Remote Audio).
   * Priority 1: Explicitly selected virtual loopback input device (e.g. BlackHole / VB-Cable).
   * Priority 2: Native Electron 45 OS Loopback via getDisplayMedia + setDisplayMediaRequestHandler.
   */
  private async acquireChannelBStream(deviceIdB?: string): Promise<MediaStream | null> {
    if (deviceIdB && deviceIdB !== 'system_loopback' && deviceIdB !== 'default') {
      try {
        const virtualStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            deviceId: { exact: deviceIdB }
          },
          video: false
        })
        this.setLoopbackStatus('virtual_device', 'Dedicated loopback audio device active')
        return virtualStream
      } catch (devErr) {
        console.warn('[DUALAI] Selected Channel B device unavailable, attempting native OS loopback:', devErr)
      }
    }

    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getDisplayMedia) {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 16 },
            height: { ideal: 16 },
            frameRate: { ideal: 1 }
          },
          audio: true
        })

        const audioTracks = displayStream.getAudioTracks()
        const videoTracks = displayStream.getVideoTracks()

        if (audioTracks.length > 0 && audioTracks[0].readyState === 'live') {
          if (isWindows) {
            // On Windows 10/11, WASAPI loopback audio is independent of the WGC video track.
            // Stop videoTracks immediately to remove the bright yellow WGC screen-capture border.
            videoTracks.forEach((track) => track.stop())
            this.displayVideoTracks = []
          } else {
            // Keep minimal video tracks disabled while session runs so macOS ScreenCaptureKit
            // does not prematurely terminate the linked audio stream; released cleanly in stop().
            videoTracks.forEach((track) => {
              track.enabled = false
            })
            this.displayVideoTracks = videoTracks
          }
          this.setLoopbackStatus('native_loopback', 'Native OS system audio loopback active')
          return new MediaStream(audioTracks)
        }

        // No live audio track returned
        displayStream.getTracks().forEach((track) => track.stop())
        this.setLoopbackStatus(
          'unavailable',
          isWindows
            ? 'System audio loopback unavailable. Verify your Windows playback device is active or select a virtual loopback device (e.g. VB-Cable or Stereo Mix) in Settings -> Audio.'
            : 'System audio loopback unavailable. Grant Screen & System Audio Recording permission in macOS System Settings or select a virtual loopback device (e.g. BlackHole) in Settings -> Audio.'
        )
        return null
      } catch (displayErr) {
        const message =
          displayErr instanceof Error ? displayErr.message : 'Display media capture rejected'
        console.warn('[DUALAI] Native OS loopback capture unavailable:', displayErr)
        this.setLoopbackStatus(
          'unavailable',
          isWindows
            ? `System audio loopback unavailable (${message}). Check Windows Sound Settings or select a virtual loopback device (e.g. VB-Cable) in Settings -> Audio.`
            : `System audio loopback unavailable (${message}). Verify macOS Screen & System Audio Recording permission or select a virtual loopback device in Settings -> Audio.`
        )
        return null
      }
    }

    this.setLoopbackStatus(
      'unavailable',
      'System audio loopback API unavailable in this runtime. Select a virtual loopback device in Settings -> Audio.'
    )
    return null
  }

  /**
   * Start dual-channel or routed ingestion (Channel A Mic and/or Channel B System Loopback) + Silero VAD
   */
  public async start(options: {
    noiseSuppression: boolean
    echoCancellation: boolean
    gainA: number
    gainB: number
    deviceIdA?: string
    deviceIdB?: string
    outputDeviceId?: string
    captureChannelA?: boolean
    captureChannelB?: boolean
  }): Promise<void> {
    if (this.isRunning) return

    // Listen-only architecture: DualAI NEVER captures, detects, or streams local microphone audio.
    // Only Channel B (System Audio / Call Loopback) is ingested for AI interpretation.
    const captureB = options.captureChannelB ?? true
    this.echoBlockerEnabled = false

    try {
      this.activeGainA = options.gainA
      this.activeGainB = options.gainB
      if (options.outputDeviceId) {
        this.outputDeviceId = options.outputDeviceId
      }
      const ctx = await this.ensureAudioContext()

      // Initialize Silero VAD v5 ONNX Engine
      if (!this.vadEngine) {
        this.vadEngine = new SileroVadEngine({
          onSpeechStart: (event, preSpeechPcm) => {
            if (event.channelId === 'channel_a' && this.isCoughMuted) return
            this.callbacks.onSpeechStart?.(event, preSpeechPcm)
          },
          onSpeechFrame: (channelId, pcmData, prob) => {
            if (channelId === 'channel_a' && this.isCoughMuted) return
            this.callbacks.onSpeechFrame?.(channelId, pcmData, prob)
          },
          onSpeechEnd: (event) => {
            this.callbacks.onSpeechEnd?.(event)
          },
          onVadTelemetry: (channelId, prob, isSpeech, latencyMs) => {
            this.callbacks.onVadTelemetry?.(channelId, prob, isSpeech, latencyMs)
          },
          onStatusChange: (status, error) => {
            this.callbacks.onVadStatusChange?.(status, error)
          }
        })
      }
      await this.vadEngine.start()

      // Channel B: Native System Audio Loopback / Virtual Loopback Device (listen-only)
      if (captureB) {
        this.streamChannelB = await this.acquireChannelBStream(options.deviceIdB)

        if (!this.streamChannelB) {
          throw new Error(
            isWindows
              ? 'Unable to capture System Audio Loopback. Verify your Windows playback device is active or configure a virtual loopback device (VB-Cable / Stereo Mix) in Settings -> Audio.'
              : 'Unable to capture System Audio Loopback. Check macOS Screen & System Audio Recording permission or configure a virtual loopback device (BlackHole) in Settings -> Audio.'
          )
        }
      } else {
        this.setLoopbackStatus('inactive')
      }

      if (this.streamChannelB) {
        this.sourceNodeB = ctx.createMediaStreamSource(this.streamChannelB)
        this.gainNodeB = ctx.createGain()
        this.gainNodeB.gain.value = this.isSystemAudioMuted ? 0.0 : options.gainB

        this.workletNodeB = new AudioWorkletNode(ctx, 'pcm-processor', {
          processorOptions: { channelId: 'channel_b' }
        })

        if (this.isSystemAudioMuted) {
          this.workletNodeB.port.postMessage({ type: 'set-mute', muted: true })
        }

        this.workletNodeB.port.onmessage = (event) => {
          const { channelId, pcmData, rmsDb, peakDb, isClipping, timestampMs } = event.data
          const samples = new Int16Array(pcmData)

          if (!this.isSystemAudioMuted) {
            this.bufferChannelB.write(samples)
          }

          this.callbacks.onLevelMetric({
            channelId,
            rmsDb: this.isSystemAudioMuted ? -60 : rmsDb,
            peakDb: this.isSystemAudioMuted ? -60 : peakDb,
            isClipping: this.isSystemAudioMuted ? false : isClipping,
            timestampMs
          })

          this.callbacks.onPcmChunk(channelId, samples)

          if (this.isSystemAudioMuted) {
            return
          }

          // Feed true 16kHz 512-sample (32ms) frames natively into Silero VAD v5
          const vadPcmB =
            ctx.sampleRate > TARGET_STREAM_SAMPLE_RATE
              ? downsampleInt16Pcm(samples, ctx.sampleRate, TARGET_STREAM_SAMPLE_RATE)
              : samples
          for (let i = 0; i < vadPcmB.length; i++) {
            this.vadAccumulatorB[this.vadAccumulatorIndexB++] = vadPcmB[i]
            if (this.vadAccumulatorIndexB >= 512) {
              this.vadEngine?.processPcmFrame('channel_b', this.vadAccumulatorB, timestampMs)
              this.vadAccumulatorIndexB = 0
            }
          }
        }

        this.sourceNodeB.connect(this.gainNodeB)
        this.gainNodeB.connect(this.workletNodeB)
      }

      this.isRunning = true

      // Start Local-Only Self-Voice Echo Monitor strictly AFTER isRunning = true so async
      // getUserMedia never aborts against a not-yet-running flag while getDisplayMedia resolves.
      if (this.echoBlockerEnabled) {
        void this.startSelfVoiceEchoMonitor(ctx)
      }
    } catch (err) {
      this.stop()
      if (this.callbacks.onError) {
        this.callbacks.onError(err as Error)
      }
      throw err
    }
  }

  /**
   * Set hardware gain multipliers with smooth linear ramps (prevents audible clicks)
   */
  public setGain(channelId: ChannelId, gainMultiplier: number): void {
    const clampedGain = Math.max(0.0, Math.min(2.0, gainMultiplier))
    if (channelId === 'channel_a') {
      this.activeGainA = clampedGain
    } else {
      this.activeGainB = clampedGain
    }
    if (!this.audioContext) return

    const now = this.audioContext.currentTime
    if (channelId === 'channel_a' && this.gainNodeA) {
      if (!this.isCoughMuted) {
        this.gainNodeA.gain.setTargetAtTime(clampedGain, now, 0.03)
      }
    } else if (channelId === 'channel_b' && this.gainNodeB) {
      if (!this.isSystemAudioMuted) {
        this.gainNodeB.gain.setTargetAtTime(clampedGain, now, 0.03)
      }
    }
  }

  /**
   * Instantaneous mute toggle for Channel B (System / Headphones incoming audio capture).
   */
  public setSystemAudioMuted(muted: boolean): void {
    this.isSystemAudioMuted = muted

    if (this.workletNodeB) {
      this.workletNodeB.port.postMessage({ type: 'set-mute', muted })
    }

    if (this.audioContext && this.gainNodeB) {
      const now = this.audioContext.currentTime
      this.gainNodeB.gain.cancelScheduledValues(now)
      this.gainNodeB.gain.setValueAtTime(muted ? 0.0 : this.activeGainB, now)
    }

    if (muted) {
      this.vadAccumulatorIndexB = 0
      this.bufferChannelB.clear()
    }
  }

  /**
   * Local microphone capture is disabled in listen-only mode (no-op).
   */
  public async switchInputDevice(
    _deviceId: string,
    _options: { noiseSuppression: boolean; echoCancellation: boolean }
  ): Promise<void> {
    return
  }

  private async applyOutputSinkId(ctx: AudioContext, deviceId: string): Promise<void> {
    const sinkable = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
    if (typeof sinkable.setSinkId !== 'function') return
    try {
      await sinkable.setSinkId(!deviceId || deviceId === 'default' ? '' : deviceId)
    } catch (err) {
      console.warn('[DUALAI-AUDIO] Unable to switch audio output sink:', err)
      // Recover cleanly on Windows if a previously selected USB/Bluetooth headset was unplugged
      if (deviceId && deviceId !== 'default') {
        this.outputDeviceId = 'default'
        try {
          await sinkable.setSinkId('')
        } catch {
          // Ignore fallback failure
        }
      }
    }
  }

  /**
   * Switch the active audio output sink (headphones / speakers) immediately.
   */
  public async setOutputDevice(deviceId: string): Promise<void> {
    this.outputDeviceId = deviceId || 'default'
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.applyOutputSinkId(this.audioContext, this.outputDeviceId)
    }
  }

  /**
   * Instantaneous Zero-Gain Cough Mute (Day 09 DoD):
   * Cuts microphone input within 1 audio render quantum (128 samples / 8ms, 0ms audible bleed),
   * zeroes the WebAudio GainNode immediately, and flushes pending VAD buffers.
   */
  public setCoughMute(muted: boolean): void {
    this.isCoughMuted = muted

    if (this.workletNodeA) {
      this.workletNodeA.port.postMessage({ type: 'set-mute', muted })
    }

    if (this.audioContext && this.gainNodeA) {
      const now = this.audioContext.currentTime
      this.gainNodeA.gain.cancelScheduledValues(now)
      this.gainNodeA.gain.setValueAtTime(muted ? 0.0 : this.activeGainA, now)
    }

    if (muted) {
      // Flush pending pre-buffer samples immediately so zero cough audio leaks to VAD/STT
      this.vadAccumulatorIndexA = 0
      this.bufferChannelA.clear()
    }
  }

  public getIsCoughMuted(): boolean {
    return this.isCoughMuted
  }

  public getIsSystemAudioMuted(): boolean {
    return this.isSystemAudioMuted
  }

  /**
   * Audible Hardware Calibration Monitor Feedback (Day 11 DoD):
   * Plays a brief, smooth 440Hz reference tone scaled safely by the calibration gain slider.
   */
  public async playCalibrationTone(gainMultiplier: number): Promise<void> {
    try {
      const ctx = await this.ensureAudioContext()
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const envGain = ctx.createGain()

      const clampedGain = Math.max(0.02, Math.min(2.0, gainMultiplier))
      // Safe studio reference level (max 0.25 amplitude) scaled linearly by calibration slider
      const targetPeak = Math.min(0.28, clampedGain * 0.14)

      osc.type = 'sine'
      osc.frequency.setValueAtTime(440, now)

      envGain.gain.setValueAtTime(0.0001, now)
      envGain.gain.linearRampToValueAtTime(targetPeak, now + 0.015)
      envGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)

      osc.connect(envGain)
      envGain.connect(ctx.destination)

      osc.start(now)
      osc.stop(now + 0.17)
      osc.onended = () => {
        osc.disconnect()
        envGain.disconnect()
      }
    } catch (err) {
      console.warn('[DUALAI-AUDIO] Calibration test tone error:', err)
    }
  }

  /**
   * Local microphone monitoring is disabled in listen-only mode (no-op).
   */
  public setMonitorLoopback(_enabled: boolean): void {
    this.isMonitorLoopbackActive = false
  }

  public getIsMonitorLoopbackActive(): boolean {
    return this.isMonitorLoopbackActive
  }

  /**
   * Update VAD speech detection threshold and parameters
   */
  public setVadThreshold(threshold: number): void {
    this.vadEngine?.updateConfig({ threshold })
  }

  /**
   * Read 30ms audio frame (480 samples at 16kHz) from circular buffer
   */
  public read30msFrame(channelId: ChannelId): Int16Array | null {
    const buffer = channelId === 'channel_a' ? this.bufferChannelA : this.bufferChannelB
    return buffer.read(480)
  }

  public getBufferStatus(channelId: ChannelId): { available: number; capacity: number } {
    const buffer = channelId === 'channel_a' ? this.bufferChannelA : this.bufferChannelB
    return {
      available: buffer.getAvailableSamples(),
      capacity: buffer.getCapacity()
    }
  }

  /**
   * Starts a 100% local RMS-only microphone energy detector (AnalyserNode) so DualAI knows
   * when the interpreter is actively speaking and suppresses return echo/sidetone from the call.
   * ZERO microphone audio samples are ever recorded, buffered as PCM, or sent to any server.
   */
  private async startSelfVoiceEchoMonitor(ctx: AudioContext): Promise<void> {
    this.stopSelfVoiceEchoMonitor()
    const myGeneration = this.echoMonitorGeneration
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false
        },
        video: false
      })
      if (!this.isRunning || !this.echoBlockerEnabled || this.echoMonitorGeneration !== myGeneration) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)

      this.echoMonitorStream = stream
      this.echoMonitorSource = source
      this.echoMonitorAnalyser = analyser
      this.echoMicNoiseFloorRms = 0.0025
      this.echoVoiceStreak = 0
      this.lastLocalVoiceAtMs = 0

      this.echoMonitorTimer = setInterval(() => {
        if (!this.echoMonitorAnalyser || !this.echoBlockerEnabled || this.isCoughMuted) {
          this.echoVoiceStreak = 0
          return
        }
        this.echoMonitorAnalyser.getFloatTimeDomainData(this.echoMonitorBuffer)
        let sumSq = 0
        for (let i = 0; i < this.echoMonitorBuffer.length; i++) {
          const s = this.echoMonitorBuffer[i]
          sumSq += s * s
        }
        const rms = Math.sqrt(sumSq / this.echoMonitorBuffer.length)
        const now = Date.now()
        const currentlyActive = now - this.lastLocalVoiceAtMs <= this.echoTailHoldMs
        const openFloor = Math.max(0.018, this.echoMicNoiseFloorRms * 4.5)
        const holdFloor = Math.max(0.010, this.echoMicNoiseFloorRms * 2.8)
        const threshold = currentlyActive ? holdFloor : openFloor

        if (rms >= threshold) {
          this.echoVoiceStreak++
          // Require 3 consecutive 20ms frames (60ms) so desk taps/breathing never trigger echo block
          if (currentlyActive || this.echoVoiceStreak >= 3) {
            this.lastLocalVoiceAtMs = now
          }
        } else {
          this.echoVoiceStreak = 0
          const alpha = rms < this.echoMicNoiseFloorRms ? 0.15 : 0.03
          const nextFloor = this.echoMicNoiseFloorRms * (1 - alpha) + rms * alpha
          this.echoMicNoiseFloorRms = Math.max(0.0008, Math.min(0.025, nextFloor))
        }
      }, 20)
    } catch {
      // Gracefully degrade if mic permission is denied; System Audio still works uninterrupted
    }
  }

  private stopSelfVoiceEchoMonitor(): void {
    this.echoMonitorGeneration++
    if (this.echoMonitorTimer) {
      clearInterval(this.echoMonitorTimer)
      this.echoMonitorTimer = null
    }
    if (this.echoMonitorSource) {
      try {
        this.echoMonitorSource.disconnect()
      } catch {
        // Ignore already disconnected
      }
      this.echoMonitorSource = null
    }
    this.echoMonitorAnalyser = null
    if (this.echoMonitorStream) {
      this.echoMonitorStream.getTracks().forEach((t) => t.stop())
      this.echoMonitorStream = null
    }
    this.echoVoiceStreak = 0
    this.lastLocalVoiceAtMs = 0
  }

  public setEchoBlockerEnabled(_enabled: boolean): void {
    this.echoBlockerEnabled = false
    this.stopSelfVoiceEchoMonitor()
  }

  public getIsLocalUserSpeaking(nowMs: number = Date.now()): boolean {
    if (!this.echoBlockerEnabled || this.isCoughMuted || this.lastLocalVoiceAtMs === 0) {
      return false
    }
    return nowMs - this.lastLocalVoiceAtMs <= this.echoTailHoldMs
  }

  /**
   * Stop audio ingestion and cleanly release hardware resources
   */
  public stop(): void {
    this.stopSelfVoiceEchoMonitor()
    if (this.streamChannelA) {
      this.streamChannelA.getTracks().forEach((track) => track.stop())
      this.streamChannelA = null
    }
    if (this.streamChannelB) {
      this.streamChannelB.getTracks().forEach((track) => track.stop())
      this.streamChannelB = null
    }
    if (this.displayVideoTracks.length > 0) {
      this.displayVideoTracks.forEach((track) => track.stop())
      this.displayVideoTracks = []
    }

    if (this.sourceNodeA) {
      this.sourceNodeA.disconnect()
      this.sourceNodeA = null
    }
    if (this.gainNodeA) {
      this.gainNodeA.disconnect()
      this.gainNodeA = null
    }
    if (this.workletNodeA) {
      this.workletNodeA.disconnect()
      this.workletNodeA = null
    }

    if (this.sourceNodeB) {
      this.sourceNodeB.disconnect()
      this.sourceNodeB = null
    }
    if (this.gainNodeB) {
      this.gainNodeB.disconnect()
      this.gainNodeB = null
    }
    if (this.workletNodeB) {
      this.workletNodeB.port.onmessage = null
      this.workletNodeB.port.close()
      this.workletNodeB.disconnect()
      this.workletNodeB = null
    }

    if (this.audioContext && this.audioContext.state === 'running') {
      void this.audioContext.suspend().catch(() => undefined)
    }

    if (this.monitorGainNode) {
      try {
        this.monitorGainNode.disconnect()
      } catch {
        // Ignore already disconnected
      }
      this.monitorGainNode = null
    }
    this.isMonitorLoopbackActive = false

    if (this.vadEngine) {
      this.vadEngine.stop()
      this.vadEngine = null
    }

    this.vadAccumulatorIndexA = 0
    this.vadAccumulatorIndexB = 0
    this.bufferChannelA.clear()
    this.bufferChannelB.clear()
    this.isRunning = false
    if (this.loopbackStatus !== 'unavailable') {
      this.setLoopbackStatus('inactive')
    }
  }

  public getIsRunning(): boolean {
    return this.isRunning
  }

  public getIsVadReady(): boolean {
    return this.vadEngine?.getIsReady() ?? false
  }

  public getLoopbackStatus(): LoopbackSourceStatus {
    return this.loopbackStatus
  }

  public getActualSampleRate(): number {
    return this.audioContext?.sampleRate || 16000
  }
}
