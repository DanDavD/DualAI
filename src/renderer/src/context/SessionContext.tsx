import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { AudioRouteMode, OperatingMode, LatencyMode } from '../../../types/audio'
import { DomainId } from '../../../types/domain'

export interface SessionState {
  audioRoute: AudioRouteMode
  operatingMode: OperatingMode
  domainId: DomainId
  sourceLang: string
  targetLang: string
  latencyMode: LatencyMode
  noiseSuppression: boolean
  echoCancellation: boolean
  latencyPingMs: number
  quotaTotalHours: number
  quotaRemainingHours: number
  isGlossaryModalOpen: boolean
  isSettingsModalOpen: boolean

  // Actions
  setAudioRoute: (route: AudioRouteMode) => void
  setOperatingMode: (mode: OperatingMode) => void
  setDomainId: (domain: DomainId) => void
  setSourceLang: (lang: string) => void
  setTargetLang: (lang: string) => void
  swapLanguages: () => void
  setLatencyMode: (mode: LatencyMode) => void
  setNoiseSuppression: (enabled: boolean) => void
  setEchoCancellation: (enabled: boolean) => void
  openGlossaryModal: () => void
  closeGlossaryModal: () => void
  openSettingsModal: () => void
  closeSettingsModal: () => void
}

const SessionContext = createContext<SessionState | null>(null)

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [audioRoute, setAudioRoute] = useState<AudioRouteMode>('bilateral')
  const [operatingMode, setOperatingMode] = useState<OperatingMode>('conversation')
  const [domainId, setDomainId] = useState<DomainId>('medical')
  const [sourceLang, setSourceLang] = useState('en')
  const [targetLang, setTargetLang] = useState('es')
  const [latencyMode, setLatencyMode] = useState<LatencyMode>('sub_second_live')
  const [noiseSuppression, setNoiseSuppression] = useState(true)
  const [echoCancellation, setEchoCancellation] = useState(true)
  const [latencyPingMs, setLatencyPingMs] = useState(42)
  const [quotaTotalHours] = useState(100)
  const [quotaRemainingHours] = useState(67.36)
  const [isGlossaryModalOpen, setIsGlossaryModalOpen] = useState(false)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)

  // 5-second simulated telemetry ping polling
  useEffect(() => {
    const pollInterval = setInterval(() => {
      const basePing = latencyMode === 'sub_second_live' ? 38 : 74
      const jitter = Math.floor(Math.random() * 10) - 5
      setLatencyPingMs(Math.max(20, basePing + jitter))
    }, 5000)

    return () => clearInterval(pollInterval)
  }, [latencyMode])

  // Swap Source and Target Languages cleanly
  const swapLanguages = useCallback(() => {
    setSourceLang((prevSource) => {
      setTargetLang(prevSource)
      return targetLang
    })
  }, [targetLang])

  // Listen to Global Native Shortcut (Cmd/Ctrl + Shift + S) via Preload Bridge
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI?.onShortcutSwapLanguages) {
      const cleanup = window.electronAPI.onShortcutSwapLanguages(() => {
        swapLanguages()
      })
      return cleanup
    }
    return undefined
  }, [swapLanguages])

  const openGlossaryModal = useCallback(() => setIsGlossaryModalOpen(true), [])
  const closeGlossaryModal = useCallback(() => setIsGlossaryModalOpen(false), [])
  const openSettingsModal = useCallback(() => setIsSettingsModalOpen(true), [])
  const closeSettingsModal = useCallback(() => setIsSettingsModalOpen(false), [])

  return (
    <SessionContext.Provider
      value={{
        audioRoute,
        operatingMode,
        domainId,
        sourceLang,
        targetLang,
        latencyMode,
        noiseSuppression,
        echoCancellation,
        latencyPingMs,
        quotaTotalHours,
        quotaRemainingHours,
        isGlossaryModalOpen,
        isSettingsModalOpen,
        setAudioRoute,
        setOperatingMode,
        setDomainId,
        setSourceLang,
        setTargetLang,
        swapLanguages,
        setLatencyMode,
        setNoiseSuppression,
        setEchoCancellation,
        openGlossaryModal,
        closeGlossaryModal,
        openSettingsModal,
        closeSettingsModal
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export function useSession(): SessionState {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return context
}
