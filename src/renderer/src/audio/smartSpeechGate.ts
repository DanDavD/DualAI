/**
 * DUALAI - Hybrid Neural Speech Gate & PCM Frame Batcher
 * Minimizes Soniox audio token consumption and network overhead while preserving
 * soft/distant speech and zero-clipping word onsets via a 320ms pre-roll ring buffer.
 *
 * Strategy:
 * 1. When Silero VAD v5 is ready: uses neural speech probability (>= 0.35 open, >= 0.25 hold)
 *    with a loud-speech RMS safety net so keyboard clicks, mic static, fan hum, and
 *    non-speech background noise NEVER open the upstream audio stream.
 * 2. When Silero VAD is warming up / unavailable: uses an adaptive RMS noise-floor tracker
 *    with 2-frame onset confirmation (rejects single-sample clicks and steady ambient hum).
 * 3. Buffers the trailing 320ms of audio locally while closed and flushes it immediately
 *    when speech begins so first syllables are never clipped.
 * 4. Batches small 8ms AudioWorklet quanta into 48ms frames (768 samples @ 16kHz),
 *    reducing WebSocket frame overhead by 6x.
 * 5. Enforces a 2,200ms hangover followed by ONE clean finalize so brief natural breaths
 *    never chop sentences mid-phrase.
 */

export interface SmartSpeechGateConfig {
  sampleRate?: number
  preRollMs?: number
  hangoverMs?: number
  batchSamples?: number
  vadOpenThreshold?: number
  vadHoldThreshold?: number
  fallbackMinRms?: number
  fallbackSnrRatio?: number
  rmsSafetyMin?: number
  rmsSafetySnrRatio?: number
}

export interface SpeechGateEmitResult {
  framesToSend: Int16Array[]
  shouldFinalize: boolean
  isOpen: boolean
}

export interface SpeechGateStats {
  totalInputSamples: number
  totalSentSamples: number
  suppressedSamples: number
  echoBlockedSamples: number
}

const DEFAULT_SAMPLE_RATE = 16000
const DEFAULT_PRE_ROLL_MS = 320
const DEFAULT_HANGOVER_MS = 2200
const DEFAULT_BATCH_SAMPLES = 512 // 32ms at 16kHz (4 x 128-sample WebAudio quanta)
const DEFAULT_VAD_OPEN_THRESHOLD = 0.35
const DEFAULT_VAD_HOLD_THRESHOLD = 0.25
const DEFAULT_FALLBACK_MIN_RMS = 0.0055 // ~ -45.2 dBFS
const DEFAULT_FALLBACK_SNR_RATIO = 3.2
const DEFAULT_RMS_SAFETY_MIN = 0.018 // ~ -34.9 dBFS (loud speech safety net if VAD lags)
const DEFAULT_RMS_SAFETY_SNR_RATIO = 4.5
const VAD_TELEMETRY_STALE_MS = 600
const MIN_NOISE_FLOOR_RMS = 0.0005
const MAX_NOISE_FLOOR_RMS = 0.025

function computeNormalizedRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0
  let sumSq = 0
  for (let i = 0; i < pcm.length; i++) {
    const norm = pcm[i] / 32768
    sumSq += norm * norm
  }
  return Math.sqrt(sumSq / pcm.length)
}

export class SmartSpeechGate {
  private readonly sampleRate: number
  private readonly preRollCapacity: number
  private readonly hangoverMs: number
  private readonly batchSamples: number
  private readonly vadOpenThreshold: number
  private readonly vadHoldThreshold: number
  private readonly fallbackMinRms: number
  private readonly fallbackSnrRatio: number
  private readonly rmsSafetyMin: number
  private readonly rmsSafetySnrRatio: number

  // Circular pre-roll buffer storing the latest ~320ms of audio while closed
  private preRollRing: Int16Array
  private preRollWritePos: number = 0
  private preRollFilled: number = 0

  // Outbound batch accumulator (48ms frames)
  private pendingOut: Int16Array
  private pendingOutLen: number = 0

