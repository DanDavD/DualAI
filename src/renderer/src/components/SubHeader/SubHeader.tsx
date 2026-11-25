import React from 'react'
import { ArrowRightLeft, Zap } from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { LanguageSelector } from './LanguageSelector'
import { WorkspaceLayoutPopover } from './WorkspaceLayoutPopover'
import { TextPersonalizationPopover } from './TextPersonalizationPopover'

export const SubHeader: React.FC = () => {
  const {
    sourceLang,
    setSourceLang,
    targetLang,
    setTargetLang,
    swapLanguages,
    latencyMode,
    setLatencyMode
  } = useSession()

  return (
    <div className="flex h-10 w-full shrink-0 items-center justify-between border-b border-surface-border bg-surface-base px-4 select-none">
      {/* Left Cluster: Clean Language Pair Controls */}
      <div className="flex items-center space-x-2.5">
        <LanguageSelector
          label="Source Language"
          selectedCode={sourceLang}
          onSelectLanguage={setSourceLang}
        />

        <button
          type="button"
          onClick={swapLanguages}
          className="flex h-7 w-7 items-center justify-center rounded border border-surface-border bg-surface-panel text-text-secondary hover:bg-surface-active hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-steel transition"
          title="Swap Source and Target Languages (Cmd/Ctrl + Shift + S)"
          aria-label="Swap Source and Target Languages"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>

        <LanguageSelector
          label="Target Language"
          selectedCode={targetLang}
          onSelectLanguage={setTargetLang}
        />
      </div>

      {/* Right Cluster: Separate Layout Menu, Text & Colors Menu, and Live / Accurate Toggle */}
      <div className="flex items-center space-x-2">
        <WorkspaceLayoutPopover />
        <TextPersonalizationPopover />

        <div
          role="radiogroup"
          aria-label="Audio Latency Precision Mode"
          className="flex h-7 items-center rounded border border-surface-border bg-surface-panel p-0.5"
        >
          <button
            type="button"
            role="radio"
            aria-checked={latencyMode === 'sub_second_live'}
            onClick={() => setLatencyMode('sub_second_live')}
            className={`flex h-full items-center space-x-1 rounded px-2 text-[11px] font-medium transition focus:outline-none ${
              latencyMode === 'sub_second_live'
                ? 'bg-surface-active text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
            title="Live mode: streams progressive draft translation while speaking, then finalizes after a 2-second pause"
          >
            <Zap className="h-3 w-3 text-accent-amber" strokeWidth={1.5} />
            <span>Live</span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={latencyMode === 'sentence_accurate'}
            onClick={() => setLatencyMode('sentence_accurate')}
            className={`flex h-full items-center rounded px-2 text-[11px] font-medium transition focus:outline-none ${
              latencyMode === 'sentence_accurate'
                ? 'bg-surface-active text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
            title="Accurate mode: accumulates the full paragraph until a 2-second pause before translating"
          >
            <span>Accurate</span>
          </button>
        </div>
      </div>
    </div>
  )
}
