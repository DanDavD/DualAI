/**
 * DUALAI - Silero VAD v5 ONNX Web Worker
 * Dedicated worker thread for sub-5ms client-side voice activity detection.
 * Keeps all tensor operations and inference off the UI main thread.
 */

import * as ort from 'onnxruntime-web'
import { ChannelId, VADState, VADEvent } from '../../../../types/audio'

export interface VadWorkerConfig {
  threshold: number
  negativeThreshold: number
  preSpeechPadFrames: number
  redemptionFrames: number
  minSpeechFrames: number
}

interface ChannelVadState {
  state: VADState
  recurrentTensor: ort.Tensor
  preSpeechBuffer: Int16Array[]
  onsetCounter: number
  hangoverCounter: number
  frameIndex: number
}

let session: ort.InferenceSession | null = null
let isInitialized = false
const sampleRateTensor = new ort.Tensor('int64', new BigInt64Array([16000n]), [])

let config: VadWorkerConfig = {
  threshold: 0.5,
  negativeThreshold: 0.35,
  preSpeechPadFrames: 10, // ~300ms
  redemptionFrames: 8,    // ~240ms
  minSpeechFrames: 3      // ~90ms
}

function createInitialState(): ChannelVadState {
  return {
    state: 'silence',
    recurrentTensor: new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]),
    preSpeechBuffer: [],
    onsetCounter: 0,
    hangoverCounter: 0,
    frameIndex: 0
  }
}

const channelStates: Record<ChannelId, ChannelVadState> = {
  channel_a: createInitialState(),
  channel_b: createInitialState()
}

async function initSession(modelUrl: string): Promise<void> {
  try {
    ort.env.wasm.numThreads = 1
    ort.env.wasm.simd = true
    
    // In browser context, point to wasm directory if needed
    if (typeof location !== 'undefined') {
      ort.env.wasm.wasmPaths = '/wasm/'
    }

    session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    })

    // Warm-up inference
    const warmupInput = new ort.Tensor('float32', new Float32Array(480), [1, 480])
    const warmupState = new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128])
    await session.run({
      input: warmupInput,
      state: warmupState,
      sr: sampleRateTensor
    })

    isInitialized = true
    self.postMessage({
      type: 'status',
      status: 'ready'
    })
  } catch (error) {
    self.postMessage({
      type: 'status',
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function processFrame(channelId: ChannelId, pcmBuffer: ArrayBuffer, timestampMs: number): Promise<void> {
  if (!session || !isInitialized) {
    return
  }

  const chanState = channelStates[channelId] || (channelStates[channelId] = createInitialState())
  const int16Array = new Int16Array(pcmBuffer)
  const sampleCount = int16Array.length
  chanState.frameIndex++

  // Convert Int16 [-32768, 32767] to normalized Float32 [-1.0, 1.0]
  const float32Array = new Float32Array(sampleCount)
  for (let i = 0; i < sampleCount; i++) {
    float32Array[i] = int16Array[i] / 32768.0
  }

  const t0 = performance.now()
  const inputTensor = new ort.Tensor('float32', float32Array, [1, sampleCount])

  try {
    const results = await session.run({
      input: inputTensor,
      state: chanState.recurrentTensor,
      sr: sampleRateTensor
    })

    const inferenceTimeMs = Math.round((performance.now() - t0) * 100) / 100
    chanState.recurrentTensor = results.stateN

    const probability = Number(results.output.data[0])
    const isAbovePositive = probability >= config.threshold
    const isBelowNegative = probability < config.negativeThreshold

    // State machine with hysteresis and padding
    if (chanState.state === 'silence') {
      // Accumulate pre-speech padding buffer
      chanState.preSpeechBuffer.push(new Int16Array(int16Array))
      if (chanState.preSpeechBuffer.length > config.preSpeechPadFrames) {
        chanState.preSpeechBuffer.shift()
      }

      if (isAbovePositive) {
        chanState.onsetCounter++
        if (chanState.onsetCounter >= config.minSpeechFrames) {
          chanState.state = 'active_speech'
          chanState.hangoverCounter = 0
          chanState.onsetCounter = 0

          // Concat all pre-speech frames to avoid cutting off word onsets
          const preSpeechTotalSamples = chanState.preSpeechBuffer.reduce((sum, f) => sum + f.length, 0)
          const mergedPreSpeech = new Int16Array(preSpeechTotalSamples)
          let offset = 0
          for (const frame of chanState.preSpeechBuffer) {
            mergedPreSpeech.set(frame, offset)
            offset += frame.length
          }
          chanState.preSpeechBuffer = []

          const event: VADEvent = {
            channelId,
            state: 'active_speech',
            probability: Math.round(probability * 1000) / 1000,
            timestampMs,
            frameIndex: chanState.frameIndex
          }

          self.postMessage({
            type: 'speech_start',
            event,
            preSpeechPcm: mergedPreSpeech.buffer,
            inferenceTimeMs
          }, { transfer: [mergedPreSpeech.buffer] })
        }
      } else {
        chanState.onsetCounter = 0
      }
    } else {
      // chanState.state === 'active_speech'
      if (isBelowNegative) {
        chanState.hangoverCounter++
        if (chanState.hangoverCounter >= config.redemptionFrames) {
          chanState.state = 'silence'
          chanState.hangoverCounter = 0
          chanState.onsetCounter = 0

          const event: VADEvent = {
            channelId,
            state: 'silence',
            probability: Math.round(probability * 1000) / 1000,
            timestampMs,
            frameIndex: chanState.frameIndex
          }

          self.postMessage({
            type: 'speech_end',
            event,
            inferenceTimeMs
          })
        } else {
          // In hangover grace period: still emit speech frame to not lose trailing vowels
          emitSpeechFrame(channelId, int16Array, probability, timestampMs, chanState.frameIndex, inferenceTimeMs)
        }
      } else {
        chanState.hangoverCounter = 0
        emitSpeechFrame(channelId, int16Array, probability, timestampMs, chanState.frameIndex, inferenceTimeMs)
      }
    }

    // Always post probability telemetry for UI meters
    self.postMessage({
      type: 'telemetry',
      channelId,
      probability: Math.round(probability * 1000) / 1000,
      isSpeech: chanState.state === 'active_speech',
      inferenceTimeMs,
      timestampMs
    })

  } catch (inferError) {
    console.error('[DUALAI-VAD-WORKER] Inference failure:', inferError)
  }
}

function emitSpeechFrame(
  channelId: ChannelId,
  pcmData: Int16Array,
  probability: number,
  timestampMs: number,
  frameIndex: number,
  inferenceTimeMs: number
): void {
  const copyBuffer = pcmData.slice().buffer
  self.postMessage({
    type: 'speech_frame',
    channelId,
    pcmData: copyBuffer,
    probability: Math.round(probability * 1000) / 1000,
    timestampMs,
    frameIndex,
    inferenceTimeMs
  }, { transfer: [copyBuffer] })
}

function resetChannelState(channelId?: ChannelId): void {
  if (channelId) {
    channelStates[channelId] = createInitialState()
  } else {
    channelStates.channel_a = createInitialState()
    channelStates.channel_b = createInitialState()
  }
}

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data

  switch (type) {
    case 'init':
      await initSession(payload.modelUrl)
      break
    case 'process_frame':
      await processFrame(payload.channelId, payload.pcmBuffer, payload.timestampMs)
      break
    case 'set_config':
      config = { ...config, ...payload }
      break
    case 'reset':
      resetChannelState(payload?.channelId)
      break
    default:
      break
  }
}