  // Gate & noise floor state
  private isOpen: boolean = false
  private hasSentSinceFinalize: boolean = false
  private lastSpeechAtMs: number = 0
  private onsetStreak: number = 0
  private noiseFloorRms: number = 0.0015

  // Latest Silero VAD telemetry
  private vadReady: boolean = false
  private vadProbability: number = 0
  private vadIsSpeech: boolean = false
  private vadUpdatedAtMs: number = 0

  // Metrics
  private totalInputSamples: number = 0
  private totalSentSamples: number = 0
  private echoBlockedSamples: number = 0

  constructor(config?: SmartSpeechGateConfig) {
    this.sampleRate = config?.sampleRate ?? DEFAULT_SAMPLE_RATE
    const preRollMs = config?.preRollMs ?? DEFAULT_PRE_ROLL_MS
    this.preRollCapacity = Math.max(256, Math.round((this.sampleRate * preRollMs) / 1000))
    this.hangoverMs = config?.hangoverMs ?? DEFAULT_HANGOVER_MS
    this.batchSamples = config?.batchSamples ?? DEFAULT_BATCH_SAMPLES
    this.vadOpenThreshold = config?.vadOpenThreshold ?? DEFAULT_VAD_OPEN_THRESHOLD
    this.vadHoldThreshold = config?.vadHoldThreshold ?? DEFAULT_VAD_HOLD_THRESHOLD
    this.fallbackMinRms = config?.fallbackMinRms ?? DEFAULT_FALLBACK_MIN_RMS
    this.fallbackSnrRatio = config?.fallbackSnrRatio ?? DEFAULT_FALLBACK_SNR_RATIO
    this.rmsSafetyMin = config?.rmsSafetyMin ?? DEFAULT_RMS_SAFETY_MIN
    this.rmsSafetySnrRatio = config?.rmsSafetySnrRatio ?? DEFAULT_RMS_SAFETY_SNR_RATIO

    this.preRollRing = new Int16Array(this.preRollCapacity)
    this.pendingOut = new Int16Array(this.batchSamples)
  }

  public setVadReady(ready: boolean): void {
    this.vadReady = ready
    if (!ready) {
      this.vadProbability = 0
      this.vadIsSpeech = false
      this.vadUpdatedAtMs = 0
    }
  }

  public updateVadTelemetry(probability: number, isSpeech: boolean, nowMs: number = Date.now()): void {
    this.vadReady = true
    this.vadProbability = probability
    this.vadIsSpeech = isSpeech
    this.vadUpdatedAtMs = nowMs
  }

