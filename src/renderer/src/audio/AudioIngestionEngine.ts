/**
 * DUALAI - Low-Latency Audio Ingestion Engine
 * Orchestrates dual-channel input (Local Mic + System Loopback),
 * AudioWorklet thread isolation, and circular FIFO frame buffering.
 */

import { ChannelId, AudioLevelMetric } from '../../../types/audio'
import { CircularAudioBuffer } from './CircularAudioBuffer'
import { PCM_PROCESSOR_CODE } from './PcmProcessorCode'

export interface AudioEngineCallbacks {
  onLevelMetric: (metric: AudioLevelMetric) => void
  onPcmChunk: (channelId: ChannelId, pcmData: Int16Array) => void
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

  // Channel B (System Loopback)
  private streamChannelB: MediaStream | null = null
  private sourceNodeB: MediaStreamAudioSourceNode | null = null
  private gainNodeB: GainNode | null = null
  private workletNodeB: AudioWorkletNode | null = null
  private bufferChannelB: CircularAudioBuffer = new CircularAudioBuffer(16000)

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

  /**
   * Start dual-channel ingestion (Channel A Mic + Channel B Loopback)
   */
  public async start(options: {
    noiseSuppression: boolean
    echoCancellation: boolean
    gainA: number
    gainB: number
  }): Promise<void> {
    if (this.isRunning) return

    try {
      const ctx = await this.ensureAudioContext()

      // 1. Channel A: Local Microphone Capture
      this.streamChannelA = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: options.echoCancellation,
          noiseSuppression: options.noiseSuppression,
          autoGainControl: false
        },
        video: false
      })

      this.sourceNodeA = ctx.createMediaStreamSource(this.streamChannelA)
      this.gainNodeA = ctx.createGain()
      this.gainNodeA.gain.value = options.gainA

      this.workletNodeA = new AudioWorkletNode(ctx, 'pcm-processor', {
        processorOptions: { channelId: 'channel_a' }
      })

      this.workletNodeA.port.onmessage = (event) => {
        const { channelId, pcmData, rmsDb, peakDb, isClipping, timestampMs } = event.data
        const samples = new Int16Array(pcmData)
        this.bufferChannelA.write(samples)

        this.callbacks.onLevelMetric({
          channelId,
          rmsDb,
          peakDb,
          isClipping,
          timestampMs
        })

        this.callbacks.onPcmChunk(channelId, samples)
      }

      this.sourceNodeA.connect(this.gainNodeA)
      this.gainNodeA.connect(this.workletNodeA)

      // 2. Channel B: System Loopback / Remote Audio
      try {
        // Attempt desktopCapturer loopback via native stream if available
        if (typeof window !== 'undefined' && window.electronAPI?.getDesktopSources) {
          const sources = await window.electronAPI.getDesktopSources()
          const primaryScreen = sources[0]

          if (primaryScreen) {
            this.streamChannelB = await (navigator.mediaDevices as any).getUserMedia({
              audio: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: primaryScreen.id
                }
              },
              video: false
            }).catch(() => null)
          }
        }
      } catch (loopbackErr) {
        console.warn('[DUALAI] System audio loopback fallback:', loopbackErr)
      }

      // If loopback is not permitted or unsupported in current host, create virtual Channel B test track
      if (!this.streamChannelB && this.streamChannelA) {
        // Safe bilateral fallback clone for testing without external meeting
        this.streamChannelB = this.streamChannelA.clone()
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
    if (!this.audioContext) return

    const now = this.audioContext.currentTime
    if (channelId === 'channel_a' && this.gainNodeA) {
      this.gainNodeA.gain.setTargetAtTime(clampedGain, now, 0.03)
    } else if (channelId === 'channel_b' && this.gainNodeB) {
      this.gainNodeB.gain.setTargetAtTime(clampedGain, now, 0.03)
    }
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

    this.bufferChannelA.clear()
    this.bufferChannelB.clear()
    this.isRunning = false
  }

  public getIsRunning(): boolean {
    return this.isRunning
  }
}
