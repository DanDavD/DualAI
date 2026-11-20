/**
 * DUALAI - Silero VAD v5 Client Engine
 * High-level orchestration for client-side Voice Activity Detection.
 * Connects AudioIngestionEngine with the isolated Web Worker.
 */

import { ChannelId, VADEvent } from '../../../../types/audio'
import { VadWorkerConfig } from './vadWorker'

export interface VadEngineCallbacks {
  onSpeechStart: (event: VADEvent, preSpeechPcm: Int16Array) => void
  onSpeechFrame: (channelId: ChannelId, pcmData: Int16Array, probability: number) => void
  onSpeechEnd: (event: VADEvent) => void
  onVadTelemetry: (
    channelId: ChannelId,
    probability: number,
    isSpeech: boolean,
    inferenceLatencyMs: number
  ) => void
  onStatusChange?: (status: 'initializing' | 'ready' | 'error', error?: string) => void
}

export class SileroVadEngine {
  private worker: Worker | null = null
  private callbacks: VadEngineCallbacks
  private isReady: boolean = false
  private modelUrl: string = '/models/silero_vad.onnx'

  constructor(callbacks: VadEngineCallbacks) {
    this.callbacks = callbacks
  }

  public async start(): Promise<void> {
    if (this.worker) return

    try {
      this.callbacks.onStatusChange?.('initializing')

      // Instantiate Vite module worker
      this.worker = new Worker(new URL('./vadWorker.ts', import.meta.url), {
        type: 'module'
      })

      this.worker.onmessage = (event: MessageEvent) => {
        const { type, ...payload } = event.data

        switch (type) {
          case 'status':
            if (payload.status === 'ready') {
              this.isReady = true
              this.callbacks.onStatusChange?.('ready')
            } else {
              this.isReady = false
              this.callbacks.onStatusChange?.('error', payload.error)
            }
            break

          case 'speech_start':
            this.callbacks.onSpeechStart(
              payload.event,
              new Int16Array(payload.preSpeechPcm)
            )
            break

          case 'speech_frame':
            this.callbacks.onSpeechFrame(
              payload.channelId,
              new Int16Array(payload.pcmData),
              payload.probability
            )
            break

          case 'speech_end':
            this.callbacks.onSpeechEnd(payload.event)
            break

          case 'telemetry':
            this.callbacks.onVadTelemetry(
              payload.channelId,
              payload.probability,
              payload.isSpeech,
              payload.inferenceTimeMs
            )
            break

          default:
            break
        }
      }

      this.worker.onerror = (err) => {
        console.error('[DUALAI-VAD] Web Worker encountered fatal error:', err)
        this.callbacks.onStatusChange?.('error', err.message)
      }

      // Initialize session in worker
      this.worker.postMessage({
        type: 'init',
        payload: { modelUrl: this.modelUrl }
      })
    } catch (err) {
      console.error('[DUALAI-VAD] Worker initialization failed:', err)
      this.callbacks.onStatusChange?.('error', err instanceof Error ? err.message : String(err))
      throw err
    }
  }

  /**
   * Feed a 30ms (or dynamic) Int16 PCM audio chunk into VAD worker for inference.
   */
  public processPcmFrame(channelId: ChannelId, pcmData: Int16Array, timestampMs: number = Date.now()): void {
    if (!this.worker || !this.isReady) return

    // Clone buffer for zero-copy postMessage transfer
    const transferableBuffer = pcmData.slice().buffer

    this.worker.postMessage(
      {
        type: 'process_frame',
        payload: {
          channelId,
          pcmBuffer: transferableBuffer,
          timestampMs
        }
      },
      [transferableBuffer]
    )
  }

  public updateConfig(config: Partial<VadWorkerConfig>): void {
    if (!this.worker) return
    this.worker.postMessage({
      type: 'set_config',
      payload: config
    })
  }

  public reset(channelId?: ChannelId): void {
    if (!this.worker) return
    this.worker.postMessage({
      type: 'reset',
      payload: { channelId }
    })
  }

  public stop(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.isReady = false
  }

  public getIsReady(): boolean {
    return this.isReady
  }
}
