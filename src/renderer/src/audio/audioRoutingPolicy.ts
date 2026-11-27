/**
 * DUALAI - Deterministic Audio Route & Language Direction Policy (Listen-Only System Audio)
 * Strictly routes inbound call/system audio (Channel B) to Soniox while NEVER capturing,
 * detecting, or billing local microphone audio (Channel A).
 * OS-level microphone mute is handled strictly as a system-wide call mute convenience.
 */

import { AudioRouteMode, ChannelId, LatencyMode, OperatingMode } from '../../../types/audio'

export interface AudioRoutingInput {
  audioRoute: AudioRouteMode
  operatingMode: OperatingMode
  sourceLang: string
  targetLang: string
}

export interface AudioRoutingDecision {
  captureChannelA: boolean
  captureChannelB: boolean
  sttLangA: string
  sttLangB: string
  translationTargetA: string
  translationTargetB: string
  isBilateralTwoWay: boolean
}

/**
 * Normalizes any audio route to a listen-only system audio route ('system' or 'app').
 * Microphone-only ('mic') and dual-stream ('bilateral') routes are disabled so Soniox
 * never processes or bills the interpreter's own microphone.
 */
export function sanitizeListenOnlyRoute(route: AudioRouteMode): 'system' | 'app' {
  return route === 'app' ? 'app' : 'system'
}

/**
 * Resolves hardware channel activation and translation direction:
 * - Always captures ONLY Channel B (System Audio / Call Loopback).
 * - Channel A (Local Microphone) is strictly disabled (captureChannelA: false).
 * - In 'conversation' mode, Soniox runs single-stream two-way auto-language translation
 *   on Channel B (listening to both sides of the call through system audio).
 * - In 'translate' mode, Soniox runs one-way translation from sourceLang -> targetLang.
 */
export function resolveAudioRoutingPolicy(input: AudioRoutingInput): AudioRoutingDecision {
  const { sourceLang, targetLang } = input

  return {
    captureChannelA: false,
    captureChannelB: true,
    sttLangA: sourceLang,
    sttLangB: sourceLang,
    translationTargetA: targetLang,
    translationTargetB: targetLang,
    isBilateralTwoWay: false
  }
}

export function resolveTranslationTargetForChannel(
  channelId: ChannelId,
  decision: AudioRoutingDecision
): string {
  return channelId === 'channel_a' ? decision.translationTargetA : decision.translationTargetB
}

/**
 * Resolves the effective (sourceLang, targetLang) pair for a given utterance so two-way
 * Conversation mode (e.g. EN <-> ES on Deepgram Nova-3 language=multi) NEVER collapses
 * to ES -> ES when Deepgram detects the remote speaker is speaking the configured targetLang.
 */
export function resolveTranslationPairForUtterance(params: {
  utteranceLang?: string
  channelId: ChannelId
  decision: AudioRoutingDecision
  operatingMode: OperatingMode
  sourceLang: string
  targetLang: string
}): { sourceLang: string; targetLang: string } {
  const { utteranceLang, channelId, decision, operatingMode, sourceLang, targetLang } = params
  const norm = (val?: string): string => (val || '').trim().toLowerCase().split(/[-_]/)[0]
  const baseA = norm(sourceLang) || 'en'
  const baseB = norm(targetLang) || 'es'
  const baseUtterance = norm(utteranceLang)

  if (operatingMode === 'conversation' && baseA !== baseB) {
    if (baseUtterance === baseB) {
      return { sourceLang: baseB, targetLang: baseA }
    }
    return { sourceLang: baseA, targetLang: baseB }
  }

  return {
    sourceLang: baseUtterance || baseA,
    targetLang: resolveTranslationTargetForChannel(channelId, decision)
  }
}

export function resolveEndpointingMs(_latencyMode: LatencyMode): number {
  return 300
}
