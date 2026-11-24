/**
 * DUALAI - Low-Latency Audio Ingestion Engine
 * Orchestrates dual-channel input (Local Mic + System Loopback),
 * AudioWorklet thread isolation, circular FIFO buffering,
 * and client-side Silero VAD v5 ONNX segmentation.
 */

import { ChannelId, AudioLevelMetric, VADEvent, LoopbackSourceStatus } from '../../../types/audio'
import { CircularAudioBuffer } from './CircularAudioBuffer'
import { PCM_PROCESSOR_CODE } from './PcmProcessorCode'
import { SileroVadEngine } from './vad/SileroVadEngine'

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
  private vadAccumulatorA: Int16Array = new Int16Array(480)
  private vadAccumulatorIndexA: number = 0

  // Channel B (System Loopback)
  private streamChannelB: MediaStream | null = null
  private displayVideoTracks: MediaStreamTrack[] = []
  private sourceNodeB: MediaStreamAudioSourceNode | null = null
  private gainNodeB: GainNode | null = null
  private workletNodeB: AudioWorkletNode | null = null
  private bufferChannelB: CircularAudioBuffer = new CircularAudioBuffer(16000)
  private vadAccumulatorB: Int16Array = new Int16Array(480)
  private vadAccumulatorIndexB: number = 0
  private loopbackStatus: LoopbackSourceStatus = 'inactive'

  // VAD Engine
  private vadEngine: SileroVadEngine | null = null

  // Cough Mute & Calibration Monitor State
  private isCoughMuted: boolean = false
  private activeGainA: number = 1.0
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
      navigator.mediaDevices.addEventListener('devicechange', (event) => {
        if (this.callbacks.onDeviceDisconnected) {
          this.callbacks.onDeviceDisconnected(event)
        }
      })
    }
  }

  private async ensureAudioContext(): Promise<AudioContext> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.audioContext = new AudioCtx({
        sampleRate: 16000,
        latencyHint: 'interactive'
      })
      this.workletLoaded = false
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }

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
          // Keep minimal video tracks disabled while session runs so macOS ScreenCaptureKit
          // does not prematurely terminate the linked audio stream; released cleanly in stop().
          videoTracks.forEach((track) => {
            track.enabled = false
          })
          this.displayVideoTracks = videoTracks
          this.setLoopbackStatus('native_loopback', 'Native OS system audio loopback active')
          return new MediaStream(audioTracks)
        }

        // No live audio track returned (e.g. OS Screen & System Audio Recording permission denied)
        displayStream.getTracks().forEach((track) => track.stop())
        this.setLoopbackStatus(
          'unavailable',
          'System audio loopback unavailable. Grant Screen & System Audio Recording permission in macOS System Settings or select a virtual loopback device (e.g. BlackHole) in Settings -> Audio.'
        )
        return null
      } catch (displayErr) {
        const message =
          displayErr instanceof Error ? displayErr.message : 'Display media capture rejected'
        console.warn('[DUALAI] Native OS loopback capture unavailable:', displayErr)
        this.setLoopbackStatus(
          'unavailable',
          `System audio loopback unavailable (${message}). Verify macOS Screen & System Audio Recording permission or select a virtual loopback device in Settings -> Audio.`
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
    captureChannelA?: boolean
    captureChannelB?: boolean
  }): Promise<void> {
    if (this.isRunning) return

    const captureA = options.captureChannelA ?? true
    const captureB = options.captureChannelB ?? true

    try {
      this.activeGainA = options.gainA
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

      // 1. Channel A: Local Microphone Capture (only when routed)
      if (captureA) {
        const audioConstraints: MediaTrackConstraints = {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: options.echoCancellation,
          noiseSuppression: options.noiseSuppression,
          autoGainControl: false
        }
        if (options.deviceIdA && options.deviceIdA !== 'default') {
          audioConstraints.deviceId = { exact: options.deviceIdA }
        }

        this.streamChannelA = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: false
        })

        this.sourceNodeA = ctx.createMediaStreamSource(this.streamChannelA)
        this.gainNodeA = ctx.createGain()
        this.gainNodeA.gain.value = this.isCoughMuted ? 0.0 : options.gainA

        this.workletNodeA = new AudioWorkletNode(ctx, 'pcm-processor', {
          processorOptions: { channelId: 'channel_a' }
        })

        if (this.isCoughMuted) {
          this.workletNodeA.port.postMessage({ type: 'set-mute', muted: true })
        }

        this.workletNodeA.port.onmessage = (event) => {
          const { channelId, pcmData, rmsDb, peakDb, isClipping, timestampMs } = event.data
          const samples = new Int16Array(pcmData)

          if (!this.isCoughMuted) {
            this.bufferChannelA.write(samples)
          }

          this.callbacks.onLevelMetric({
            channelId,
            rmsDb: this.isCoughMuted ? -60 : rmsDb,
            peakDb: this.isCoughMuted ? -60 : peakDb,
            isClipping: this.isCoughMuted ? false : isClipping,
            timestampMs
          })

          this.callbacks.onPcmChunk(channelId, samples)

          if (this.isCoughMuted) {
            return
          }

          // Feed into 30ms (480-sample) accumulator for Silero VAD
          for (let i = 0; i < samples.length; i++) {
            this.vadAccumulatorA[this.vadAccumulatorIndexA++] = samples[i]
            if (this.vadAccumulatorIndexA >= 480) {
              this.vadEngine?.processPcmFrame('channel_a', this.vadAccumulatorA, timestampMs)
              this.vadAccumulatorIndexA = 0
            }
          }
        }

        this.sourceNodeA.connect(this.gainNodeA)
        this.gainNodeA.connect(this.workletNodeA)
      }

      // 2. Channel B: Native System Audio Loopback / Virtual Loopback Device (only when routed)
      if (captureB) {
        this.streamChannelB = await this.acquireChannelBStream(options.deviceIdB)

        if (!this.streamChannelB && !captureA) {
          throw new Error(
            'Unable to capture System Audio Loopback. Check macOS Screen & System Audio Recording permission or configure a virtual loopback device (BlackHole) in Settings -> Audio.'
          )
        }
      } else {
        this.setLoopbackStatus('inactive')
      }

      if (this.streamChannelB) {
        this.sourceNodeB = ctx.createMediaStreamSource(this.streamChannelB)
        this.gainNodeB = ctx.createGain()
        this.gainNodeB.gain.value = options.gainB

        this.workletNodeB = new AudioWorkletNode(ctx, 'pcm-processor', {
          processorOptions: { channelId: 'channel_b' }
        })

        this.workletNodeB.port.onmessage = (event) => {
          const { channelId, pcmData, rmsDb, peakDb, isClipping, timestampMs } = event.data
          const samples = new Int16Array(pcmData)
          this.bufferChannelB.write(samples)

          this.callbacks.onLevelMetric({
            channelId,
            rmsDb,
            peakDb,
            isClipping,
            timestampMs
          })

          this.callbacks.onPcmChunk(channelId, samples)

          // Feed into 30ms (480-sample) accumulator for Silero VAD
          for (let i = 0; i < samples.length; i++) {
            this.vadAccumulatorB[this.vadAccumulatorIndexB++] = samples[i]
            if (this.vadAccumulatorIndexB >= 480) {
              this.vadEngine?.processPcmFrame('channel_b', this.vadAccumulatorB, timestampMs)
              this.vadAccumulatorIndexB = 0
            }
          }
        }

        this.sourceNodeB.connect(this.gainNodeB)
        this.gainNodeB.connect(this.workletNodeB)
      }

      this.isRunning = true
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
    }
    if (!this.audioContext) return

    const now = this.audioContext.currentTime
    if (channelId === 'channel_a' && this.gainNodeA) {
      if (!this.isCoughMuted) {
        this.gainNodeA.gain.setTargetAtTime(clampedGain, now, 0.03)
      }
    } else if (channelId === 'channel_b' && this.gainNodeB) {
      this.gainNodeB.gain.setTargetAtTime(clampedGain, now, 0.03)
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
   * Toggle live hardware microphone monitor loopback during Settings calibration
   */
  public setMonitorLoopback(enabled: boolean): void {
    this.isMonitorLoopbackActive = enabled
    if (!this.audioContext || !this.gainNodeA) return

    if (enabled) {
      if (!this.monitorGainNode) {
        this.monitorGainNode = this.audioContext.createGain()
        this.monitorGainNode.gain.value = 0.65
      }
      try {
        this.gainNodeA.connect(this.monitorGainNode)
        this.monitorGainNode.connect(this.audioContext.destination)
      } catch {
        // Already connected
      }
    } else if (this.monitorGainNode) {
      try {
        this.gainNodeA.disconnect(this.monitorGainNode)
        this.monitorGainNode.disconnect()
      } catch {
        // Ignore if not connected
      }
      this.monitorGainNode = null
    }
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
   * Stop audio ingestion and cleanly release hardware resources
   */
  public stop(): void {
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
      this.workletNodeB.disconnect()
      this.workletNodeB = null
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
