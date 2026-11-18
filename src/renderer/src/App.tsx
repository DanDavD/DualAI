import React from 'react'
import { Sparkles } from 'lucide-react'

export function App(): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-950 text-slate-100 select-none">
      <div className="flex flex-col items-center space-y-4 text-center p-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-xl shadow-blue-500/20">
          <Sparkles className="h-7 w-7 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-300 to-white bg-clip-text text-transparent">
            DualAI
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Core setup ready. Ready to build step-by-step.
          </p>
        </div>
        <div className="inline-flex items-center space-x-2 rounded-full border border-slate-800 bg-slate-900/60 px-3.5 py-1 text-xs text-slate-400 font-mono">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Electron + Vite + React 19 + TypeScript</span>
        </div>
      </div>
    </div>
  )
}

export default App
