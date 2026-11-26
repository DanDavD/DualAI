import React from 'react'
import { SessionProvider } from './context/SessionContext'
import { Header } from './components/Header/Header'
import { DualPaneWorkspace } from './components/Workspace/DualPaneWorkspace'
import { FloatingTransportPill } from './components/Footer/FloatingTransportPill'
import { GlossaryModal } from './components/Modals/GlossaryModal'
import { SettingsModal } from './components/Modals/SettingsModal'
import { AccountPlanModal } from './components/Modals/AccountPlanModal'

const WorkspaceContent: React.FC = () => {
  return (
    <div className="app-window-canvas relative flex h-screen w-screen flex-col text-text-primary select-none overflow-hidden font-sans">
      {/* UNIFIED APPLE LIQUID GLASS TOP COMMAND BAR */}
      <Header />

      {/* 100% FULL-HEIGHT READING & TRANSLATION CANVAS */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <DualPaneWorkspace />
      </main>

      {/* FLOATING BOTTOM-RIGHT LIQUID GLASS START/STOP & MUTE PILL */}
      <FloatingTransportPill />

      {/* MACOS LIQUID GLASS SHEETS: GLOSSARY, SETTINGS & ACCOUNT */}
      <GlossaryModal />
      <SettingsModal />
      <AccountPlanModal />
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
