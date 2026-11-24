import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo
} from 'react'
import {
  AudioRouteMode,
  OperatingMode,
  LatencyMode,
  AudioLevelMetric,
  ChannelId
} from '../../../types/audio'
import { DomainId } from '../../../types/domain'
import { TranscriptUtterance, SttConnectionState } from '../../../types/stt'
import { TranslationResult } from '../../../types/translation'
import {
  HudSettings,
  DEFAULT_HUD_SETTINGS,
  GlossaryEntry,
  ShortcutBinding,
  DEFAULT_SHORTCUT_BINDINGS,
  ShortcutActionId
} from '../../../types/settings'
import { AudioIngestionEngine } from '../audio/AudioIngestionEngine'
import { StreamingSttManager } from '../audio/stt/StreamingSttManager'
import { TranslationManager } from '../translation/TranslationManager'
import {
  resolvePipelineState,
  PipelineStateSnapshot
} from '../state/sessionStateMachine'
import { glossaryEntriesToMap } from '../utils/glossaryParser'

const STORAGE_KEY_HUD = 'dualai_hud_settings'
const STORAGE_KEY_GLOSSARY = 'dualai_custom_glossary'
const STORAGE_KEY_SHORTCUTS = 'dualai_shortcut_bindings'
const STORAGE_KEY_GEMINI_KEY = 'dualai_gemini_api_key'

function loadJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

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

  // Audio Engine & Hardware Calibration State
  isAudioActive: boolean
  isInitializingAudio: boolean
  isCoughMuted: boolean
  isMonitorLoopbackActive: boolean
  selectedInputDeviceId: string
  selectedOutputDeviceId: string
  gainChannelA: number
  gainChannelB: number
  levelMetricA: AudioLevelMetric | null
  levelMetricB: AudioLevelMetric | null
  bufferSamplesA: number
  bufferSamplesB: number

  // Master Pipeline State Machine (Day 09)
  pipelineState: PipelineStateSnapshot

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

  // Teleprompter Floating HUD State (Day 10)
  isHudOpen: boolean
  hudSettings: HudSettings

  // Custom Glossary & Global Shortcuts State (Day 11)
  customGlossaryEntries: GlossaryEntry[]
  shortcutBindings: ShortcutBinding[]
  geminiApiKey: string

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

  // Audio Engine & Calibration Actions
  startAudioEngine: () => Promise<void>
  stopAudioEngine: () => void
  toggleCoughMute: () => void
  setCoughMute: (muted: boolean) => void
  setGainChannelA: (gain: number) => void
  setGainChannelB: (gain: number) => void
  setVadThreshold: (threshold: number) => void
  setSelectedInputDeviceId: (deviceId: string) => void
  setSelectedOutputDeviceId: (deviceId: string) => void
  playHardwareCalibrationTone: (gainMultiplier: number) => Promise<void>
  setMonitorLoopback: (enabled: boolean) => void

  // STT Actions
  clearTranscripts: () => void
  simulateSocketDrop: (channelId?: ChannelId) => void
  sendTestSpeechUtterance: (channelId: ChannelId, phrase?: string) => void

  // Translation Actions
  clearTranslations: () => void
  triggerDomainTestTranslation: (domainOverride?: DomainId, phraseOverride?: string) => Promise<void>

  // HUD Actions (Day 10)
  openHud: () => Promise<void>
  closeHud: () => Promise<void>
  toggleHud: () => Promise<void>
  updateHudSettings: (partial: Partial<HudSettings>) => void

  // Glossary & Shortcuts Actions (Day 11)
  addGlossaryEntry: (source: string, target: string, notes?: string) => void
  importGlossaryEntries: (entries: GlossaryEntry[], replaceExisting?: boolean) => void
  removeGlossaryEntry: (id: string) => void
  clearCustomGlossary: () => void
  updateShortcutBinding: (actionId: ShortcutActionId, accelerator: string) => Promise<boolean>
  resetShortcutBindings: () => Promise<void>
  setGeminiApiKey: (key: string) => void
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

  // Audio Engine Ingestion & Hardware State
  const [isAudioActive, setIsAudioActive] = useState(false)
  const [isInitializingAudio, setIsInitializingAudio] = useState(false)
  const [isCoughMuted, setIsCoughMuted] = useState(false)
  const [isMonitorLoopbackActive, setIsMonitorLoopbackActive] = useState(false)
  const [hasPipelineError, setHasPipelineError] = useState(false)
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState('default')
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState('default')
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
  const [sttProvider, setSttProvider] = useState<
    'deepgram-nova-2' | 'whisper-turbo' | 'simulated-stt'
  >('simulated-stt')
  const [sttReconnectCount, setSttReconnectCount] = useState(0)
  const [utterances, setUtterances] = useState<TranscriptUtterance[]>([])
  const [interimTranscriptA, setInterimTranscriptA] = useState<TranscriptUtterance | null>(null)
  const [interimTranscriptB, setInterimTranscriptB] = useState<TranscriptUtterance | null>(null)

  // Real-Time Domain Inference (Gemini 2.0 Flash) State
  const [translations, setTranslations] = useState<TranslationResult[]>([])
  const [activeTranslation, setActiveTranslation] = useState<TranslationResult | null>(null)
  const [translationLatencyMs, setTranslationLatencyMs] = useState(0)
  const [endToEndLatencyMs, setEndToEndLatencyMs] = useState(0)
  const [translationProvider, setTranslationProvider] = useState<
    'gemini-2.0-flash' | 'simulated-gemini'
  >('simulated-gemini')

  // Day 10: Floating Teleprompter HUD State
  const [isHudOpen, setIsHudOpen] = useState(false)
  const [hudSettings, setHudSettings] = useState<HudSettings>(() =>
    loadJsonStorage<HudSettings>(STORAGE_KEY_HUD, DEFAULT_HUD_SETTINGS)
  )

  // Day 11: Custom Glossary & Global Shortcuts State
  const [customGlossaryEntries, setCustomGlossaryEntries] = useState<GlossaryEntry[]>(() =>
    loadJsonStorage<GlossaryEntry[]>(STORAGE_KEY_GLOSSARY, [])
  )
  const [shortcutBindings, setShortcutBindings] = useState<ShortcutBinding[]>(() =>
    loadJsonStorage<ShortcutBinding[]>(STORAGE_KEY_SHORTCUTS, DEFAULT_SHORTCUT_BINDINGS)
  )
  const [geminiApiKey, setGeminiApiKeyState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_GEMINI_KEY) || ''
    } catch {
      return ''
    }
  })

  const engineRef = useRef<AudioIngestionEngine | null>(null)
  const sttManagerRef = useRef<StreamingSttManager | null>(null)
  const translationManagerRef = useRef<TranslationManager | null>(null)
  const domainIdRef = useRef(domainId)
  const sourceLangRef = useRef(sourceLang)
  const targetLangRef = useRef(targetLang)
  const isHudOpenRef = useRef(isHudOpen)
  const hudSettingsRef = useRef(hudSettings)
  const isAudioActiveRef = useRef(isAudioActive)

  domainIdRef.current = domainId
  sourceLangRef.current = sourceLang
  targetLangRef.current = targetLang
  isHudOpenRef.current = isHudOpen
  hudSettingsRef.current = hudSettings
  isAudioActiveRef.current = isAudioActive

  // Resolve Master Pipeline Finite State Machine (Day 09)
  const pipelineState = useMemo<PipelineStateSnapshot>(
    () =>
      resolvePipelineState({
        isAudioActive,
        isInitializing: isInitializingAudio,
        isMuted: isCoughMuted,
        isSpeechActiveA,
        isSpeechActiveB,
        hasInterimTranscript: Boolean(interimTranscriptA || interimTranscriptB),
        isTranslating: Boolean(activeTranslation),
        sttStatusA,
        sttStatusB,
        hasError: hasPipelineError,
        bufferSamplesA,
        bufferSamplesB
      }),
    [
      isAudioActive,
      isInitializingAudio,
      isCoughMuted,
      isSpeechActiveA,
      isSpeechActiveB,
      interimTranscriptA,
      interimTranscriptB,
      activeTranslation,
      sttStatusA,
      sttStatusB,
      hasPipelineError,
      bufferSamplesA,
      bufferSamplesB
    ]
  )

  // Initialize Real-Time Domain Translation Engine
  useEffect(() => {
    const initialGlossaryMap = glossaryEntriesToMap(customGlossaryEntries)
    const tm = new TranslationManager(
      {
        onTranslationStart: (result) => {
          setActiveTranslation(result)
          if (isHudOpenRef.current && window.electronAPI?.sendHudTranscript) {
            window.electronAPI.sendHudTranscript({
              id: result.utteranceId,
              speakerId: result.channelId,
              speakerLabel: result.speakerLabel,
              sourceText: result.sourceText,
              translatedText: result.translatedText,
              timestampMs: result.timestampMs,
              isInterim: true
            })
          }
        },
        onTranslationToken: (_token, accumulatedText) => {
          setActiveTranslation((prev) => {
            if (!prev) return null
            const updated = { ...prev, translatedText: accumulatedText }
            if (isHudOpenRef.current && window.electronAPI?.sendHudTranscript) {
              window.electronAPI.sendHudTranscript({
                id: updated.utteranceId,
                speakerId: updated.channelId,
                speakerLabel: updated.speakerLabel,
                sourceText: updated.sourceText,
                translatedText: accumulatedText,
                timestampMs: updated.timestampMs,
                isInterim: true
              })
            }
            return updated
          })
        },
        onTranslationComplete: (result) => {
          setActiveTranslation(null)
          setTranslations((prev) => [...prev.slice(-999), result])
          if (isHudOpenRef.current && window.electronAPI?.sendHudTranscript) {
            window.electronAPI.sendHudTranscript({
              id: result.utteranceId,
              speakerId: result.channelId,
              speakerLabel: result.speakerLabel,
              sourceText: result.sourceText,
              translatedText: result.translatedText,
              timestampMs: result.timestampMs,
              isInterim: false
            })
          }
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
      },
      {
        apiKey: geminiApiKey || undefined,
        customGlossary: initialGlossaryMap
      }
    )

    translationManagerRef.current = tm

    return () => {
      tm.cancelActive()
    }
  }, [])

  // Sync Custom Glossary into Translation Manager and persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_GLOSSARY, JSON.stringify(customGlossaryEntries))
    } catch {
      // Ignore storage quota errors
    }
    translationManagerRef.current?.setCustomGlossary(glossaryEntriesToMap(customGlossaryEntries))
  }, [customGlossaryEntries])

  // Persist HUD settings whenever updated
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_HUD, JSON.stringify(hudSettings))
    } catch {
      // Ignore storage errors
    }
  }, [hudSettings])

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
          setUtterances((prev) => [...prev.slice(-999), utterance])

          // Trigger streaming domain translation immediately upon speech pause
          const target =
            utterance.channelId === 'channel_a' ? targetLangRef.current : sourceLangRef.current
          translationManagerRef.current?.translateUtterance(utterance, domainIdRef.current, target)
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
  }, [])

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
        sttManagerRef.current?.sendAudio(event.channelId, preSpeechPcm)
      },
      onSpeechFrame: (channelId, pcmData) => {
        sttManagerRef.current?.sendAudio(channelId, pcmData)
      },
      onSpeechEnd: (event) => {
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
        setHasPipelineError(true)
        setIsAudioActive(false)
        setIsInitializingAudio(false)
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
    setHasPipelineError(false)
    setIsInitializingAudio(true)
    try {
      await engineRef.current.start({
        noiseSuppression,
        echoCancellation,
        gainA: gainChannelA,
        gainB: gainChannelB,
        deviceIdA: selectedInputDeviceId
      })
      sttManagerRef.current?.start()
      setIsAudioActive(true)
    } catch (err) {
      console.error('[DUALAI] Failed to start audio engine:', err)
      setHasPipelineError(true)
      setIsAudioActive(false)
    } finally {
      setIsInitializingAudio(false)
    }
  }, [noiseSuppression, echoCancellation, gainChannelA, gainChannelB, selectedInputDeviceId])

  // Stop Audio Ingestion & Terminate Sockets cleanly
  const stopAudioEngine = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.stop()
      setIsAudioActive(false)
      setIsInitializingAudio(false)
      setIsMonitorLoopbackActive(false)
      setLevelMetricA(null)
      setLevelMetricB(null)
      setBufferSamplesA(0)
      setBufferSamplesB(0)
      setVadProbabilityA(0)
      setVadProbabilityB(0)
      setIsSpeechActiveA(false)
      setIsSpeechActiveB(false)
    }
    sttManagerRef.current?.stop()
    translationManagerRef.current?.cancelActive()
    setSttStatusA('disconnected')
    setSttStatusB('disconnected')
    setInterimTranscriptA(null)
    setInterimTranscriptB(null)
    setActiveTranslation(null)
  }, [])

  // Instantaneous Cough Mute (Day 09 DoD: 0ms audible bleed within 1 buffer quantum)
  const setCoughMute = useCallback((muted: boolean) => {
    setIsCoughMuted(muted)
    engineRef.current?.setCoughMute(muted)
    if (muted) {
      setIsSpeechActiveA(false)
      setVadProbabilityA(0)
    }
  }, [])

  const toggleCoughMute = useCallback(() => {
    setIsCoughMuted((prev) => {
      const next = !prev
      engineRef.current?.setCoughMute(next)
      if (next) {
        setIsSpeechActiveA(false)
        setVadProbabilityA(0)
      }
      return next
    })
  }, [])

  // Hardware Gain Multipliers & Calibration Monitor Feedback (Day 11)
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

  const playHardwareCalibrationTone = useCallback(async (gainMultiplier: number) => {
    await engineRef.current?.playCalibrationTone(gainMultiplier)
  }, [])

  const setMonitorLoopback = useCallback((enabled: boolean) => {
    setIsMonitorLoopbackActive(enabled)
    engineRef.current?.setMonitorLoopback(enabled)
  }, [])

  // Translation Actions
  const clearTranslations = useCallback(() => {
    setTranslations([])
    setActiveTranslation(null)
    translationManagerRef.current?.clearHistory()
  }, [])

  const triggerDomainTestTranslation = useCallback(
    async (domainOverride?: DomainId, phraseOverride?: string) => {
      const effectiveDomain = domainOverride || domainId
      let testPhrase = phraseOverride
      if (!testPhrase) {
        if (effectiveDomain === 'medical') {
          testPhrase =
            'Patient presents with acute dyspnea and tachycardia following antibiotic administration.'
        } else if (effectiveDomain === 'legal') {
          testPhrase =
            'The party of the first part hereby agrees to indemnify and hold harmless the licensee.'
        } else if (effectiveDomain === 'technical') {
          testPhrase = 'WebSocket connection initialized with binary ArrayBuffer linear16 stream.'
        } else if (effectiveDomain === 'business') {
          testPhrase =
            'Quarterly earnings report indicates sixteen percent growth in enterprise subscriptions.'
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

      setUtterances((prev) => [...prev.slice(-999), testUtterance])
      await translationManagerRef.current?.translateUtterance(
        testUtterance,
        effectiveDomain,
        targetLang
      )
    },
    [domainId, sourceLang, targetLang]
  )

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

  // Day 10: Floating Teleprompter HUD Controls
  const openHud = useCallback(async () => {
    if (window.electronAPI?.openHud) {
      await window.electronAPI.openHud(hudSettingsRef.current.bounds)
      window.electronAPI.sendHudConfig?.(hudSettingsRef.current)
      await window.electronAPI.setHudClickThrough?.(hudSettingsRef.current.isClickThrough)
      setIsHudOpen(true)
    } else {
      setIsHudOpen(true)
    }
  }, [])

  const closeHud = useCallback(async () => {
    if (window.electronAPI?.closeHud) {
      await window.electronAPI.closeHud()
    }
    setIsHudOpen(false)
  }, [])

  const toggleHud = useCallback(async () => {
    if (isHudOpenRef.current) {
      await closeHud()
    } else {
      await openHud()
    }
  }, [openHud, closeHud])

  const updateHudSettings = useCallback((partial: Partial<HudSettings>) => {
    setHudSettings((prev) => {
      const next: HudSettings = {
        ...prev,
        ...partial,
        bounds: partial.bounds ? { ...prev.bounds, ...partial.bounds } : prev.bounds
      }

      window.electronAPI?.sendHudConfig?.(next)
      if (typeof partial.isClickThrough === 'boolean') {
        window.electronAPI?.setHudClickThrough?.(partial.isClickThrough)
      }
      return next
    })
  }, [])

  // Day 11: Custom Glossary Actions
  const addGlossaryEntry = useCallback((source: string, target: string, notes?: string) => {
    const cleanSource = source.trim()
    const cleanTarget = target.trim()
    if (!cleanSource || !cleanTarget) return

    setCustomGlossaryEntries((prev) => {
      const filtered = prev.filter((e) => e.source.toLowerCase() !== cleanSource.toLowerCase())
      return [
        ...filtered,
        {
          id: `gloss-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          source: cleanSource,
          target: cleanTarget,
          notes
        }
      ]
    })
  }, [])

  const importGlossaryEntries = useCallback(
    (entries: GlossaryEntry[], replaceExisting: boolean = false) => {
      if (replaceExisting) {
        setCustomGlossaryEntries(entries)
        return
      }
      setCustomGlossaryEntries((prev) => {
        const merged = new Map<string, GlossaryEntry>()
        for (const item of prev) {
          merged.set(item.source.toLowerCase(), item)
        }
        for (const item of entries) {
          merged.set(item.source.toLowerCase(), item)
        }
        return Array.from(merged.values())
      })
    },
    []
  )

  const removeGlossaryEntry = useCallback((id: string) => {
    setCustomGlossaryEntries((prev) => prev.filter((e) => e.id !== id))
  }, [])

  const clearCustomGlossary = useCallback(() => {
    setCustomGlossaryEntries([])
  }, [])

  // Day 11: Dynamic Global Shortcuts Actions
  const updateShortcutBinding = useCallback(
    async (actionId: ShortcutActionId, accelerator: string): Promise<boolean> => {
      const updated = shortcutBindings.map((b) =>
        b.id === actionId ? { ...b, accelerator } : b
      )
      setShortcutBindings(updated)
      try {
        localStorage.setItem(STORAGE_KEY_SHORTCUTS, JSON.stringify(updated))
      } catch {
        // Ignore storage error
      }
      if (window.electronAPI?.updateGlobalShortcuts) {
        const report = await window.electronAPI.updateGlobalShortcuts(updated)
        return !report.failed.includes(actionId)
      }
      return true
    },
    [shortcutBindings]
  )

  const resetShortcutBindings = useCallback(async () => {
    setShortcutBindings(DEFAULT_SHORTCUT_BINDINGS)
    try {
      localStorage.setItem(STORAGE_KEY_SHORTCUTS, JSON.stringify(DEFAULT_SHORTCUT_BINDINGS))
    } catch {
      // Ignore storage error
    }
    if (window.electronAPI?.updateGlobalShortcuts) {
      await window.electronAPI.updateGlobalShortcuts(DEFAULT_SHORTCUT_BINDINGS)
    }
  }, [])

  const setGeminiApiKey = useCallback((key: string) => {
    setGeminiApiKeyState(key)
    try {
      localStorage.setItem(STORAGE_KEY_GEMINI_KEY, key)
    } catch {
      // Ignore storage error
    }
    translationManagerRef.current?.setApiKey(key)
  }, [])

  // Sync persisted global shortcuts into Electron Main on boot
  useEffect(() => {
    if (window.electronAPI?.updateGlobalShortcuts) {
      window.electronAPI.updateGlobalShortcuts(shortcutBindings)
    }
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

  // Day 09: Global Spacebar Cough Mute Toggle (when not typing in inputs)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isEditable =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(target?.isContentEditable)

      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setIsSettingsModalOpen((prev) => !prev)
        return
      }

      if (e.code === 'Space' && !e.repeat && !isEditable && tag !== 'button') {
        e.preventDefault()
        toggleCoughMute()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleCoughMute])

  // Listen to Electron Global Background Shortcuts & HUD IPC Events
  useEffect(() => {
    const cleanups: Array<() => void> = []

    if (typeof window !== 'undefined' && window.electronAPI) {
      if (window.electronAPI.onShortcutSwapLanguages) {
        cleanups.push(window.electronAPI.onShortcutSwapLanguages(() => swapLanguages()))
      }
      if (window.electronAPI.onShortcutMute) {
        cleanups.push(window.electronAPI.onShortcutMute(() => toggleCoughMute()))
      }
      if (window.electronAPI.onShortcutToggleHud) {
        cleanups.push(window.electronAPI.onShortcutToggleHud(() => void toggleHud()))
      }
      if (window.electronAPI.onShortcutPttToggle) {
        cleanups.push(
          window.electronAPI.onShortcutPttToggle(() => {
            if (isAudioActiveRef.current) {
              stopAudioEngine()
            } else {
              void startAudioEngine()
            }
          })
        )
      }
      if (window.electronAPI.onShortcutClearBuffer) {
        cleanups.push(window.electronAPI.onShortcutClearBuffer(() => clearTranscripts()))
      }
      if (window.electronAPI.onHudBoundsChanged) {
        cleanups.push(
          window.electronAPI.onHudBoundsChanged((bounds) => {
            setHudSettings((prev) => ({ ...prev, bounds }))
          })
        )
      }
      if (window.electronAPI.onHudStatusChanged) {
        cleanups.push(
          window.electronAPI.onHudStatusChanged((open) => {
            setIsHudOpen(open)
          })
        )
      }
      if (window.electronAPI.onHudConfigUpdate) {
        cleanups.push(
          window.electronAPI.onHudConfigUpdate((config) => {
            setHudSettings(config)
          })
        )
      }
    }

    return () => {
      cleanups.forEach((fn) => fn())
    }
  }, [swapLanguages, toggleCoughMute, toggleHud, startAudioEngine, stopAudioEngine, clearTranscripts])

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
        isInitializingAudio,
        isCoughMuted,
        isMonitorLoopbackActive,
        selectedInputDeviceId,
        selectedOutputDeviceId,
        gainChannelA,
        gainChannelB,
        levelMetricA,
        levelMetricB,
        bufferSamplesA,
        bufferSamplesB,
        pipelineState,
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
        isHudOpen,
        hudSettings,
        customGlossaryEntries,
        shortcutBindings,
        geminiApiKey,
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
        toggleCoughMute,
        setCoughMute,
        setGainChannelA,
        setGainChannelB,
        setVadThreshold,
        setSelectedInputDeviceId,
        setSelectedOutputDeviceId,
        playHardwareCalibrationTone,
        setMonitorLoopback,
        clearTranscripts,
        simulateSocketDrop,
        sendTestSpeechUtterance,
        clearTranslations,
        triggerDomainTestTranslation,
        openHud,
        closeHud,
        toggleHud,
        updateHudSettings,
        addGlossaryEntry,
        importGlossaryEntries,
        removeGlossaryEntry,
        clearCustomGlossary,
        updateShortcutBinding,
        resetShortcutBindings,
        setGeminiApiKey
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