  /**
   * Process a 16kHz Int16 PCM chunk and return zero or more batched frames ready to stream.
   * When `suppressAsSelfEcho` is true (interpreter is speaking locally and call audio may
   * contain return echo/sidetone), System Audio is blocked and pre-roll is cleared so the
   * interpreter's own voice is never sent to Soniox.
   */
  public processChunk(
    pcm16k: Int16Array,
    nowMs: number = Date.now(),
    options?: { suppressAsSelfEcho?: boolean }
  ): SpeechGateEmitResult {
    if (pcm16k.length === 0) {
      return { framesToSend: [], shouldFinalize: false, isOpen: this.isOpen }
    }

    this.totalInputSamples += pcm16k.length

    if (options?.suppressAsSelfEcho) {
      this.echoBlockedSamples += pcm16k.length
      this.onsetStreak = 0
      this.preRollWritePos = 0
      this.preRollFilled = 0
      const framesToSend: Int16Array[] = []
      if (this.isOpen) {
        // Flush any already-buffered pre-echo remote speech tail before suppressing echo frames
        const tail = this.flushPendingOutbound()
        if (tail) {
          framesToSend.push(tail)
        }
        // Drop echo frames without forcing an instant mid-sentence finalize on brief blips;
        // finalize cleanly once sustained suppression exceeds the natural pause hangover window.
        const silenceElapsedMs = nowMs - this.lastSpeechAtMs
        if (silenceElapsedMs > this.hangoverMs) {
          this.isOpen = false
          const shouldFinalize = this.hasSentSinceFinalize
          this.hasSentSinceFinalize = false
          return { framesToSend, shouldFinalize, isOpen: false }
        }
      } else {
        this.pendingOutLen = 0
      }
      return { framesToSend, shouldFinalize: false, isOpen: this.isOpen }
    }
    const rms = computeNormalizedRms(pcm16k)
    const vadFresh = this.vadReady && nowMs - this.vadUpdatedAtMs <= VAD_TELEMETRY_STALE_MS

    let speechDetected = false

    if (vadFresh) {
      const vadThreshold = this.isOpen ? this.vadHoldThreshold : this.vadOpenThreshold
      const neuralHit = this.vadIsSpeech || this.vadProbability >= vadThreshold

      // Loud-speech safety net only triggers on sustained loud vocal energy (never 1-frame clicks)
      const safetyFloor = Math.max(this.rmsSafetyMin, this.noiseFloorRms * this.rmsSafetySnrRatio)
      const loudEnergyHit = rms >= safetyFloor

      if (neuralHit) {
        speechDetected = true
        this.onsetStreak = 2
      } else if (loudEnergyHit) {
        this.onsetStreak++
        if (this.onsetStreak >= 2) {
          speechDetected = true
        }
      } else {
        this.onsetStreak = 0
        this.updateNoiseFloor(rms)
      }
    } else {
      // Adaptive RMS noise-floor fallback when VAD worker is initializing or unavailable
      const openFloor = Math.max(this.fallbackMinRms, this.noiseFloorRms * this.fallbackSnrRatio)
      const holdFloor = Math.max(this.fallbackMinRms * 0.7, this.noiseFloorRms * 2.2)
      const threshold = this.isOpen ? holdFloor : openFloor

      if (rms >= threshold) {
        this.onsetStreak++
        if (this.isOpen || this.onsetStreak >= 2) {
          speechDetected = true
        }
      } else {
        this.onsetStreak = 0
        this.updateNoiseFloor(rms)
      }
    }

    const framesToSend: Int16Array[] = []
    let shouldFinalize = false

    if (speechDetected) {
      this.lastSpeechAtMs = nowMs
      if (!this.isOpen) {
        this.isOpen = true
        this.hasSentSinceFinalize = true
        const preRoll = this.drainPreRoll()
        if (preRoll.length > 0) {
          this.enqueueOutbound(preRoll, framesToSend)
        }
      }
      this.enqueueOutbound(pcm16k, framesToSend)
    } else if (this.isOpen) {
      const silenceElapsedMs = nowMs - this.lastSpeechAtMs
      if (silenceElapsedMs <= this.hangoverMs) {
        this.enqueueOutbound(pcm16k, framesToSend)
      } else {
        // Flush any remaining partial batch before finalizing
        const tail = this.flushPendingOutbound()
        if (tail) {
          framesToSend.push(tail)
        }
        this.isOpen = false
        this.onsetStreak = 0
        this.pushPreRoll(pcm16k)
        if (this.hasSentSinceFinalize) {
          this.hasSentSinceFinalize = false
          shouldFinalize = true
        }
      }
    } else {
      this.pushPreRoll(pcm16k)
    }

    return {
      framesToSend,
      shouldFinalize,
      isOpen: this.isOpen
    }
  }

  /**
   * Immediately closes the gate (e.g., on Cough Mute or System Mute), discards pre-roll,
   * and signals whether an active utterance needs finalization.
   */
  public forceMuteClose(): { shouldFinalize: boolean } {
    const shouldFinalize = this.isOpen || this.hasSentSinceFinalize
    this.isOpen = false
    this.hasSentSinceFinalize = false
    this.onsetStreak = 0
    this.pendingOutLen = 0
    this.preRollWritePos = 0
    this.preRollFilled = 0
    this.vadProbability = 0
    this.vadIsSpeech = false
    return { shouldFinalize }
  }

