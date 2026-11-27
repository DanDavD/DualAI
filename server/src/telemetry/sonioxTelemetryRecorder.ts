/**
 * DUALAI - Zero-PII Soniox Token & Cost Diagnostic Telemetry Recorder
 * Captures strictly numeric session metrics (durations, audio bytes, wake/hibernate cycles,
 * Soniox audio_proc_ms, and token counts) with ZERO transcript text, ZERO emails, and ZERO secrets.
 * Active strictly in local development mode (`NODE_ENV === 'development'`) for cost diagnostics.
 */

import fs from 'node:fs'
import path from 'node:path'

export interface SonioxSessionTelemetrySnapshot {
  sessionId: string
  startedAtIso: string
  endedAtIso: string | null
  status: 'active' | 'closed'
  model: string
  mode: 'translate' | 'conversation'
  pair: string
  domain: string
  sampleRate: number
  wallClockMs: number
  upstreamOpenMs: number
  hibernatedMs: number
  wakeCount: number
  hibernateCount: number
  audioBytesSent: number
  audioSecondsSent: number
  sonioxFinalAudioProcMs: number
  sonioxTotalAudioProcMs: number
  finalOriginalTokens: number
  finalTranslationTokens: number
  provisionalTokens: number
  contextInputTokensEst: number
  keepalivesForwarded: number
  keepalivesAbsorbed: number
  finalizesSent: number
  quotaDeductedSeconds: number
}

const TELEMETRY_DIR = path.resolve(process.cwd(), 'server', '.telemetry')
const USAGE_JSONL_PATH = path.join(TELEMETRY_DIR, 'soniox_usage.jsonl')
const ACTIVE_SNAPSHOT_PATH = path.join(TELEMETRY_DIR, 'active_sessions.json')

const activeSessionsMap = new Map<string, SonioxSessionTelemetrySnapshot>()

function ensureTelemetryDir(): void {
  if (!fs.existsSync(TELEMETRY_DIR)) {
    fs.mkdirSync(TELEMETRY_DIR, { recursive: true })
  }
}

function flushActiveSessionsFile(): void {
  try {
    ensureTelemetryDir()
    const payload = Array.from(activeSessionsMap.values())
    fs.writeFileSync(ACTIVE_SNAPSHOT_PATH, JSON.stringify(payload, null, 2), 'utf-8')
  } catch {
    // Non-fatal diagnostic write failure
  }
}

function appendClosedSessionRecord(snapshot: SonioxSessionTelemetrySnapshot): void {
  try {
    ensureTelemetryDir()
    fs.appendFileSync(USAGE_JSONL_PATH, `${JSON.stringify(snapshot)}\n`, 'utf-8')
  } catch {
    // Non-fatal diagnostic write failure
  }
}

export class SonioxSessionTelemetry {
  private readonly enabled: boolean
  private readonly sessionId: string
  private readonly startedAtMs: number
  private readonly startedAtIso: string
  private readonly model: string
  private readonly mode: 'translate' | 'conversation'
  private readonly pair: string
  private readonly domain: string
  private readonly sampleRate: number

  private currentUpstreamOpenedAtMs: number | null = null
  private accumulatedUpstreamOpenMs: number = 0
  private wakeCount: number = 0
  private hibernateCount: number = 0
  private audioBytesSent: number = 0

  // Soniox resets audio_proc_ms on every new upstream connection, so we track per-wake max + cumulative
  private currentWakeFinalAudioProcMs: number = 0
  private currentWakeTotalAudioProcMs: number = 0
  private accumulatedFinalAudioProcMs: number = 0
  private accumulatedTotalAudioProcMs: number = 0

  private finalOriginalTokens: number = 0
  private finalTranslationTokens: number = 0
  private provisionalTokens: number = 0
  private contextInputTokensEst: number = 0
  private keepalivesForwarded: number = 0
  private keepalivesAbsorbed: number = 0
  private finalizesSent: number = 0
  private quotaDeductedSeconds: number = 0

  private checkpointTimer: ReturnType<typeof setInterval> | null = null
  private finalized: boolean = false

  constructor(params: {
    enabled: boolean
    sessionId: string
    model: string
    mode: 'translate' | 'conversation'
    pair: string
    domain: string
    sampleRate: number
  }) {
    this.enabled = params.enabled
    this.sessionId = params.sessionId
    this.startedAtMs = Date.now()
    this.startedAtIso = new Date(this.startedAtMs).toISOString()
    this.model = params.model
    this.mode = params.mode
    this.pair = params.pair
    this.domain = params.domain
    this.sampleRate = params.sampleRate

    if (this.enabled) {
      activeSessionsMap.set(this.sessionId, this.buildSnapshot('active'))
      flushActiveSessionsFile()
      this.checkpointTimer = setInterval(() => {
        if (!this.finalized) {
          activeSessionsMap.set(this.sessionId, this.buildSnapshot('active'))
          flushActiveSessionsFile()
        }
      }, 15_000)
    }
  }

  public recordUpstreamOpened(initPayload: Record<string, unknown>): void {
    if (!this.enabled || this.finalized) return
    this.wakeCount++
    this.currentUpstreamOpenedAtMs = Date.now()
    this.currentWakeFinalAudioProcMs = 0
    this.currentWakeTotalAudioProcMs = 0

    // Estimate input text tokens from context payload (~4 chars per token)
    const contextJson = initPayload.context ? JSON.stringify(initPayload.context) : ''
    this.contextInputTokensEst += Math.ceil(contextJson.length / 4)

    activeSessionsMap.set(this.sessionId, this.buildSnapshot('active'))
    flushActiveSessionsFile()
  }

