import React from 'react'
import { CheckCircle2 } from 'lucide-react'
import { SessionProvider } from './context/SessionContext'
import { Header } from './components/Header/Header'
import { SubHeader } from './components/SubHeader/SubHeader'
import { GlossaryModal } from './components/Modals/GlossaryModal'
import { DualPaneWorkspace } from './components/Workspace/DualPaneWorkspace'

const WorkspaceContent: React.FC = () => {
  return (
    <div className="flex h-screen w-screen flex-col bg-surface-base text-text-primary select-none overflow-hidden font-sans">
      {/* ZONE 1: TOP GLOBAL HEADER */}
      <Header />

      {/* ZONE 2: SUB-HEADER & HARDWARE VU METERS */}
      <SubHeader />

      {/* ZONE 3: DUAL-PANE SPLIT WORKSPACE & VIRTUALIZED FEED */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <DualPaneWorkspace />
      </main>

      {/* FOOTER STATUS BAR */}
      <footer className="flex h-9 items-center justify-between border-t border-surface-border bg-surface-panel px-4 font-mono text-xs text-text-secondary select-none">
        <div className="flex items-center space-x-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-accent-emerald" strokeWidth={1.5} />
          <span>DAY 08 COMPLETE: ZONE 3 DUAL-PANE SPLIT WORKSPACE & VIRTUALIZED FEED VERIFIED</span>
        </div>
        <div className="flex items-center space-x-4 text-text-muted">
          <span>NEXT: DAY-09 ZONE 4 MASTER TOOLBAR, COUGH/MUTE BUFFER & STATE MACHINE</span>
          <span className="h-3 w-px bg-surface-border" />
          <span>ZERO EMOJIS ENFORCED</span>
        </div>
      </footer>

      {/* Modals */}
      <GlossaryModal />
    </div>
  )
}

export function App(): React.JSX.Element {
  return (
    <SessionProvider>
      <WorkspaceContent />
    </SessionProvider>
  )
}

export default App
