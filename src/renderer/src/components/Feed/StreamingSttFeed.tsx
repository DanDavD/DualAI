/**
 * DUALAI - Streaming Speech-to-Text Live Feed Component
 * Visualizes bidirectional WebSocket STT streaming, word-by-word interim dispatch,
 * low-confidence token tagging (< 0.75 confidence with discrete dotted underline),
 * and automatic socket reconnection lifecycle.
 */

import React from 'react'
import {
  Radio,
  Wifi,
  WifiOff,
  RefreshCw,
  Trash2,
  Volume2,
  Clock,
  Sparkles,
  AlertCircle
} from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { TranscriptToken, TranscriptUtterance } from '../../../../types/stt'

export const StreamingSttFeed: React.FC = () => {
  const {
    isAudioActive,
    sttStatusA,
    sttStatusB,
    sttLatencyMs,
    sttProvider,
    sttReconnectCount,
    utterances,
    interimTranscriptA,
    interimTranscriptB,
    clearTranscripts,
    simulateSocketDrop,
    sendTestSpeechUtterance,
    sourceLang,
    targetLang
  } = useSession()

  const renderToken = (token: TranscriptToken) => {
    return (
      <span
        key={token.id}
        title={`Token: "${token.text}" | Confidence: ${(token.confidence * 100).toFixed(0)}% (${token.startTimeMs}ms - ${token.endTimeMs}ms)`}
        className={`inline-block mr-1.5 transition-colors cursor-help select-text ${
          token.isLowConfidence
            ? 'border-b border-dotted border-accent-amber text-amber-200 hover:text-amber-100'
            : 'text-text-primary'
        }`}
      >
        {token.text}
      </span>
    )
  }

  const renderUtteranceCard = (utterance: TranscriptUtterance, isInterim: boolean = false) => {
    const isChannelA = utterance.channelId === 'channel_a'
    const langCode = isChannelA ? sourceLang.toUpperCase() : targetLang.toUpperCase()
    const speakerLabel = isChannelA ? `CH A [MIC / ${langCode}]` : `CH B [SYS / ${langCode}]`
    const badgeColor = isChannelA
      ? 'border-accent-steel/30 bg-accent-steel/10 text-accent-steel'
      : 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber'

    const timeFormatted = new Date(utterance.timestampMs).toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })

    return (
      <div
        key={utterance.id}
        className={`rounded-lg border p-3.5 space-y-2 transition-all ${
          isInterim
            ? 'border-surface-border bg-surface-active/80 ring-1 ring-accent-steel/30'
            : 'border-surface-border bg-surface-panel'
        }`}
      >
        <div className="flex items-center justify-between text-xs font-mono">
          <div className="flex items-center space-x-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badgeColor}`}>
              {speakerLabel}
            </span>
            <span className="text-text-muted text-[11px] flex items-center space-x-1">
              <Clock className="h-3 w-3 inline mr-0.5" strokeWidth={1.5} />
              <span>{timeFormatted}</span>
            </span>
          </div>

          <div className="flex items-center space-x-3 text-[11px]">
            {isInterim ? (
              <span className="flex items-center space-x-1.5 text-accent-emerald font-semibold animate-pulse">
                <span className="h-2 w-2 rounded-full bg-accent-emerald" />
                <span>STREAMING INTERIM</span>
              </span>
            ) : (
              <div className="flex items-center space-x-2 text-text-secondary">
                <span>Avg Confidence:</span>
                <span
                  className={`font-semibold ${
                    utterance.averageConfidence >= 0.85
                      ? 'text-accent-emerald'
                      : utterance.averageConfidence >= 0.75
                        ? 'text-text-primary'
                        : 'text-accent-amber'
                  }`}
                >
                  {(utterance.averageConfidence * 100).toFixed(0)}%
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="text-sm font-sans leading-relaxed tracking-normal pl-0.5">
          {utterance.tokens.map((token) => renderToken(token))}
          {isInterim && (
            <span className="inline-block w-1.5 h-3.5 bg-accent-steel/70 ml-1 animate-pulse align-middle" />
          )}
        </div>
      </div>
    )
  }

  const getStatusBadge = (channel: string, status: string) => {
    switch (status) {
      case 'connected':
        return (
          <span className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono bg-accent-emerald/10 border border-accent-emerald/30 text-accent-emerald">
            <Wifi className="h-3 w-3" strokeWidth={2} />
            <span>{channel}: CONNECTED</span>
          </span>
        )
      case 'reconnecting':
        return (
          <span className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono bg-accent-amber/10 border border-accent-amber/30 text-accent-amber animate-pulse">
            <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={2} />
            <span>{channel}: RECONNECTING</span>
          </span>
        )
      case 'connecting':
        return (
          <span className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono bg-accent-steel/10 border border-accent-steel/30 text-accent-steel">
            <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={2} />
            <span>{channel}: CONNECTING</span>
          </span>
        )
      default:
        return (
          <span className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono bg-surface-border text-text-muted">
            <WifiOff className="h-3 w-3" strokeWidth={1.5} />
            <span>{channel}: IDLE</span>
          </span>
        )
    }
  }

  return (
    <div className="rounded-lg border border-surface-border bg-surface-panel p-4 space-y-4">
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-surface-border pb-3">
        <div className="flex items-center space-x-2.5">
          <Radio className="h-4 w-4 text-accent-steel" strokeWidth={1.5} />
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-primary">
              Live WebSocket Streaming STT Pipeline
            </h2>
            <p className="text-[11px] text-text-muted font-mono">
              Binary Linear16 PCM Stream | Sub-300ms Interim Word Events | Confidence Gating (<span className="text-accent-amber">0.75 threshold</span>)
            </p>
          </div>
        </div>

        {/* Telemetry and Connection Statuses */}
        <div className="flex items-center space-x-2">
          {getStatusBadge('CH A', sttStatusA)}
          {getStatusBadge('CH B', sttStatusB)}

          <div className="px-2 py-0.5 rounded text-[10px] font-mono bg-surface-base border border-surface-border text-text-secondary">
            <span>LATENCY: </span>
            <span className="text-accent-emerald font-semibold">{sttLatencyMs > 0 ? `${sttLatencyMs}ms` : '< 300ms'}</span>
          </div>

          <div className="px-2 py-0.5 rounded text-[10px] font-mono bg-surface-base border border-surface-border text-text-muted uppercase">
            {sttProvider}
          </div>

          {sttReconnectCount > 0 && (
            <div className="px-2 py-0.5 rounded text-[10px] font-mono bg-accent-amber/15 border border-accent-amber/30 text-accent-amber">
              {sttReconnectCount} RETRIES
            </div>
          )}
        </div>
      </div>

      {/* Action Verification Strip */}
      <div className="flex items-center justify-between text-xs font-mono bg-surface-base border border-surface-border p-2.5 rounded">
        <div className="flex items-center space-x-2">
          <span className="text-text-muted">DoD Verification Controls:</span>
          <button
            type="button"
            onClick={() => sendTestSpeechUtterance('channel_a')}
            className="px-2.5 py-1 rounded bg-accent-steel/15 text-accent-steel border border-accent-steel/30 hover:bg-accent-steel/25 transition flex items-center space-x-1.5"
          >
            <Volume2 className="h-3 w-3" strokeWidth={1.5} />
            <span>Test Mic Speech</span>
          </button>
          <button
            type="button"
            onClick={() => sendTestSpeechUtterance('channel_b')}
            className="px-2.5 py-1 rounded bg-accent-amber/15 text-accent-amber border border-accent-amber/30 hover:bg-accent-amber/25 transition flex items-center space-x-1.5"
          >
            <Volume2 className="h-3 w-3" strokeWidth={1.5} />
            <span>Test System Speech</span>
          </button>
          <button
            type="button"
            onClick={() => simulateSocketDrop()}
            className="px-2.5 py-1 rounded bg-surface-panel text-text-secondary border border-surface-border hover:bg-surface-active hover:text-text-primary transition flex items-center space-x-1.5"
            title="Disconnect socket to verify exponential backoff auto-reconnection"
          >
            <RefreshCw className="h-3 w-3" strokeWidth={1.5} />
            <span>Simulate Network Drop</span>
          </button>
        </div>

        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={clearTranscripts}
            disabled={utterances.length === 0 && !interimTranscriptA && !interimTranscriptB}
            className="text-text-muted hover:text-text-primary disabled:opacity-40 transition flex items-center space-x-1"
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.5} />
            <span>Clear Feed</span>
          </button>
        </div>
      </div>

      {/* Feed Container */}
      <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
        {/* Active Interim Utterance A (Mic) */}
        {interimTranscriptA && renderUtteranceCard(interimTranscriptA, true)}

        {/* Active Interim Utterance B (System) */}
        {interimTranscriptB && renderUtteranceCard(interimTranscriptB, true)}

        {/* Committed Final Utterances */}
        {utterances.slice().reverse().map((utterance) => renderUtteranceCard(utterance, false))}

        {/* Empty State */}
        {utterances.length === 0 && !interimTranscriptA && !interimTranscriptB && (
          <div className="rounded-lg border border-dashed border-surface-border p-8 text-center space-y-2">
            <Sparkles className="h-5 w-5 text-text-muted mx-auto" strokeWidth={1.5} />
            <p className="text-xs font-mono text-text-secondary">
              {isAudioActive
                ? 'Speech-to-Text WebSocket engine active. Speak into your microphone or trigger a test utterance above.'
                : 'Audio engine currently idle. Click "START AUDIO INGESTION" or use the test buttons above to stream speech.'}
            </p>
            <p className="text-[11px] text-text-muted">
              Word-by-word streaming will render in real time. Tokens under 0.75 confidence are highlighted with a discrete dotted underline.
            </p>
          </div>
        )}
      </div>

      {/* Legend & Compliance Footer */}
      <div className="flex items-center justify-between text-[11px] font-mono text-text-muted border-t border-surface-border-subtle pt-2">
        <div className="flex items-center space-x-2">
          <AlertCircle className="h-3 w-3 text-accent-amber inline" strokeWidth={1.5} />
          <span>
            <span className="border-b border-dotted border-accent-amber text-amber-200">Dotted underline</span> = low-confidence token (&lt; 0.75 score).
          </span>
        </div>
        <div>
          <span>Target Interim Latency: &lt; 300ms | Socket Protocol: RFC 6455 Binary</span>
        </div>
      </div>
    </div>
  )
}