  public recordUpstreamClosed(reason: 'hibernate' | 'close'): void {
    if (!this.enabled) return
    if (this.currentUpstreamOpenedAtMs !== null) {
      this.accumulatedUpstreamOpenMs += Math.max(0, Date.now() - this.currentUpstreamOpenedAtMs)
      this.currentUpstreamOpenedAtMs = null
    }
    this.accumulatedFinalAudioProcMs += this.currentWakeFinalAudioProcMs
    this.accumulatedTotalAudioProcMs += this.currentWakeTotalAudioProcMs
    this.currentWakeFinalAudioProcMs = 0
    this.currentWakeTotalAudioProcMs = 0

    if (reason === 'hibernate') {
      this.hibernateCount++
    }
    if (!this.finalized) {
      activeSessionsMap.set(this.sessionId, this.buildSnapshot('active'))
      flushActiveSessionsFile()
    }
  }

  public recordAudioBytesSent(byteLength: number): void {
    if (!this.enabled || this.finalized) return
    this.audioBytesSent += byteLength
  }

  public recordSonioxResponse(parsed: {
    tokens?: unknown[]
    final_audio_proc_ms?: number
    total_audio_proc_ms?: number
  }): void {
    if (!this.enabled || this.finalized) return

    if (
      typeof parsed.final_audio_proc_ms === 'number' &&
      parsed.final_audio_proc_ms > this.currentWakeFinalAudioProcMs
    ) {
      this.currentWakeFinalAudioProcMs = parsed.final_audio_proc_ms
    }
    if (
      typeof parsed.total_audio_proc_ms === 'number' &&
      parsed.total_audio_proc_ms > this.currentWakeTotalAudioProcMs
    ) {
      this.currentWakeTotalAudioProcMs = parsed.total_audio_proc_ms
    }

    if (Array.isArray(parsed.tokens)) {
      for (const raw of parsed.tokens) {
        if (!raw || typeof raw !== 'object') continue
        const tok = raw as { text?: string; is_final?: boolean; translation_status?: string }
        if (!tok.text || tok.text === '<end>' || tok.text === '<fin>') continue
        if (tok.is_final) {
          if (tok.translation_status === 'translation') {
            this.finalTranslationTokens++
          } else {
            this.finalOriginalTokens++
          }
        } else {
          this.provisionalTokens++
        }
      }
    }
  }

  public recordKeepalive(forwarded: boolean): void {
    if (!this.enabled || this.finalized) return
    if (forwarded) {
      this.keepalivesForwarded++
    } else {
      this.keepalivesAbsorbed++
    }
  }

  public recordFinalizeSent(): void {
    if (!this.enabled || this.finalized) return
    this.finalizesSent++
  }

  public recordQuotaDeducted(seconds: number): void {
    if (!this.enabled || this.finalized) return
    this.quotaDeductedSeconds += seconds
  }

  public finish(): void {
    if (!this.enabled || this.finalized) return
    this.finalized = true

    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer)
      this.checkpointTimer = null
    }
    if (this.currentUpstreamOpenedAtMs !== null) {
      this.recordUpstreamClosed('close')
    }

    const finalSnapshot = this.buildSnapshot('closed')
    activeSessionsMap.delete(this.sessionId)
    flushActiveSessionsFile()
    appendClosedSessionRecord(finalSnapshot)
  }

  private buildSnapshot(status: 'active' | 'closed'): SonioxSessionTelemetrySnapshot {
    const now = Date.now()
    const wallClockMs = Math.max(0, now - this.startedAtMs)
    const liveOpenMs =
      this.currentUpstreamOpenedAtMs !== null
        ? Math.max(0, now - this.currentUpstreamOpenedAtMs)
        : 0
    const upstreamOpenMs = this.accumulatedUpstreamOpenMs + liveOpenMs
    const hibernatedMs = Math.max(0, wallClockMs - upstreamOpenMs)
    const bytesPerSecond = Math.max(1, this.sampleRate * 2)

    return {
      sessionId: this.sessionId,
      startedAtIso: this.startedAtIso,
      endedAtIso: status === 'closed' ? new Date(now).toISOString() : null,
      status,
      model: this.model,
      mode: this.mode,
      pair: this.pair,
      domain: this.domain,
      sampleRate: this.sampleRate,
      wallClockMs,
      upstreamOpenMs,
      hibernatedMs,
      wakeCount: this.wakeCount,
      hibernateCount: this.hibernateCount,
      audioBytesSent: this.audioBytesSent,
      audioSecondsSent: Math.round((this.audioBytesSent / bytesPerSecond) * 100) / 100,
      sonioxFinalAudioProcMs:
        this.accumulatedFinalAudioProcMs + this.currentWakeFinalAudioProcMs,
      sonioxTotalAudioProcMs:
        this.accumulatedTotalAudioProcMs + this.currentWakeTotalAudioProcMs,
      finalOriginalTokens: this.finalOriginalTokens,
      finalTranslationTokens: this.finalTranslationTokens,
      provisionalTokens: this.provisionalTokens,
      contextInputTokensEst: this.contextInputTokensEst,
      keepalivesForwarded: this.keepalivesForwarded,
      keepalivesAbsorbed: this.keepalivesAbsorbed,
      finalizesSent: this.finalizesSent,
      quotaDeductedSeconds: this.quotaDeductedSeconds
    }
  }
}
