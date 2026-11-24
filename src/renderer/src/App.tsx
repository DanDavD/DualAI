import React from 'react'
import { SessionProvider } from './context/SessionContext'
import { Header } from './components/Header/Header'
import { SubHeader } from './components/SubHeader/SubHeader'
import { DualPaneWorkspace } from './components/Workspace/DualPaneWorkspace'
import { MasterToolbar } from './components/Footer/MasterToolbar'
import { GlossaryModal } from './components/Modals/GlossaryModal'
import { SettingsModal } from './components/Modals/SettingsModal'

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

      {/* ZONE 4: MASTER TOOLBAR, COUGH/MUTE BUFFER & STATE MACHINE */}
      <MasterToolbar />

      {/* MODALS: MODULE 4 CONFIGURATION MATRIX & CUSTOM GLOSSARY ENGINE */}
      <GlossaryModal />
      <SettingsModal />
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
