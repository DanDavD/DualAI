import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { AudioRouteMode, OperatingMode, LatencyMode, AudioLevelMetric, ChannelId } from '../../../types/audio'
import { DomainId } from '../../../types/domain'
import { TranscriptUtterance, SttConnectionState } from '../../../types/stt'
import { TranslationResult } from '../../../types/translation'
import { AudioIngestionEngine } from '../audio/AudioIngestionEngine'
import { StreamingSttManager } from '../audio/stt/StreamingSttManager'
import { TranslationManager } from '../translation/TranslationManager'

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

  // Silero VAD State
  isVadReady: boolean
  vadProbabilityA: number
  vadProbabilityB: number
  isSpeechActiveA: boolean
  isSpeechActiveB: boolean
  vadLatencyMs: number
  vadThreshold: number
  speechEventsCountA: number
  speechEventsCountB: number

  // Streaming STT State
  sttStatusA: SttConnectionState
  sttStatusB: SttConnectionState
  sttLatencyMs: number
  sttProvider: 'deepgram-nova-2' | 'whisper-turbo' | 'simulated-stt'
  sttReconnectCount: number
  utterances: TranscriptUtterance[]
  interimTranscriptA: TranscriptUtterance | null
  interimTranscriptB: TranscriptUtterance | null

  // Real-Time Domain Inference (Gemini 2.0 Flash) State
  translations: TranslationResult[]
  activeTranslation: TranslationResult | null
  translationLatencyMs: number
  endToEndLatencyMs: number
  translationProvider: 'gemini-2.0-flash' | 'simulated-gemini'

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
  setVadThreshold: (threshold: number) => void

  // STT Actions
  clearTranscripts: () => void
  simulateSocketDrop: (channelId?: ChannelId) => void
  sendTestSpeechUtterance: (channelId: ChannelId, phrase?: string) => void

  // Translation Actions
  clearTranslations: () => void
  triggerDomainTestTranslation: (domainOverride?: DomainId, phraseOverride?: string) => Promise<void>
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

  // Silero VAD State
  const [isVadReady, setIsVadReady] = useState(false)
  const [vadProbabilityA, setVadProbabilityA] = useState(0)
  const [vadProbabilityB, setVadProbabilityB] = useState(0)
  const [isSpeechActiveA, setIsSpeechActiveA] = useState(false)
  const [isSpeechActiveB, setIsSpeechActiveB] = useState(false)
  const [vadLatencyMs, setVadLatencyMs] = useState(0)
  const [vadThreshold, setVadThresholdState] = useState(0.5)
  const [speechEventsCountA, setSpeechEventsCountA] = useState(0)
  const [speechEventsCountB, setSpeechEventsCountB] = useState(0)

  // Streaming STT State
  const [sttStatusA, setSttStatusA] = useState<SttConnectionState>('disconnected')
  const [sttStatusB, setSttStatusB] = useState<SttConnectionState>('disconnected')
  const [sttLatencyMs, setSttLatencyMs] = useState(0)
  const [sttProvider, setSttProvider] = useState<'deepgram-nova-2' | 'whisper-turbo' | 'simulated-stt'>('simulated-stt')
  const [sttReconnectCount, setSttReconnectCount] = useState(0)
  const [utterances, setUtterances] = useState<TranscriptUtterance[]>([])
  const [interimTranscriptA, setInterimTranscriptA] = useState<TranscriptUtterance | null>(null)
  const [interimTranscriptB, setInterimTranscriptB] = useState<TranscriptUtterance | null>(null)

  // Real-Time Domain Inference (Gemini 2.0 Flash) State
  const [translations, setTranslations] = useState<TranslationResult[]>([])
  const [activeTranslation, setActiveTranslation] = useState<TranslationResult | null>(null)
  const [translationLatencyMs, setTranslationLatencyMs] = useState(0)
  const [endToEndLatencyMs, setEndToEndLatencyMs] = useState(0)
  const [translationProvider, setTranslationProvider] = useState<'gemini-2.0-flash' | 'simulated-gemini'>('simulated-gemini')

  const engineRef = useRef<AudioIngestionEngine | null>(null)
  const sttManagerRef = useRef<StreamingSttManager | null>(null)
  const translationManagerRef = useRef<TranslationManager | null>(null)

  // Initialize Real-Time Domain Translation Engine
  useEffect(() => {
    const tm = new TranslationManager({
      onTranslationStart: (result) => {
        setActiveTranslation(result)
      },
      onTranslationToken: (_token, accumulatedText) => {
        setActiveTranslation((prev) => (prev ? { ...prev, translatedText: accumulatedText } : null))
      },
      onTranslationComplete: (result) => {
        setActiveTranslation(null)
        setTranslations((prev) => [...prev.slice(-99), result])
      },
      onTelemetry: (telemetry) => {
        setTranslationLatencyMs(telemetry.timeToFirstTokenMs)
        setEndToEndLatencyMs(telemetry.endToEndLatencyMs)
        setTranslationProvider(telemetry.provider)
      },
      onError: (err) => {
        console.warn('[DUALAI-SESSION] Translation Error:', err)
        setActiveTranslation(null)
      }
    })

    translationManagerRef.current = tm

    return () => {
      tm.cancelActive()
    }
  }, [])

  // Initialize Streaming STT Manager
  useEffect(() => {
    const stt = new StreamingSttManager(
      {
        onInterimTranscript: (utterance) => {
          if (utterance.channelId === 'channel_a') {
            setInterimTranscriptA(utterance)
          } else {
            setInterimTranscriptB(utterance)
          }
        },
        onFinalTranscript: (utterance) => {
          if (utterance.channelId === 'channel_a') {
            setInterimTranscriptA(null)
          } else {
            setInterimTranscriptB(null)
          }
          setUtterances((prev) => [...prev.slice(-99), utterance])

          // Trigger streaming domain translation immediately upon speech pause
          const target = utterance.channelId === 'channel_a' ? targetLang : sourceLang
          translationManagerRef.current?.translateUtterance(utterance, domainId, target)
        },
        onConnectionChange: (channelId, state) => {
          if (channelId === 'channel_a') {
            setSttStatusA(state)
          } else {
            setSttStatusB(state)
          }
        },
        onTelemetry: (telemetry) => {
          setSttLatencyMs(telemetry.latencyMs)
          setSttProvider(telemetry.provider)
          setSttReconnectCount((prev) => Math.max(prev, telemetry.reconnectCount))
        },
        onError: (channelId, err) => {
          console.warn(`[DUALAI] STT Error on ${channelId}:`, err)
        }
      },
      {
        domainId,
        confidenceThreshold: 0.75
      }
    )

    sttManagerRef.current = stt
    stt.updateLanguages(sourceLang, targetLang)

    return () => {
      stt.stop()
    }
  }, [domainId, sourceLang, targetLang])

  // Sync language and domain changes with STT Manager
  useEffect(() => {
    sttManagerRef.current?.updateLanguages(sourceLang, targetLang)
  }, [sourceLang, targetLang])

  useEffect(() => {
    sttManagerRef.current?.updateDomain(domainId)
  }, [domainId])

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
      onVadTelemetry: (channelId, prob, isSpeech, latencyMs) => {
        if (channelId === 'channel_a') {
          setVadProbabilityA(prob)
          setIsSpeechActiveA(isSpeech)
        } else {
          setVadProbabilityB(prob)
          setIsSpeechActiveB(isSpeech)
        }
        setVadLatencyMs(latencyMs)
      },
      onSpeechStart: (event, preSpeechPcm) => {
        if (event.channelId === 'channel_a') {
          setSpeechEventsCountA((prev) => prev + 1)
        } else {
          setSpeechEventsCountB((prev) => prev + 1)
        }
        // Forward pre-speech padding buffer directly to STT client to protect plosive consonants
        sttManagerRef.current?.sendAudio(event.channelId, preSpeechPcm)
      },
      onSpeechFrame: (channelId, pcmData) => {
        // Continuous speech frame forwarding during active speech
        sttManagerRef.current?.sendAudio(channelId, pcmData)
      },
      onSpeechEnd: (event) => {
        // Dispatched upon silence hangover expiration
        sttManagerRef.current?.signalSpeechEnd(event.channelId)
      },
      onVadStatusChange: (status) => {
        setIsVadReady(status === 'ready')
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

  // Start Audio Ingestion & WebSocket STT Pipeline
  const startAudioEngine = useCallback(async () => {
    if (!engineRef.current) return
    try {
      await engineRef.current.start({
        noiseSuppression,
        echoCancellation,
        gainA: gainChannelA,
        gainB: gainChannelB
      })
      sttManagerRef.current?.start()
      setIsAudioActive(true)
    } catch (err) {
      console.error('[DUALAI] Failed to start audio engine:', err)
      setIsAudioActive(false)
    }
  }, [noiseSuppression, echoCancellation, gainChannelA, gainChannelB])

  // Stop Audio Ingestion & Terminate Sockets cleanly
  const stopAudioEngine = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.stop()
      setIsAudioActive(false)
      setLevelMetricA(null)
      setLevelMetricB(null)
      setBufferSamplesA(0)
      setBufferSamplesB(0)
      setVadProbabilityA(0)
      setVadProbabilityB(0)
      setIsSpeechActiveA(false)
      setIsSpeechActiveB(false)
    }
    // Clean socket termination
    sttManagerRef.current?.stop()
    translationManagerRef.current?.cancelActive()
    setSttStatusA('disconnected')
    setSttStatusB('disconnected')
    setInterimTranscriptA(null)
    setInterimTranscriptB(null)
    setActiveTranslation(null)
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

  const setVadThreshold = useCallback((threshold: number) => {
    setVadThresholdState(threshold)
    engineRef.current?.setVadThreshold(threshold)
  }, [])

  // Translation Actions
  const clearTranslations = useCallback(() => {
    setTranslations([])
    setActiveTranslation(null)
    translationManagerRef.current?.clearHistory()
  }, [])

  const triggerDomainTestTranslation = useCallback(async (domainOverride?: DomainId, phraseOverride?: string) => {
    const effectiveDomain = domainOverride || domainId
    let testPhrase = phraseOverride
    if (!testPhrase) {
      if (effectiveDomain === 'medical') {
        testPhrase = 'Patient presents with acute dyspnea and tachycardia following antibiotic administration.'
      } else if (effectiveDomain === 'legal') {
        testPhrase = 'The party of the first part hereby agrees to indemnify and hold harmless the licensee.'
      } else if (effectiveDomain === 'technical') {
        testPhrase = 'WebSocket connection initialized with binary ArrayBuffer linear16 stream.'
      } else if (effectiveDomain === 'business') {
        testPhrase = 'Quarterly earnings report indicates sixteen percent growth in enterprise subscriptions.'
      } else {
        testPhrase = 'Welcome to the bilingual conference interpretation session.'
      }
    }

    const testUtterance: TranscriptUtterance = {
      id: `test-${Date.now()}`,
      channelId: 'channel_a',
      speakerLabel: 'Channel A (Mic)',
      language: sourceLang,
      text: testPhrase,
      tokens: testPhrase.split(' ').map((w, idx) => ({
        id: `tok-${idx}`,
        text: w,
        confidence: 0.96,
        isLowConfidence: false,
        startTimeMs: idx * 120,
        endTimeMs: (idx + 1) * 120
      })),
      isFinal: true,
      timestampMs: Date.now(),
      durationMs: testPhrase.split(' ').length * 120,
      averageConfidence: 0.96,
      receivedAtMs: Date.now()
    }

    setUtterances((prev) => [...prev.slice(-99), testUtterance])
    await translationManagerRef.current?.translateUtterance(testUtterance, effectiveDomain, targetLang)
  }, [domainId, sourceLang, targetLang])

  // STT Pipeline Actions
  const clearTranscripts = useCallback(() => {
    setUtterances([])
    setInterimTranscriptA(null)
    setInterimTranscriptB(null)
    clearTranslations()
  }, [clearTranslations])

  const simulateSocketDrop = useCallback((channelId?: ChannelId) => {
    sttManagerRef.current?.simulateNetworkDrop(channelId)
  }, [])

  const sendTestSpeechUtterance = useCallback((channelId: ChannelId, phrase?: string) => {
    sttManagerRef.current?.triggerTestUtterance(channelId, phrase)
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
        isVadReady,
        vadProbabilityA,
        vadProbabilityB,
        isSpeechActiveA,
        isSpeechActiveB,
        vadLatencyMs,
        vadThreshold,
        speechEventsCountA,
        speechEventsCountB,
        sttStatusA,
        sttStatusB,
        sttLatencyMs,
        sttProvider,
        sttReconnectCount,
        utterances,
        interimTranscriptA,
        interimTranscriptB,
        translations,
        activeTranslation,
        translationLatencyMs,
        endToEndLatencyMs,
        translationProvider,
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
        setGainChannelB,
        setVadThreshold,
        clearTranscripts,
        simulateSocketDrop,
        sendTestSpeechUtterance,
        clearTranslations,
        triggerDomainTestTranslation
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
