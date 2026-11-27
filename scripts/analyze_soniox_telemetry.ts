/**
 * DUALAI - Soniox Workday Token & SaaS Unit-Economics Diagnostic Analyzer
 * Reads zero-PII local telemetry from server/.telemetry/soniox_usage.jsonl & active_sessions.json,
 * compares against real Soniox balance spend, and models multi-user SaaS margins.
 *
 * Usage:
 *   npx tsx scripts/analyze_soniox_telemetry.ts [--end-balance 8.95] [--call-minutes 180] [--shift-hours 8]
 */

import fs from 'node:fs'
import path from 'node:path'
import { SonioxSessionTelemetrySnapshot } from '../server/src/telemetry/sonioxTelemetryRecorder.ts'
import { ClientTelemetryPayload } from '../src/types/ipc.ts'

interface ShiftBaseline {
  startedAtIso: string
  startBalanceUsd: number
}

const TELEMETRY_DIR = path.resolve(process.cwd(), 'server', '.telemetry')
const USAGE_JSONL_PATH = path.join(TELEMETRY_DIR, 'soniox_usage.jsonl')
const ACTIVE_SNAPSHOT_PATH = path.join(TELEMETRY_DIR, 'active_sessions.json')
const CLIENT_USAGE_JSONL_PATH = path.join(TELEMETRY_DIR, 'client_soniox_usage.jsonl')
const CLIENT_ACTIVE_PATH = path.join(TELEMETRY_DIR, 'client_active_session.json')
const BASELINE_PATH = path.join(TELEMETRY_DIR, 'shift_baseline.json')

// Soniox Published Real-Time Token Rates (USD per 1M tokens)
const SONIOX_AUDIO_RATE_PER_1M = 2.0
const SONIOX_TEXT_RATE_PER_1M = 4.0
const AUDIO_TOKENS_PER_HOUR = 30_000 // Soniox reference benchmark: ~30k audio tokens / hour

