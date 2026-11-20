import React from 'react'
import { ArrowRightLeft, Zap } from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { LanguageSelector } from './LanguageSelector'
import { HardwareVuMeter } from './HardwareVuMeter'

export const SubHeader: React.FC = () => {
  const {
    sourceLang,
    setSourceLang,
    targetLang,
    setTargetLang,
    swapLanguages,
    latencyMode,
    setLatencyMode,
    isAudioActive,
    levelMetricA,
    levelMetricB,
    isSpeechActiveA,
    isSpeechActiveB,
    vadProbabilityA,
    vadProbabilityB
  } = useSession()

  return (
    <div className="flex h-11 w-full shrink-0 items-center justify-between border-b border-surface-border bg-surface-base px-3 select-none">
      {/* Left Cluster: Source Language + Channel A VU Meter + VAD Indicator */}
      <div className="flex items-center space-x-2">
        <LanguageSelector
          label="Source Language"
          selectedCode={sourceLang}
          onSelectLanguage={setSourceLang}
        />

        <HardwareVuMeter
          channelLabel="CH A - IN"
          isActive={isAudioActive}
          peakDb={levelMetricA ? levelMetricA.peakDb : undefined}
        />

        <div
          className="flex items-center space-x-1.5 px-2 py-1 rounded border border-surface-border bg-surface-panel"
          title={`Channel A VAD Speech Probability: ${(vadProbabilityA * 100).toFixed(0)}%`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full transition-colors ${
              isSpeechActiveA ? 'bg-accent-emerald ring-2 ring-accent-emerald/30' : 'bg-surface-border'
            }`}
          />
          <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
            VAD {isSpeechActiveA ? 'VOICE' : 'IDLE'}
          </span>
        </div>
      </div>

      {/* Center Cluster: Swap Languages Trigger */}
      <div className="flex items-center space-x-3">
        <button
          type="button"
          onClick={swapLanguages}
          className="flex h-8 items-center space-x-1.5 rounded border border-surface-border bg-surface-panel px-2.5 text-xs text-text-secondary hover:bg-surface-active hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-steel transition shadow-sm"
          title="Swap Source and Target Languages (Cmd/Ctrl + Shift + S)"
        >
          <ArrowRightLeft className="h-3.5 w-3.5 text-accent-steel" strokeWidth={1.5} />
          <span className="font-mono text-[11px] font-medium text-text-primary">Swap</span>
          <kbd className="hidden sm:inline-block ml-1 rounded border border-surface-border bg-surface-base px-1 font-mono text-[9px] text-text-muted">
            ⌘+⇧+S
          </kbd>
        </button>
      </div>

      {/* Right Cluster: Channel B VAD + Channel B VU Meter + Target Language + Latency Mode Switch */}
      <div className="flex items-center space-x-2">
        <div
          className="flex items-center space-x-1.5 px-2 py-1 rounded border border-surface-border bg-surface-panel"
          title={`Channel B VAD Speech Probability: ${(vadProbabilityB * 100).toFixed(0)}%`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full transition-colors ${
              isSpeechActiveB ? 'bg-accent-amber ring-2 ring-accent-amber/30' : 'bg-surface-border'
            }`}
          />
          <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
            VAD {isSpeechActiveB ? 'VOICE' : 'IDLE'}
          </span>
        </div>

        <HardwareVuMeter
          channelLabel="CH B - OUT"
          isActive={isAudioActive}
          peakDb={levelMetricB ? levelMetricB.peakDb : undefined}
        />

        <LanguageSelector
          label="Target Language"
          selectedCode={targetLang}
          onSelectLanguage={setTargetLang}
        />

        <span className="h-4 w-px bg-surface-border mx-1" />

        {/* Global Audio Latency Mode Switch */}
        <div
          role="radiogroup"
          aria-label="Audio Latency Precision Mode"
          className="flex h-8 items-center rounded border border-surface-border bg-surface-panel p-0.5"
        >
          <button
            type="button"
            role="radio"
            aria-checked={latencyMode === 'sub_second_live'}
            onClick={() => setLatencyMode('sub_second_live')}
            className={`flex h-full items-center space-x-1 rounded px-2 text-[11px] font-mono transition focus:outline-none ${
              latencyMode === 'sub_second_live'
                ? 'bg-surface-active text-text-primary shadow-sm border border-surface-border font-medium'
                : 'text-text-muted hover:text-text-secondary'
            }`}
            title="Sub-Second Live: Chunked streaming optimized for immediate turnaround (< 300ms)"
          >
            <Zap className="h-3 w-3 text-accent-amber" strokeWidth={1.5} />
            <span>Sub-Second Live</span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={latencyMode === 'sentence_accurate'}
            onClick={() => setLatencyMode('sentence_accurate')}
            className={`flex h-full items-center space-x-1 rounded px-2 text-[11px] font-mono transition focus:outline-none ${
              latencyMode === 'sentence_accurate'
                ? 'bg-surface-active text-text-primary shadow-sm border border-surface-border font-medium'
                : 'text-text-muted hover:text-text-secondary'
            }`}
            title="Sentence-Accurate: Full clause interpretation optimized for linguistic context"
          >
            <span>Sentence-Accurate</span>
          </button>
        </div>
      </div>
    </div>
  )
}
