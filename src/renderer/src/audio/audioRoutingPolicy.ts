/**
 * DUALAI - Deterministic Audio Route & Language Direction Policy
 * Pure policy engine resolving active capture channels (A: Mic, B: System Loopback),
 * per-channel STT listening language, and translation target direction
 * from AudioRouteMode, OperatingMode, and selected ISO language pair.
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
 * Resolves hardware channel activation and translation direction:
 * - One-way modes ('translate' OR single-channel routes: 'system', 'app', 'mic'):
 *   Every active channel listens in `sourceLang` and translates to `targetLang`.
 *   This guarantees System Audio Loopback with EN -> ES always translates English to Spanish.
 * - Two-way bilateral interpretation ('bilateral' + 'conversation'):
 *   Channel A (Local Mic) listens in `sourceLang` -> translates to `targetLang`.
 *   Channel B (Remote System Audio) listens in `targetLang` -> translates to `sourceLang`.
 */
export function resolveAudioRoutingPolicy(input: AudioRoutingInput): AudioRoutingDecision {
  const { audioRoute, operatingMode, sourceLang, targetLang } = input

  const captureChannelA = audioRoute === 'mic' || audioRoute === 'bilateral'
  const captureChannelB =
    audioRoute === 'system' || audioRoute === 'app' || audioRoute === 'bilateral'

  const isBilateralTwoWay = audioRoute === 'bilateral' && operatingMode === 'conversation'

  return {
    captureChannelA,
    captureChannelB,
    sttLangA: sourceLang,
    sttLangB: isBilateralTwoWay ? targetLang : sourceLang,
    translationTargetA: targetLang,
    translationTargetB: isBilateralTwoWay ? sourceLang : targetLang,
    isBilateralTwoWay
  }
}

export function resolveTranslationTargetForChannel(
  channelId: ChannelId,
  decision: AudioRoutingDecision
): string {
  return channelId === 'channel_a' ? decision.translationTargetA : decision.translationTargetB
}

export function resolveEndpointingMs(latencyMode: LatencyMode): number {
  return latencyMode === 'sub_second_live' ? 250 : 650
}
