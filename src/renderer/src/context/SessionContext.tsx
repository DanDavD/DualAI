import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { AudioRouteMode, OperatingMode, LatencyMode, AudioLevelMetric } from '../../../types/audio'
import { DomainId } from '../../../types/domain'
import { AudioIngestionEngine } from '../audio/AudioIngestionEngine'

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

  // Audio Engine State
  isAudioActive: boolean
  gainChannelA: number
  gainChannelB: number
  levelMetricA: AudioLevelMetric | null
  levelMetricB: AudioLevelMetric | null
  bufferSamplesA: number
  bufferSamplesB: number

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

  // Audio Engine Actions
  startAudioEngine: () => Promise<void>
  stopAudioEngine: () => void
  setGainChannelA: (gain: number) => void
  setGainChannelB: (gain: number) => void
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

  // Audio Engine Ingestion State
  const [isAudioActive, setIsAudioActive] = useState(false)
  const [gainChannelA, setGainChannelAState] = useState(1.0)
  const [gainChannelB, setGainChannelBState] = useState(1.0)
  const [levelMetricA, setLevelMetricA] = useState<AudioLevelMetric | null>(null)
  const [levelMetricB, setLevelMetricB] = useState<AudioLevelMetric | null>(null)
  const [bufferSamplesA, setBufferSamplesA] = useState(0)
  const [bufferSamplesB, setBufferSamplesB] = useState(0)

  const engineRef = useRef<AudioIngestionEngine | null>(null)

  // Initialize Audio Ingestion Engine
  useEffect(() => {
    const engine = new AudioIngestionEngine({
      onLevelMetric: (metric) => {
        if (metric.channelId === 'channel_a') {
          setLevelMetricA(metric)
        } else {
          setLevelMetricB(metric)
        }
      },
      onPcmChunk: (channelId) => {
        if (engineRef.current) {
          const status = engineRef.current.getBufferStatus(channelId)
          if (channelId === 'channel_a') {
            setBufferSamplesA(status.available)
          } else {
            setBufferSamplesB(status.available)
          }
        }
      },
      onDeviceDisconnected: (event) => {
        console.warn('[DUALAI] Audio hardware configuration changed:', event)
      },
      onError: (err) => {
        console.error('[DUALAI] Audio Engine error:', err)
        setIsAudioActive(false)
      }
    })

    engineRef.current = engine

    return () => {
      engine.stop()
    }
  }, [])

  // Start Audio Ingestion
  const startAudioEngine = useCallback(async () => {
    if (!engineRef.current) return
    try {
      await engineRef.current.start({
        noiseSuppression,
        echoCancellation,
        gainA: gainChannelA,
        gainB: gainChannelB
      })
      setIsAudioActive(true)
    } catch (err) {
      console.error('[DUALAI] Failed to start audio engine:', err)
      setIsAudioActive(false)
    }
  }, [noiseSuppression, echoCancellation, gainChannelA, gainChannelB])

  // Stop Audio Ingestion
  const stopAudioEngine = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.stop()
      setIsAudioActive(false)
      setLevelMetricA(null)
      setLevelMetricB(null)
      setBufferSamplesA(0)
      setBufferSamplesB(0)
    }
  }, [])

  // Hardware Gain Multipliers with smooth adjustment
  const setGainChannelA = useCallback((gain: number) => {
    setGainChannelAState(gain)
    engineRef.current?.setGain('channel_a', gain)
  }, [])

  const setGainChannelB = useCallback((gain: number) => {
    setGainChannelBState(gain)
    engineRef.current?.setGain('channel_b', gain)
  }, [])

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
        isAudioActive,
        gainChannelA,
        gainChannelB,
        levelMetricA,
        levelMetricB,
        bufferSamplesA,
        bufferSamplesB,
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
        closeSettingsModal,
        startAudioEngine,
        stopAudioEngine,
        setGainChannelA,
        setGainChannelB
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
