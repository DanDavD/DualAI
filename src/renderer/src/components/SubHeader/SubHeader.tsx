import React from 'react'
import { ArrowRightLeft } from 'lucide-react'
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
    swapLanguages
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

      {/* Right Cluster: Layout Menu and Text & Colors Menu */}
      <div className="flex items-center space-x-2">
        <WorkspaceLayoutPopover />
        <TextPersonalizationPopover />
      </div>
    </div>
  )
}
