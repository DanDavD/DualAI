import React from 'react'
import { ArrowRightLeft, Zap, CheckCheck } from 'lucide-react'
import { LanguageSelector } from './LanguageSelector'
import { HardwareVuMeter } from './HardwareVuMeter'
import { useSession } from '../../context/SessionContext'
import { LatencyMode } from '../../../../types/audio'

export const SubHeader: React.FC = () => {
  const {
    sourceLang,
    targetLang,
    setSourceLang,
    setTargetLang,
    swapLanguages,
    latencyMode,
    setLatencyMode
  } = useSession()

  return (
    <div className="flex h-11 w-full shrink-0 items-center justify-between border-b border-surface-border bg-surface-base px-3 select-none">
      {/* Left Cluster: Source Language + Channel A VU Meter */}
      <div className="flex items-center space-x-2">
        <LanguageSelector
          label="Source Language"
          selectedCode={sourceLang}
          onSelectLanguage={setSourceLang}
        />

        <HardwareVuMeter channelLabel="CH A - IN" isActive={true} />
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

      {/* Right Cluster: Channel B VU Meter + Target Language + Latency Mode Switch */}
      <div className="flex items-center space-x-2">
        <HardwareVuMeter channelLabel="CH B - OUT" isActive={true} />

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
            title="Sentence-Accurate: VAD-segmented clauses for maximal semantic accuracy"
          >
            <CheckCheck className="h-3 w-3 text-accent-emerald" strokeWidth={1.5} />
            <span>Sentence-Accurate</span>
          </button>
        </div>
      </div>
    </div>
  )
}