function parseArg(flag: string): number | null {
  const idx = process.argv.indexOf(flag)
  if (idx === -1 || idx + 1 >= process.argv.length) return null
  const val = Number(process.argv[idx + 1])
  return Number.isFinite(val) ? val : null
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  const hrs = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`
  return `${mins}m ${secs}s`
}

function loadSessions(sinceIso?: string): SonioxSessionTelemetrySnapshot[] {
  const sessions: SonioxSessionTelemetrySnapshot[] = []
  const sinceMs = sinceIso ? Date.parse(sinceIso) : 0

  if (fs.existsSync(USAGE_JSONL_PATH)) {
    const lines = fs.readFileSync(USAGE_JSONL_PATH, 'utf-8').split(/\r?\n/).filter(Boolean)
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as SonioxSessionTelemetrySnapshot
        if (!sinceMs || Date.parse(parsed.startedAtIso) >= sinceMs) {
          sessions.push(parsed)
        }
      } catch {
        // skip malformed line
      }
    }
  }

  if (fs.existsSync(ACTIVE_SNAPSHOT_PATH)) {
    try {
      const active = JSON.parse(
        fs.readFileSync(ACTIVE_SNAPSHOT_PATH, 'utf-8')
      ) as SonioxSessionTelemetrySnapshot[]
      for (const s of active) {
        if (!sinceMs || Date.parse(s.startedAtIso) >= sinceMs) {
          sessions.push(s)
        }
      }
    } catch {
      // skip
    }
  }

  return sessions
}

function loadClientSessions(sinceIso?: string): ClientTelemetryPayload[] {
  const sessions: ClientTelemetryPayload[] = []
  const sinceMs = sinceIso ? Date.parse(sinceIso) : 0

  if (fs.existsSync(CLIENT_USAGE_JSONL_PATH)) {
    const lines = fs.readFileSync(CLIENT_USAGE_JSONL_PATH, 'utf-8').split(/\r?\n/).filter(Boolean)
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as ClientTelemetryPayload
        if (!sinceMs || Date.parse(parsed.startedAtIso) >= sinceMs) {
          sessions.push(parsed)
        }
      } catch {
        // skip
      }
    }
  }

  if (fs.existsSync(CLIENT_ACTIVE_PATH)) {
    try {
      const active = JSON.parse(
        fs.readFileSync(CLIENT_ACTIVE_PATH, 'utf-8')
      ) as ClientTelemetryPayload
      if (!sinceMs || Date.parse(active.startedAtIso) >= sinceMs) {
        sessions.push(active)
      }
    } catch {
      // skip
    }
  }

  return sessions
}

function run(): void {
  let baseline: ShiftBaseline | null = null
  if (fs.existsSync(BASELINE_PATH)) {
    baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as ShiftBaseline
  }

  const startBalance = parseArg('--start-balance') ?? baseline?.startBalanceUsd ?? 9.57
  const endBalance = parseArg('--end-balance')
  const callMinutes = parseArg('--call-minutes')
  const shiftHours = parseArg('--shift-hours')

  const sessions = loadSessions(baseline?.startedAtIso)
  const clientSessions = loadClientSessions(baseline?.startedAtIso)

  console.log('==================================================================')
  console.log('DUALAI SONIOX FULL-SHIFT TOKEN & UNIT-ECONOMICS DIAGNOSTIC')
  console.log('==================================================================')
  if (baseline) {
    console.log(`Baseline started:   ${baseline.startedAtIso}`)
    console.log(`Starting balance:   $${startBalance.toFixed(4)} USD`)
  }
  console.log(`Gateway sessions:   ${sessions.length}`)
  console.log(`Client sessions:    ${clientSessions.length}`)
  console.log('')

  if (clientSessions.length > 0) {
    const ct = clientSessions.reduce(
      (acc, s) => {
        acc.wallClockMs += s.wallClockMs
        acc.audioSecondsCaptured += s.audioSecondsCaptured
        acc.audioSecondsSent += s.audioSecondsSent
        acc.audioSecondsSuppressed += s.audioSecondsSuppressed
        acc.audioSecondsEchoBlocked += s.audioSecondsEchoBlocked
        acc.finalOriginalTokens += s.finalOriginalTokens
        acc.finalTranslationTokens += s.finalTranslationTokens
        acc.finalizesSent += s.finalizesSent
        return acc
      },
      {
        wallClockMs: 0,
        audioSecondsCaptured: 0,
        audioSecondsSent: 0,
        audioSecondsSuppressed: 0,
        audioSecondsEchoBlocked: 0,
        finalOriginalTokens: 0,
        finalTranslationTokens: 0,
        finalizesSent: 0
      }
    )
    const suppressedPct =
      ct.audioSecondsCaptured > 0
        ? (ct.audioSecondsSuppressed / ct.audioSecondsCaptured) * 100
        : 0
    const echoPct =
      ct.audioSecondsCaptured > 0
        ? (ct.audioSecondsEchoBlocked / ct.audioSecondsCaptured) * 100
        : 0
    const totalClientTokens = ct.finalOriginalTokens + ct.finalTranslationTokens
    console.log('--- CLIENT-SIDE GATE & TOKEN TELEMETRY (WORKS WITH FLY.IO & LOCAL) ---')
    console.log(`Gateway Target:               ${clientSessions[clientSessions.length - 1].gatewayUrl}`)
    console.log(`Connected Wall Time:          ${formatDuration(ct.wallClockMs)}`)
    console.log(`System Audio Captured:        ${formatDuration(ct.audioSecondsCaptured * 1000)}`)
    console.log(`PCM Actually Sent to Soniox:  ${formatDuration(ct.audioSecondsSent * 1000)}`)
    console.log(`Suppressed by SpeechGate:     ${formatDuration(ct.audioSecondsSuppressed * 1000)} (${suppressedPct.toFixed(1)}% saved)`)
    console.log(`Blocked Self-Voice Echo:      ${formatDuration(ct.audioSecondsEchoBlocked * 1000)} (${echoPct.toFixed(1)}% of audio)`)
    console.log(`Final Original Tokens (STT):  ${ct.finalOriginalTokens.toLocaleString()}`)
    console.log(`Final Translation Tokens:     ${ct.finalTranslationTokens.toLocaleString()}`)
    console.log(`Total Output Text Tokens:     ${totalClientTokens.toLocaleString()} (~$${((totalClientTokens / 1_000_000) * SONIOX_TEXT_RATE_PER_1M).toFixed(4)})`)
    console.log('')
  }

  if (sessions.length === 0) {
    if (endBalance !== null) {
      const actualSpend = Math.max(0, startBalance - endBalance)
      console.log('--- REAL SONIOX BALANCE RECONCILIATION ---')
      console.log(`Actual Spend ($${startBalance.toFixed(2)} -> $${endBalance.toFixed(2)}): $${actualSpend.toFixed(4)} USD`)
      if (callMinutes && callMinutes > 0) {
        console.log(`Real Cost / Call Hour (${callMinutes}m):  $${(actualSpend / (callMinutes / 60)).toFixed(4)} / hr`)
      }
      if (shiftHours && shiftHours > 0) {
        console.log(`Real Cost / Shift Hour (${shiftHours}h):  $${(actualSpend / shiftHours).toFixed(4)} / hr`)
      }
      console.log('==================================================================')
    } else if (clientSessions.length === 0) {
      console.log('No Soniox sessions recorded yet since baseline.')
      console.log('Start interpreting in DualAI and re-run this script when finished.')
    }
    return
  }

  const totals = sessions.reduce(
    (acc, s) => {
      acc.wallClockMs += s.wallClockMs
      acc.upstreamOpenMs += s.upstreamOpenMs
      acc.hibernatedMs += s.hibernatedMs
      acc.wakeCount += s.wakeCount
      acc.hibernateCount += s.hibernateCount
      acc.audioSecondsSent += s.audioSecondsSent
      acc.sonioxTotalAudioProcMs += s.sonioxTotalAudioProcMs
      acc.finalOriginalTokens += s.finalOriginalTokens
      acc.finalTranslationTokens += s.finalTranslationTokens
      acc.provisionalTokens += s.provisionalTokens
      acc.contextInputTokensEst += s.contextInputTokensEst
      acc.keepalivesForwarded += s.keepalivesForwarded
      acc.keepalivesAbsorbed += s.keepalivesAbsorbed
      acc.quotaDeductedSeconds += s.quotaDeductedSeconds
      return acc
    },
    {
      wallClockMs: 0,
      upstreamOpenMs: 0,
      hibernatedMs: 0,
      wakeCount: 0,
      hibernateCount: 0,
      audioSecondsSent: 0,
      sonioxTotalAudioProcMs: 0,
      finalOriginalTokens: 0,
      finalTranslationTokens: 0,
      provisionalTokens: 0,
      contextInputTokensEst: 0,
      keepalivesForwarded: 0,
      keepalivesAbsorbed: 0,
      quotaDeductedSeconds: 0
    }
  )

  const upstreamHours = totals.upstreamOpenMs / 3_600_000
  const audioSentHours = totals.audioSecondsSent / 3600
  const sonioxProcHours = totals.sonioxTotalAudioProcMs / 3_600_000
  const wallHours = totals.wallClockMs / 3_600_000

  // Token estimates
  const estAudioTokensFromOpenStream = Math.round(upstreamHours * AUDIO_TOKENS_PER_HOUR)
  const estAudioTokensFromAudioSent = Math.round(audioSentHours * AUDIO_TOKENS_PER_HOUR)
  const totalFinalTextTokens = totals.finalOriginalTokens + totals.finalTranslationTokens

  const estAudioCostOpen = (estAudioTokensFromOpenStream / 1_000_000) * SONIOX_AUDIO_RATE_PER_1M
  const estAudioCostSent = (estAudioTokensFromAudioSent / 1_000_000) * SONIOX_AUDIO_RATE_PER_1M
  const estTextCost = (totalFinalTextTokens / 1_000_000) * SONIOX_TEXT_RATE_PER_1M
  const estContextCost = (totals.contextInputTokensEst / 1_000_000) * SONIOX_TEXT_RATE_PER_1M

  const hibernationSavedPct =
    totals.wallClockMs > 0 ? (totals.hibernatedMs / totals.wallClockMs) * 100 : 0

  console.log('--- 1. TIME & HIBERNATION EFFICIENCY ---')
  console.log(`Total Connected Wall Time:    ${formatDuration(totals.wallClockMs)} (${wallHours.toFixed(2)}h)`)
  console.log(`Soniox Upstream Awake Time:   ${formatDuration(totals.upstreamOpenMs)} (${upstreamHours.toFixed(2)}h)`)
  console.log(`Hibernated Time ($0 billed):  ${formatDuration(totals.hibernatedMs)} (${hibernationSavedPct.toFixed(1)}% saved!)`)
  console.log(`PCM Audio Actually Streamed:  ${formatDuration(totals.audioSecondsSent * 1000)} (${audioSentHours.toFixed(2)}h)`)
  console.log(`Soniox Reported Audio Proc:   ${formatDuration(totals.sonioxTotalAudioProcMs)} (${sonioxProcHours.toFixed(2)}h)`)
  console.log(`DualAI User Quota Deducted:   ${formatDuration(totals.quotaDeductedSeconds * 1000)} (${(totals.quotaDeductedSeconds / 3600).toFixed(2)}h)`)
  console.log(`Wake Cycles / Hibernations:   ${totals.wakeCount} wakes / ${totals.hibernateCount} hibernations`)
  console.log(`Keepalives (Sent / Absorbed): ${totals.keepalivesForwarded} forwarded / ${totals.keepalivesAbsorbed} absorbed ($0)`)
  console.log('')

  console.log('--- 2. TOKEN FLOW BREAKDOWN ---')
  console.log(`Est. Audio Tokens (Open):     ${estAudioTokensFromOpenStream.toLocaleString()} tokens (~$${estAudioCostOpen.toFixed(4)})`)
  console.log(`Est. Audio Tokens (PCM Sent): ${estAudioTokensFromAudioSent.toLocaleString()} tokens (~$${estAudioCostSent.toFixed(4)})`)
  console.log(`Final Original Tokens (STT):  ${totals.finalOriginalTokens.toLocaleString()}`)
  console.log(`Final Translation Tokens:     ${totals.finalTranslationTokens.toLocaleString()}`)
  console.log(`Total Final Output Tokens:    ${totalFinalTextTokens.toLocaleString()} (~$${estTextCost.toFixed(4)})`)
  console.log(`Est. Context Input Tokens:    ${totals.contextInputTokensEst.toLocaleString()} (~$${estContextCost.toFixed(4)})`)
  console.log(`Estimated Total Cost Range:   $${(estAudioCostSent + estTextCost + estContextCost).toFixed(4)} - $${(estAudioCostOpen + estTextCost + estContextCost).toFixed(4)}`)

  if (endBalance !== null) {
    const actualSpend = Math.max(0, startBalance - endBalance)
    console.log('')
    console.log('--- 3. REAL SONIOX BALANCE RECONCILIATION ---')
    console.log(`Actual Spend ($${startBalance.toFixed(2)} -> $${endBalance.toFixed(2)}): $${actualSpend.toFixed(4)} USD`)
    if (wallHours > 0) {
      console.log(`Real Cost / App Connected Hour: $${(actualSpend / wallHours).toFixed(4)} / hr`)
    }
    if (upstreamHours > 0) {
      console.log(`Real Cost / Soniox Awake Hour:  $${(actualSpend / upstreamHours).toFixed(4)} / hr`)
    }
    if (callMinutes && callMinutes > 0) {
      const callHours = callMinutes / 60
      console.log(`Real Cost / Call Hour (${callMinutes}m):  $${(actualSpend / callHours).toFixed(4)} / hr`)
    }
    if (shiftHours && shiftHours > 0) {
      console.log(`Real Cost / Shift Hour (${shiftHours}h):  $${(actualSpend / shiftHours).toFixed(4)} / hr`)
    }
  }
  console.log('==================================================================')
}

run()