  public reset(): void {
    this.isOpen = false
    this.hasSentSinceFinalize = false
    this.lastSpeechAtMs = 0
    this.onsetStreak = 0
    this.noiseFloorRms = 0.0015
    this.pendingOutLen = 0
    this.preRollWritePos = 0
    this.preRollFilled = 0
    this.vadProbability = 0
    this.vadIsSpeech = false
    this.vadUpdatedAtMs = 0
    this.totalInputSamples = 0
    this.totalSentSamples = 0
    this.echoBlockedSamples = 0
  }

  public getIsOpen(): boolean {
    return this.isOpen
  }

  public getNoiseFloorRms(): number {
    return this.noiseFloorRms
  }

  public getStats(): SpeechGateStats {
    return {
      totalInputSamples: this.totalInputSamples,
      totalSentSamples: this.totalSentSamples,
      suppressedSamples: Math.max(0, this.totalInputSamples - this.totalSentSamples),
      echoBlockedSamples: this.echoBlockedSamples
    }
  }

  private updateNoiseFloor(rms: number): void {
    // Fast adaptation downward when room gets quieter, slow adaptation upward for steady fan/HVAC
    const alpha = rms < this.noiseFloorRms ? 0.15 : 0.03
    const next = this.noiseFloorRms * (1 - alpha) + rms * alpha
    this.noiseFloorRms = Math.max(MIN_NOISE_FLOOR_RMS, Math.min(MAX_NOISE_FLOOR_RMS, next))
  }

  private pushPreRoll(pcm: Int16Array): void {
    if (pcm.length >= this.preRollCapacity) {
      const start = pcm.length - this.preRollCapacity
      this.preRollRing.set(pcm.subarray(start), 0)
      this.preRollWritePos = 0
      this.preRollFilled = this.preRollCapacity
      return
    }

    const firstPart = Math.min(pcm.length, this.preRollCapacity - this.preRollWritePos)
    this.preRollRing.set(pcm.subarray(0, firstPart), this.preRollWritePos)
    const remaining = pcm.length - firstPart
    if (remaining > 0) {
      this.preRollRing.set(pcm.subarray(firstPart), 0)
    }
    this.preRollWritePos = (this.preRollWritePos + pcm.length) % this.preRollCapacity
    this.preRollFilled = Math.min(this.preRollCapacity, this.preRollFilled + pcm.length)
  }

  private drainPreRoll(): Int16Array {
    if (this.preRollFilled === 0) return new Int16Array(0)

    const out = new Int16Array(this.preRollFilled)
    const readStart =
      (this.preRollWritePos - this.preRollFilled + this.preRollCapacity) % this.preRollCapacity
    const firstPart = Math.min(this.preRollFilled, this.preRollCapacity - readStart)
    out.set(this.preRollRing.subarray(readStart, readStart + firstPart), 0)
    const remaining = this.preRollFilled - firstPart
    if (remaining > 0) {
      out.set(this.preRollRing.subarray(0, remaining), firstPart)
    }

    this.preRollWritePos = 0
    this.preRollFilled = 0
    return out
  }

  private enqueueOutbound(pcm: Int16Array, framesToSend: Int16Array[]): void {
    let offset = 0
    while (offset < pcm.length) {
      const space = this.batchSamples - this.pendingOutLen
      const take = Math.min(space, pcm.length - offset)
      this.pendingOut.set(pcm.subarray(offset, offset + take), this.pendingOutLen)
      this.pendingOutLen += take
      offset += take

      if (this.pendingOutLen >= this.batchSamples) {
        const ready = this.pendingOut.slice()
        framesToSend.push(ready)
        this.totalSentSamples += ready.length
        this.pendingOutLen = 0
      }
    }
  }

  private flushPendingOutbound(): Int16Array | null {
    if (this.pendingOutLen === 0) return null
    const tail = this.pendingOut.slice(0, this.pendingOutLen)
    this.totalSentSamples += tail.length
    this.pendingOutLen = 0
    return tail
  }
}
