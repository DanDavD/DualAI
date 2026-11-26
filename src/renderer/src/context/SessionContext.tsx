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
  ChannelId,
  LoopbackSourceStatus
} from '../../../types/audio'
import { DomainId } from '../../../types/domain'
import { TranscriptUtterance, SttConnectionState } from '../../../types/stt'
import { TranslationResult } from '../../../types/translation'
import {
  HudSettings,
  DEFAULT_HUD_SETTINGS,
  WorkspaceDisplaySettings,
  DEFAULT_WORKSPACE_DISPLAY_SETTINGS,
  GlossaryEntry,
  ShortcutBinding,
  DEFAULT_SHORTCUT_BINDINGS,
  ShortcutActionId
} from '../../../types/settings'
import {
  AccountQuota,
  AuthenticatedSession,
  BillingPlan,
  CheckoutProvider,
  CheckoutSessionResult,
  DEFAULT_SAAS_PLANS,
  PlanId
} from '../../../types/account'
import { AudioIngestionEngine } from '../audio/AudioIngestionEngine'
import {
  resolveAudioRoutingPolicy,
  resolveTranslationTargetForChannel,
  resolveEndpointingMs
} from '../audio/audioRoutingPolicy'
import {
  DEFAULT_PAUSE_COMMIT_MS,
  ParagraphTurnAccumulator,
  normalizeTextForMatch
} from '../audio/paragraphAccumulator'
import {
  TARGET_STREAM_SAMPLE_RATE,
  downsampleInt16Pcm
} from '../audio/pcmDownsampler'
import { StreamingSttManager } from '../audio/stt/StreamingSttManager'
import { TranslationManager } from '../translation/TranslationManager'
import {
  resolvePipelineState,
  PipelineStateSnapshot
} from '../state/sessionStateMachine'
import { glossaryEntriesToMap } from '../utils/glossaryParser'
import {
  STORAGE_KEY_WORKSPACE_DISPLAY,
  mergeWorkspaceTypographyIntoHud,
  sanitizeWorkspaceDisplaySettings
} from '../utils/typographyPreferences'
import {
  clearEncryptedSession,
  computeSilentRefreshDelayMs,
  createBillingCheckoutSession,
  fetchAuthoritativeQuota,
  getGatewayHttpUrl,
  loadEncryptedSession,
  refreshSessionToken,
  requestPasswordReset,
  resendVerificationEmail,
  revokeServerSession,
  signInWithEmailPassword,
  verifyMicrosoftStorePurchase
} from '../services/gatewayAuthService'

const STORAGE_KEY_HUD = 'dualai_hud_settings'
const STORAGE_KEY_GLOSSARY = 'dualai_custom_glossary'
const STORAGE_KEY_SHORTCUTS = 'dualai_shortcut_bindings'
const STORAGE_KEY_LOOPBACK_DEVICE = 'dualai_loopback_device_id'

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
  settingsInitialTab: 'audio' | 'interpretation' | 'reading' | 'shortcuts' | 'privacy'

  // Audio Engine & Hardware Calibration State
  isAudioActive: boolean
  isInitializingAudio: boolean
  isCoughMuted: boolean
  isMonitorLoopbackActive: boolean
  selectedInputDeviceId: string
  selectedLoopbackDeviceId: string
  selectedOutputDeviceId: string
  loopbackStatus: LoopbackSourceStatus
  loopbackStatusMessage: string | null
  pipelineErrorMessage: string | null
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
  sttProvider: 'soniox-unified' | 'deepgram-nova-2' | 'whisper-turbo' | 'simulated-stt'
  sttReconnectCount: number
  utterances: TranscriptUtterance[]
  interimTranscriptA: TranscriptUtterance | null
  interimTranscriptB: TranscriptUtterance | null

  // Real-Time Domain Inference (Soniox Unified / Gemini Fallback) State
  translations: TranslationResult[]
  streamingTranslations: Record<string, TranslationResult>
  draftTranslationA: TranslationResult | null
  draftTranslationB: TranslationResult | null
  activeTranslation: TranslationResult | null
  translationLatencyMs: number
  endToEndLatencyMs: number
  translationProvider: 'soniox-unified' | 'gemini-2.0-flash' | 'simulated-gemini'

  // Teleprompter Floating HUD State (Day 10)
  isHudOpen: boolean
  hudSettings: HudSettings

  // CARD-16: Workspace Typography & View Personalization State
  workspaceDisplaySettings: WorkspaceDisplaySettings

  // Custom Glossary & Global Shortcuts State (Day 11)
  customGlossaryEntries: GlossaryEntry[]
  shortcutBindings: ShortcutBinding[]

  // Zero-Trust SaaS Authentication, Quota & Billing State
  authSession: AuthenticatedSession | null
  accountQuota: AccountQuota | null
  availablePlans: BillingPlan[]
  isAccountModalOpen: boolean
  isGatewayAuthenticated: boolean
  isQuotaExhausted: boolean

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
  openSettingsModal: (
    initialTab?: 'audio' | 'interpretation' | 'reading' | 'shortcuts' | 'privacy' | unknown
  ) => void
  closeSettingsModal: () => void
  openAccountModal: () => void
  closeAccountModal: () => void

  // Audio Engine & Calibration Actions
  startAudioEngine: () => Promise<void>
  stopAudioEngine: () => void
  toggleCoughMute: () => void
  setCoughMute: (muted: boolean) => void
  setGainChannelA: (gain: number) => void
  setGainChannelB: (gain: number) => void
  setVadThreshold: (threshold: number) => void
  setSelectedInputDeviceId: (deviceId: string) => void
  setSelectedLoopbackDeviceId: (deviceId: string) => void
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

  // CARD-16: Workspace Display & Typography Actions
  updateWorkspaceDisplaySettings: (partial: Partial<WorkspaceDisplaySettings>) => void
  resetWorkspaceDisplaySettings: () => void

  // Glossary & Shortcuts Actions (Day 11)
  addGlossaryEntry: (source: string, target: string, notes?: string) => void
  importGlossaryEntries: (entries: GlossaryEntry[], replaceExisting?: boolean) => void
  removeGlossaryEntry: (id: string) => void
  clearCustomGlossary: () => void
  updateShortcutBinding: (actionId: ShortcutActionId, accelerator: string) => Promise<boolean>
  resetShortcutBindings: () => Promise<void>
  signInAccount: (
    email: string,
    password: string,
    mode: 'signin' | 'signup'
  ) => Promise<{ emailVerificationRequired: boolean; message?: string }>
  signOutAccount: () => Promise<void>
  requestPasswordResetAccount: (email: string) => Promise<string>
  resendVerificationEmailAccount: (email: string) => Promise<string>
  refreshAccountQuota: () => Promise<void>
  startPlanCheckout: (
    planId: PlanId,
    provider: CheckoutProvider
  ) => Promise<CheckoutSessionResult>
  verifyMsStoreReceipt: (
    storeIdKey: string,
    productId: string
  ) => Promise<{ verified: boolean; error?: string }>
}

const SessionContext = createContext<SessionState | null>(null)

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [audioRoute, setAudioRoute] = useState<AudioRouteMode>('system')
  const [operatingMode, setOperatingMode] = useState<OperatingMode>('translate')
  const [domainId, setDomainId] = useState<DomainId>('medical')
  const [sourceLang, setSourceLang] = useState('en')
  const [targetLang, setTargetLang] = useState('es')
  const [latencyMode, setLatencyMode] = useState<LatencyMode>('sub_second_live')
  const [noiseSuppression, setNoiseSuppression] = useState(true)
  const [echoCancellation, setEchoCancellation] = useState(true)
  const [latencyPingMs, setLatencyPingMs] = useState(42)
  const [isGlossaryModalOpen, setIsGlossaryModalOpen] = useState(false)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    'audio' | 'interpretation' | 'reading' | 'shortcuts' | 'privacy'
  >('audio')
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false)

  // Zero-Trust SaaS Account & Authoritative Quota State
  const [authSession, setAuthSession] = useState<AuthenticatedSession | null>(null)
  const [accountQuota, setAccountQuota] = useState<AccountQuota | null>(null)
  const [availablePlans, setAvailablePlans] = useState<BillingPlan[]>(DEFAULT_SAAS_PLANS)

  const quotaTotalHours = accountQuota ? accountQuota.totalAllocatedSeconds / 3600 : 1.0
  const quotaRemainingHours = accountQuota ? accountQuota.remainingSeconds / 3600 : 1.0
  const isGatewayAuthenticated = Boolean(authSession?.accessToken)
  const isQuotaExhausted = Boolean(accountQuota && accountQuota.remainingSeconds <= 0)

  // Audio Engine Ingestion & Hardware State
  const [isAudioActive, setIsAudioActive] = useState(false)
  const [isInitializingAudio, setIsInitializingAudio] = useState(false)
  const [isCoughMuted, setIsCoughMuted] = useState(false)
  const [isMonitorLoopbackActive, setIsMonitorLoopbackActive] = useState(false)
  const [hasPipelineError, setHasPipelineError] = useState(false)
  const [pipelineErrorMessage, setPipelineErrorMessage] = useState<string | null>(null)
  const [loopbackStatus, setLoopbackStatus] = useState<LoopbackSourceStatus>('inactive')
  const [loopbackStatusMessage, setLoopbackStatusMessage] = useState<string | null>(null)
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState('default')
  const [selectedLoopbackDeviceId, setSelectedLoopbackDeviceIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_LOOPBACK_DEVICE) || 'system_loopback'
    } catch {
      return 'system_loopback'
    }
  })
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
    'soniox-unified' | 'deepgram-nova-2' | 'whisper-turbo' | 'simulated-stt'
  >('simulated-stt')
  const [sttReconnectCount, setSttReconnectCount] = useState(0)
  const [utterances, setUtterances] = useState<TranscriptUtterance[]>([])
  const [interimTranscriptA, setInterimTranscriptA] = useState<TranscriptUtterance | null>(null)
  const [interimTranscriptB, setInterimTranscriptB] = useState<TranscriptUtterance | null>(null)

  // Real-Time Domain Inference (Soniox Unified / Gemini Fallback) State
  const [translations, setTranslations] = useState<TranslationResult[]>([])
  const [streamingTranslations, setStreamingTranslations] = useState<
    Record<string, TranslationResult>
  >({})
  const [draftTranslationA, setDraftTranslationA] = useState<TranslationResult | null>(null)
  const [draftTranslationB, setDraftTranslationB] = useState<TranslationResult | null>(null)
  const [translationLatencyMs, setTranslationLatencyMs] = useState(0)
  const [endToEndLatencyMs, setEndToEndLatencyMs] = useState(0)
  const [translationProvider, setTranslationProvider] = useState<
    'soniox-unified' | 'gemini-2.0-flash' | 'simulated-gemini'
  >('simulated-gemini')

  const activeTranslation = useMemo<TranslationResult | null>(() => {
    const inFlight = Object.values(streamingTranslations)
    if (inFlight.length > 0) return inFlight[inFlight.length - 1]
    if (draftTranslationA?.isStreaming) return draftTranslationA
    if (draftTranslationB?.isStreaming) return draftTranslationB
    return draftTranslationA || draftTranslationB || null
  }, [streamingTranslations, draftTranslationA, draftTranslationB])

  // Day 10: Floating Teleprompter HUD State
  const [isHudOpen, setIsHudOpen] = useState(false)
  const [hudSettings, setHudSettings] = useState<HudSettings>(() =>
    loadJsonStorage<HudSettings>(STORAGE_KEY_HUD, DEFAULT_HUD_SETTINGS)
  )

  // CARD-16: Workspace Typography & View Personalization State (Persisted in localStorage)
  const [workspaceDisplaySettings, setWorkspaceDisplaySettings] =
    useState<WorkspaceDisplaySettings>(() =>
      sanitizeWorkspaceDisplaySettings(
        loadJsonStorage<Partial<WorkspaceDisplaySettings>>(
          STORAGE_KEY_WORKSPACE_DISPLAY,
          DEFAULT_WORKSPACE_DISPLAY_SETTINGS
        )
      )
    )

  // Day 11: Custom Glossary & Global Shortcuts State
  const [customGlossaryEntries, setCustomGlossaryEntries] = useState<GlossaryEntry[]>(() =>
    loadJsonStorage<GlossaryEntry[]>(STORAGE_KEY_GLOSSARY, [])
  )
  const [shortcutBindings, setShortcutBindings] = useState<ShortcutBinding[]>(() =>
    loadJsonStorage<ShortcutBinding[]>(STORAGE_KEY_SHORTCUTS, DEFAULT_SHORTCUT_BINDINGS)
  )

  const routingDecision = useMemo(
    () =>
      resolveAudioRoutingPolicy({
        audioRoute,
        operatingMode,
        sourceLang,
        targetLang
      }),
    [audioRoute, operatingMode, sourceLang, targetLang]
  )

  const engineRef = useRef<AudioIngestionEngine | null>(null)
  const sttManagerRef = useRef<StreamingSttManager | null>(null)
  const translationManagerRef = useRef<TranslationManager | null>(null)
  const paragraphAccumulatorRef = useRef<ParagraphTurnAccumulator | null>(null)
  const domainIdRef = useRef(domainId)
  const sourceLangRef = useRef(sourceLang)
  const targetLangRef = useRef(targetLang)
  const latencyModeRef = useRef(latencyMode)
  const routingDecisionRef = useRef(routingDecision)
  const isHudOpenRef = useRef(isHudOpen)
  const hudSettingsRef = useRef(hudSettings)
  const isAudioActiveRef = useRef(isAudioActive)
  const lastActiveAudioMsRef = useRef<Record<ChannelId, number>>({
    channel_a: 0,
    channel_b: 0
  })
  const channelPauseFinalizedRef = useRef<Record<ChannelId, boolean>>({
    channel_a: true,
    channel_b: true
  })
  const draftDebounceTimersRef = useRef<Partial<Record<ChannelId, ReturnType<typeof setTimeout>>>>(
    {}
  )
  const lastDraftRequestedRef = useRef<Partial<Record<ChannelId, { id: string; text: string }>>>({})
  const draftResultRef = useRef<Partial<Record<ChannelId, TranslationResult | null>>>({})

  domainIdRef.current = domainId
  sourceLangRef.current = sourceLang
  targetLangRef.current = targetLang
  latencyModeRef.current = latencyMode
  routingDecisionRef.current = routingDecision
  isHudOpenRef.current = isHudOpen
  hudSettingsRef.current = hudSettings
  isAudioActiveRef.current = isAudioActive

  const clearDraftTimers = useCallback((channelId?: ChannelId) => {
    const channels: ChannelId[] = channelId ? [channelId] : ['channel_a', 'channel_b']
    for (const ch of channels) {
      const timer = draftDebounceTimersRef.current[ch]
      if (timer) {
        clearTimeout(timer)
        delete draftDebounceTimersRef.current[ch]
      }
      if (!channelId) {
        delete lastDraftRequestedRef.current[ch]
        draftResultRef.current[ch] = null
      }
    }
  }, [])

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
          setStreamingTranslations((prev) => {
            // Preserve pre-seeded live draft text until the first finalized token arrives (zero flicker)
            const existing = prev[result.utteranceId]
            return {
              ...prev,
              [result.utteranceId]:
                existing && existing.translatedText.trim().length > 0
                  ? { ...result, translatedText: existing.translatedText }
                  : result
            }
          })
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
        onTranslationToken: (utteranceId, _token, accumulatedText) => {
          setStreamingTranslations((prev) => {
            const current = prev[utteranceId]
            if (!current) return prev
            const updated: TranslationResult = {
              ...current,
              translatedText: accumulatedText,
              isStreaming: true
            }
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
            return {
              ...prev,
              [utteranceId]: updated
            }
          })
        },
        onTranslationComplete: (result) => {
          setStreamingTranslations((prev) => {
            if (!(result.utteranceId in prev)) return prev
            const next = { ...prev }
            delete next[result.utteranceId]
            return next
          })
          setTranslations((prev) => {
            const filtered = prev.filter((t) => t.utteranceId !== result.utteranceId)
            return [...filtered.slice(-999), result]
          })
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
        onDraftStart: (result) => {
          const updateDraft = (prev: TranslationResult | null): TranslationResult => {
            // Keep existing draft words visible while refreshed tokens stream in (zero flicker)
            const next =
              prev && prev.utteranceId === result.utteranceId && prev.translatedText.trim().length > 0
                ? { ...result, translatedText: prev.translatedText, isStreaming: true }
                : { ...result, isStreaming: true }
            draftResultRef.current[result.channelId] = next
            return next
          }
          if (result.channelId === 'channel_a') {
            setDraftTranslationA(updateDraft)
          } else {
            setDraftTranslationB(updateDraft)
          }
        },
        onDraftToken: (utteranceId, _token, accumulatedText) => {
          const applyToken = (
            channelId: ChannelId,
            prev: TranslationResult | null
          ): TranslationResult | null => {
            if (!prev || prev.utteranceId !== utteranceId) return prev
            const updated: TranslationResult = {
              ...prev,
              translatedText: accumulatedText,
              isStreaming: true
            }
            draftResultRef.current[channelId] = updated
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
          }
          setDraftTranslationA((prev) => applyToken('channel_a', prev))
          setDraftTranslationB((prev) => applyToken('channel_b', prev))
        },
        onDraftComplete: (result) => {
          const finalizedDraft: TranslationResult = {
            ...result,
            isStreaming: false,
            isComplete: true
          }
          draftResultRef.current[result.channelId] = finalizedDraft
          if (result.channelId === 'channel_a') {
            setDraftTranslationA((prev) =>
              prev && prev.utteranceId !== result.utteranceId ? prev : finalizedDraft
            )
          } else {
            setDraftTranslationB((prev) =>
              prev && prev.utteranceId !== result.utteranceId ? prev : finalizedDraft
            )
          }
        },
        onTelemetry: (telemetry) => {
          setTranslationLatencyMs(telemetry.timeToFirstTokenMs)
          setEndToEndLatencyMs(telemetry.endToEndLatencyMs)
          setTranslationProvider(telemetry.provider)
        },
        onError: (err) => {
          console.warn('[DUALAI-SESSION] Translation Error:', err)
          setPipelineErrorMessage(err.message)
        },
        onQuotaExhausted: (message) => {
          setAccountQuota((prev) =>
            prev ? { ...prev, remainingSeconds: 0, subscriptionStatus: 'exhausted' } : prev
          )
          setPipelineErrorMessage(message)
          setIsAccountModalOpen(true)
        }
      },
      {
        customGlossary: initialGlossaryMap
      }
    )

    translationManagerRef.current = tm
    setTranslationProvider(tm.isGatewayAuthenticated() ? 'gemini-2.0-flash' : 'simulated-gemini')

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
    sttManagerRef.current?.updateGlossaryTerms(
      customGlossaryEntries.flatMap((e) => [e.source, e.target]).filter(Boolean)
    )
  }, [customGlossaryEntries])

  // Persist HUD settings whenever updated
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_HUD, JSON.stringify(hudSettings))
    } catch {
      // Ignore storage errors
    }
  }, [hudSettings])

  // Initialize 2-Second Pause Paragraph Accumulator & Streaming STT Manager
  useEffect(() => {
    const accumulator = new ParagraphTurnAccumulator(
      {
        onDraftUpdate: (draft, meta) => {
          if (draft.channelId === 'channel_a') {
            setInterimTranscriptA(draft)
          } else {
            setInterimTranscriptB(draft)
          }

          // Live mode: progressively translate while speaking so text appears in softer draft font
          if (latencyModeRef.current !== 'sub_second_live') {
            return
          }

          const normalized = normalizeTextForMatch(draft.text)
          const prevReq = lastDraftRequestedRef.current[draft.channelId]
          if (prevReq && prevReq.id === draft.id && prevReq.text === normalized) {
            return
          }

          // Avoid firing premature API requests for a single noise syllable
          const wordCount = normalized.split(/\s+/).filter(Boolean).length
          if (!meta.isClauseFinalized && wordCount < 2 && normalized.length < 6) {
            return
          }

          const existingTimer = draftDebounceTimersRef.current[draft.channelId]
          if (existingTimer) {
            clearTimeout(existingTimer)
          }

          const delayMs = meta.isClauseFinalized ? 120 : 420
          draftDebounceTimersRef.current[draft.channelId] = setTimeout(() => {
            delete draftDebounceTimersRef.current[draft.channelId]
            if (latencyModeRef.current !== 'sub_second_live') return
            lastDraftRequestedRef.current[draft.channelId] = {
              id: draft.id,
              text: normalized
            }
            const target = resolveTranslationTargetForChannel(
              draft.channelId,
              routingDecisionRef.current
            )
            void translationManagerRef.current?.translateDraftPreview(
              draft,
              domainIdRef.current,
              target
            )
          }, delayMs)
        },
        onParagraphCommit: (committed) => {
          clearDraftTimers(committed.channelId)
          delete lastDraftRequestedRef.current[committed.channelId]

          const latestDraft = draftResultRef.current[committed.channelId] || null
          draftResultRef.current[committed.channelId] = null

          if (committed.channelId === 'channel_a') {
            setInterimTranscriptA(null)
            setDraftTranslationA(null)
          } else {
            setInterimTranscriptB(null)
            setDraftTranslationB(null)
          }

          setUtterances((prev) => [...prev.slice(-999), committed])

          const target = resolveTranslationTargetForChannel(
            committed.channelId,
            routingDecisionRef.current
          )

          // Live mode 2-second commit signal: if draft already matches the complete paragraph,
          // promote instantaneously into finalized crisp typography with zero extra latency
          const canPromoteDraftImmediately =
            latencyModeRef.current === 'sub_second_live' &&
            Boolean(latestDraft) &&
            latestDraft?.utteranceId === committed.id &&
            latestDraft?.isComplete &&
            latestDraft.translatedText.trim().length > 0 &&
            normalizeTextForMatch(latestDraft.sourceText) === normalizeTextForMatch(committed.text)

          if (canPromoteDraftImmediately && latestDraft) {
            const promoted: TranslationResult = {
              ...latestDraft,
              id: `trans-${committed.id}`,
              utteranceId: committed.id,
              sourceText: committed.text,
              isStreaming: false,
              isComplete: true
            }
            setTranslations((prev) => {
              const filtered = prev.filter((t) => t.utteranceId !== committed.id)
              return [...filtered.slice(-999), promoted]
            })
            translationManagerRef.current?.appendDialogueTurn({
              id: `turn-${committed.id}`,
              channelId: committed.channelId,
              speakerLabel: committed.speakerLabel,
              sourceLang: committed.language,
              targetLang: target,
              sourceText: committed.text,
              translatedText: promoted.translatedText,
              domainId: domainIdRef.current,
              timestampMs: Date.now()
            })
            if (isHudOpenRef.current && window.electronAPI?.sendHudTranscript) {
              window.electronAPI.sendHudTranscript({
                id: committed.id,
                speakerId: committed.channelId,
                speakerLabel: committed.speakerLabel,
                sourceText: committed.text,
                translatedText: promoted.translatedText,
                timestampMs: committed.timestampMs,
                isInterim: false
              })
            }
            return
          }

          // Cancel any stale draft preview on this channel and seamlessly carry forward its text
          // into the committed streaming row while the full-paragraph translation finishes
          translationManagerRef.current?.cancelDraftPreview(committed.channelId)
          if (
            latestDraft &&
            latestDraft.utteranceId === committed.id &&
            latestDraft.translatedText.trim().length > 0
          ) {
            setStreamingTranslations((prev) => ({
              ...prev,
              [committed.id]: {
                ...latestDraft,
                id: `trans-${committed.id}`,
                utteranceId: committed.id,
                sourceText: committed.text,
                isStreaming: true,
                isComplete: false
              }
            }))
          }

          void translationManagerRef.current?.translateUtterance(
            committed,
            domainIdRef.current,
            target
          )
        }
      },
      DEFAULT_PAUSE_COMMIT_MS
    )

    paragraphAccumulatorRef.current = accumulator

    const stt = new StreamingSttManager(
      {
        onInterimTranscript: (utterance) => {
          accumulator.pushInterim(utterance)
        },
        onFinalTranscript: (utterance) => {
          accumulator.pushFinalSegment(utterance)
        },
        // Primary Unified Engine: Soniox Real-Time (STT + 15-Speaker Diarization + 2-Way Translation)
        onUnifiedDraft: ({ utterance, translation }) => {
          if (utterance.channelId === 'channel_a') {
            setInterimTranscriptA(utterance)
            if (latencyModeRef.current === 'sub_second_live') {
              setDraftTranslationA(translation)
            }
          } else {
            setInterimTranscriptB(utterance)
            if (latencyModeRef.current === 'sub_second_live') {
              setDraftTranslationB(translation)
            }
          }
          setTranslationProvider('soniox-unified')
          setTranslationLatencyMs(translation.timeToFirstTokenMs)
          setEndToEndLatencyMs(translation.endToEndLatencyMs)

          if (
            latencyModeRef.current === 'sub_second_live' &&
            isHudOpenRef.current &&
            window.electronAPI?.sendHudTranscript
          ) {
            window.electronAPI.sendHudTranscript({
              id: utterance.id,
              speakerId: utterance.speakerId || utterance.channelId,
              speakerLabel: utterance.speakerLabel,
              sourceText: utterance.text,
              translatedText: translation.translatedText,
              timestampMs: utterance.timestampMs,
              isInterim: true
            })
          }
        },
        onUnifiedCommit: ({ utterance, translation }) => {
          if (utterance.channelId === 'channel_a') {
            setInterimTranscriptA(null)
            setDraftTranslationA(null)
          } else {
            setInterimTranscriptB(null)
            setDraftTranslationB(null)
          }
          setUtterances((prev) => [...prev.slice(-999), utterance])
          setTranslations((prev) => {
            const filtered = prev.filter((t) => t.utteranceId !== utterance.id)
            return [...filtered.slice(-999), translation]
          })
          setTranslationProvider('soniox-unified')

          if (isHudOpenRef.current && window.electronAPI?.sendHudTranscript) {
            window.electronAPI.sendHudTranscript({
              id: utterance.id,
              speakerId: utterance.speakerId || utterance.channelId,
              speakerLabel: utterance.speakerLabel,
              sourceText: utterance.text,
              translatedText: translation.translatedText,
              timestampMs: utterance.timestampMs,
              isInterim: false
            })
          }
        },
        onUnifiedCommitUpdate: ({ utterance, translation }) => {
          // Seamlessly append trailing finalized translation tokens arriving ms after <end> or speaker switch
          setTranslations((prev) => {
            const idx = prev.findIndex((t) => t.utteranceId === utterance.id)
            if (idx === -1) return [...prev.slice(-999), translation]
            const next = [...prev]
            next[idx] = translation
            return next
          })
          if (isHudOpenRef.current && window.electronAPI?.sendHudTranscript) {
            window.electronAPI.sendHudTranscript({
              id: utterance.id,
              speakerId: utterance.speakerId || utterance.channelId,
              speakerLabel: utterance.speakerLabel,
              sourceText: utterance.text,
              translatedText: translation.translatedText,
              timestampMs: utterance.timestampMs,
              isInterim: false
            })
          }
        },
        onConnectionChange: (channelId, state) => {
          if (channelId === 'channel_a') {
            setSttStatusA(state)
          } else {
            setSttStatusB(state)
          }
          if (state === 'connected') {
            setPipelineErrorMessage(null)
          }
        },
        onTelemetry: (telemetry) => {
          setSttLatencyMs(telemetry.latencyMs)
          setSttProvider(telemetry.provider)
          setSttReconnectCount((prev) => Math.max(prev, telemetry.reconnectCount))
        },
        onError: (channelId, err) => {
          console.warn(`[DUALAI] STT Error on ${channelId}:`, err)
          setPipelineErrorMessage(
            `Speech connection failed (${err.message}). Verify the Cloud Gateway is running ("pnpm run dev:gateway") or sign in again under Account.`
          )
        },
        onQuotaUpdate: (remainingSeconds, totalAllocatedSeconds) => {
          setAccountQuota((prev) =>
            prev
              ? {
                  ...prev,
                  remainingSeconds,
                  totalAllocatedSeconds,
                  subscriptionStatus: remainingSeconds <= 0 ? 'exhausted' : prev.subscriptionStatus
                }
              : prev
          )
        },
        onQuotaExhausted: (message) => {
          engineRef.current?.stop()
          sttManagerRef.current?.stop()
          accumulator.reset()
          clearDraftTimers()
          setIsAudioActive(false)
          setAccountQuota((prev) =>
            prev ? { ...prev, remainingSeconds: 0, subscriptionStatus: 'exhausted' } : prev
          )
          setPipelineErrorMessage(message)
          setIsAccountModalOpen(true)
        }
      },
      {
        domainId,
        confidenceThreshold: 0.75
      }
    )

    sttManagerRef.current = stt
    setSttProvider(stt.isGatewayAuthenticated() ? 'soniox-unified' : 'simulated-stt')
    stt.updateRouting({
      languageA: routingDecisionRef.current.sttLangA,
      languageB: routingDecisionRef.current.sttLangB,
      targetLanguageA: routingDecisionRef.current.translationTargetA,
      targetLanguageB: routingDecisionRef.current.translationTargetB,
      operatingMode,
      enableChannelA: routingDecisionRef.current.captureChannelA,
      enableChannelB: routingDecisionRef.current.captureChannelB,
      endpointingMs: resolveEndpointingMs(latencyMode),
      sampleRate: TARGET_STREAM_SAMPLE_RATE
    })

    return () => {
      accumulator.reset()
      clearDraftTimers()
      stt.stop()
    }
  }, [clearDraftTimers])

  // Cancel any live draft preview cleanly if user switches to Accurate mode mid-utterance
  useEffect(() => {
    if (latencyMode === 'sentence_accurate') {
      clearDraftTimers()
      translationManagerRef.current?.cancelDraftPreview()
      setDraftTranslationA(null)
      setDraftTranslationB(null)
    }
  }, [latencyMode, clearDraftTimers])

  // Sync routing, language direction, operating mode, latency mode, and domain changes with STT Manager
  useEffect(() => {
    sttManagerRef.current?.updateRouting({
      languageA: routingDecision.sttLangA,
      languageB: routingDecision.sttLangB,
      targetLanguageA: routingDecision.translationTargetA,
      targetLanguageB: routingDecision.translationTargetB,
      operatingMode,
      enableChannelA: routingDecision.captureChannelA,
      enableChannelB: routingDecision.captureChannelB,
      endpointingMs: resolveEndpointingMs(latencyMode),
      sampleRate: TARGET_STREAM_SAMPLE_RATE
    })
  }, [routingDecision, operatingMode, latencyMode])

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
      onPcmChunk: (channelId, pcmData) => {
        if (engineRef.current) {
          const status = engineRef.current.getBufferStatus(channelId)
          if (channelId === 'channel_a') {
            setBufferSamplesA(status.available)
          } else {
            setBufferSamplesB(status.available)
          }
        }
        // In live Zero-Trust Gateway mode, downsample to 16 kHz and stream active PCM
        // (above -57dBFS + 2.2s hangover) so soft/distant voices transcribe cleanly while silence saves quota
        if (sttManagerRef.current?.isGatewayAuthenticated()) {
          if (channelId === 'channel_a' && engineRef.current?.getIsCoughMuted()) {
            return
          }
          let maxAbs = 0
          for (let i = 0; i < pcmData.length; i++) {
            const v = pcmData[i] < 0 ? -pcmData[i] : pcmData[i]
            if (v > maxAbs) maxAbs = v
          }
          const now = Date.now()
          if (maxAbs >= 45) {
            lastActiveAudioMsRef.current[channelId] = now
            channelPauseFinalizedRef.current[channelId] = false
          }
          const silenceElapsedMs = now - lastActiveAudioMsRef.current[channelId]
          // 2.2s hangover guarantees Soniox receives full trailing silence, then emits ONE clean finalize
          if (silenceElapsedMs <= 2200) {
            const actualRate = engineRef.current?.getActualSampleRate() || TARGET_STREAM_SAMPLE_RATE
            const streamPcm = downsampleInt16Pcm(pcmData, actualRate, TARGET_STREAM_SAMPLE_RATE)
            if (streamPcm.length > 0) {
              sttManagerRef.current.sendAudio(channelId, streamPcm)
            }
          } else if (
            lastActiveAudioMsRef.current[channelId] > 0 &&
            !channelPauseFinalizedRef.current[channelId]
          ) {
            channelPauseFinalizedRef.current[channelId] = true
            sttManagerRef.current.finalizeChannelPause(channelId)
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
        if (isSpeech) {
          paragraphAccumulatorRef.current?.notifySpeechActivity(channelId)
        }
        setVadLatencyMs(latencyMs)
      },
      onSpeechStart: (event, preSpeechPcm) => {
        if (event.channelId === 'channel_a') {
          setSpeechEventsCountA((prev) => prev + 1)
        } else {
          setSpeechEventsCountB((prev) => prev + 1)
        }
        if (!sttManagerRef.current?.isGatewayAuthenticated()) {
          sttManagerRef.current?.sendAudio(event.channelId, preSpeechPcm)
        }
      },
      onSpeechFrame: (channelId, pcmData) => {
        if (!sttManagerRef.current?.isGatewayAuthenticated()) {
          sttManagerRef.current?.sendAudio(channelId, pcmData)
        }
      },
      onSpeechEnd: (event) => {
        sttManagerRef.current?.signalSpeechEnd(event.channelId)
      },
      onVadStatusChange: (status) => {
        setIsVadReady(status === 'ready')
      },
      onLoopbackStatusChange: (status, detail) => {
        setLoopbackStatus(status)
        setLoopbackStatusMessage(detail ?? null)
      },
      onDeviceDisconnected: (event) => {
        console.warn('[DUALAI] Audio hardware configuration changed:', event)
      },
      onError: (err) => {
        console.error('[DUALAI] Audio Engine error:', err)
        setHasPipelineError(true)
        setPipelineErrorMessage(err.message)
        setIsAudioActive(false)
        setIsInitializingAudio(false)
      }
    })

    engineRef.current = engine

    return () => {
      engine.stop()
    }
  }, [])

  // Start Audio Ingestion & Zero-Trust Gateway STT Pipeline
  const startAudioEngine = useCallback(async () => {
    if (!engineRef.current) return
    setHasPipelineError(false)
    setPipelineErrorMessage(null)

    // Pre-flight Zero-Trust Session & Gateway verification (catches unverified emails, expired tokens or offline Gateway)
    if (authSession) {
      if (authSession.user.emailVerified === false) {
        setPipelineErrorMessage(
          'Please verify your email address before activating your 1-hour free tier.'
        )
        setIsAccountModalOpen(true)
        return
      }

      let activeSession = authSession
      if (activeSession.expiresAtMs <= Date.now() + 60_000) {
        const refreshed = await refreshSessionToken(activeSession)
        if (refreshed) {
          activeSession = refreshed
          setAuthSession(refreshed)
          sttManagerRef.current?.setAccessToken(refreshed.accessToken, { silentRefresh: true })
          translationManagerRef.current?.setAccessToken(refreshed.accessToken)
        } else if (activeSession.expiresAtMs <= Date.now()) {
          await clearEncryptedSession()
          setAuthSession(null)
          setAccountQuota(null)
          sttManagerRef.current?.setAccessToken(null)
          translationManagerRef.current?.setAccessToken(null)
          setPipelineErrorMessage('Your session expired. Please sign in again to continue.')
          setIsAccountModalOpen(true)
          return
        }
      }
      try {
        const snapshot = await fetchAuthoritativeQuota(activeSession.accessToken)
        setAccountQuota(snapshot.quota)
        setAvailablePlans(snapshot.plans)
        if (snapshot.quota.remainingSeconds <= 0) {
          setPipelineErrorMessage(
            'Your 1-hour free interpretation quota has been used. Select a plan to continue.'
          )
          setIsAccountModalOpen(true)
          return
        }
      } catch (authErr) {
        const msg = authErr instanceof Error ? authErr.message : String(authErr)
        if (msg.includes('401')) {
          await clearEncryptedSession()
          setAuthSession(null)
          setAccountQuota(null)
          sttManagerRef.current?.setAccessToken(null)
          translationManagerRef.current?.setAccessToken(null)
          setPipelineErrorMessage('Your session token expired. Please sign in again under Account.')
          setIsAccountModalOpen(true)
          return
        }
        setPipelineErrorMessage(
          'Cannot reach DualAI Cloud Gateway. Make sure "pnpm run dev:gateway" is running.'
        )
        return
      }
    }

    setIsInitializingAudio(true)
    const activeRouting = routingDecisionRef.current
    try {
      await engineRef.current.start({
        noiseSuppression,
        echoCancellation,
        gainA: gainChannelA,
        gainB: gainChannelB,
        deviceIdA: selectedInputDeviceId,
        deviceIdB: selectedLoopbackDeviceId,
        captureChannelA: activeRouting.captureChannelA,
        captureChannelB: activeRouting.captureChannelB
      })
      sttManagerRef.current?.updateRouting({
        languageA: activeRouting.sttLangA,
        languageB: activeRouting.sttLangB,
        targetLanguageA: activeRouting.translationTargetA,
        targetLanguageB: activeRouting.translationTargetB,
        operatingMode,
        enableChannelA: activeRouting.captureChannelA,
        enableChannelB: activeRouting.captureChannelB,
        endpointingMs: resolveEndpointingMs(latencyMode),
        sampleRate: TARGET_STREAM_SAMPLE_RATE
      })
      sttManagerRef.current?.start()
      setIsAudioActive(true)
    } catch (err) {
      console.error('[DUALAI] Failed to start audio engine:', err)
      setHasPipelineError(true)
      setPipelineErrorMessage(err instanceof Error ? err.message : String(err))
      setIsAudioActive(false)
    } finally {
      setIsInitializingAudio(false)
    }
  }, [
    authSession,
    operatingMode,
    noiseSuppression,
    echoCancellation,
    gainChannelA,
    gainChannelB,
    selectedInputDeviceId,
    selectedLoopbackDeviceId,
    latencyMode
  ])

  // Stop Audio Ingestion & Terminate Sockets cleanly
  const stopAudioEngine = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.stop()
      setIsAudioActive(false)
      setIsInitializingAudio(false)
      setIsMonitorLoopbackActive(false)
      setPipelineErrorMessage(null)
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
    paragraphAccumulatorRef.current?.reset()
    clearDraftTimers()
    translationManagerRef.current?.cancelActive()
    setSttStatusA('disconnected')
    setSttStatusB('disconnected')
    setInterimTranscriptA(null)
    setInterimTranscriptB(null)
    setDraftTranslationA(null)
    setDraftTranslationB(null)
    setStreamingTranslations({})
  }, [clearDraftTimers])

  // Re-initialize hardware capture cleanly if user switches AudioRouteMode mid-session
  const prevAudioRouteRef = useRef<AudioRouteMode>(audioRoute)
  useEffect(() => {
    if (prevAudioRouteRef.current !== audioRoute) {
      prevAudioRouteRef.current = audioRoute
      if (isAudioActiveRef.current) {
        stopAudioEngine()
        void startAudioEngine()
      }
    }
  }, [audioRoute, stopAudioEngine, startAudioEngine])

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
    paragraphAccumulatorRef.current?.reset()
    clearDraftTimers()
    setTranslations([])
    setStreamingTranslations({})
    setDraftTranslationA(null)
    setDraftTranslationB(null)
    translationManagerRef.current?.clearHistory()
  }, [clearDraftTimers])

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

  // CARD-16: Zero-Latency Workspace Typography & View Personalization with HUD Synchronization
  const updateWorkspaceDisplaySettings = useCallback(
    (partial: Partial<WorkspaceDisplaySettings>) => {
      setWorkspaceDisplaySettings((prev) => {
        const next = sanitizeWorkspaceDisplaySettings({ ...prev, ...partial })
        try {
          localStorage.setItem(STORAGE_KEY_WORKSPACE_DISPLAY, JSON.stringify(next))
        } catch {
          // Ignore storage quota errors
        }

        if (next.syncTypographyToHud) {
          setHudSettings((prevHud) => {
            const syncedHud = mergeWorkspaceTypographyIntoHud(prevHud, next)
            window.electronAPI?.sendHudConfig?.(syncedHud)
            return syncedHud
          })
        }
        return next
      })
    },
    []
  )

  const resetWorkspaceDisplaySettings = useCallback(() => {
    updateWorkspaceDisplaySettings(DEFAULT_WORKSPACE_DISPLAY_SETTINGS)
  }, [updateWorkspaceDisplaySettings])

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

  const setSelectedLoopbackDeviceId = useCallback((deviceId: string) => {
    setSelectedLoopbackDeviceIdState(deviceId)
    try {
      localStorage.setItem(STORAGE_KEY_LOOPBACK_DEVICE, deviceId)
    } catch {
      // Ignore storage error
    }
  }, [])

  // Restore encrypted session from OS Keychain (Electron safeStorage) on boot
  useEffect(() => {
    let active = true
    void (async () => {
      const saved = await loadEncryptedSession()
      if (!active || !saved) return
      setAuthSession(saved)
      sttManagerRef.current?.setAccessToken(saved.accessToken)
      translationManagerRef.current?.setAccessToken(saved.accessToken)
      setSttProvider('deepgram-nova-2')
      setTranslationProvider('gemini-2.0-flash')
      try {
        const snapshot = await fetchAuthoritativeQuota(saved.accessToken)
        if (!active) return
        setAccountQuota(snapshot.quota)
        setAvailablePlans(snapshot.plans)
      } catch {
        // Gateway may be offline during local cold start; keep cached encrypted session
      }
    })()
    return () => {
      active = false
    }
  }, [])

  // Automatic Silent JWT Refresh loop preventing mid-session disconnects during 2-hour+ live calls
  useEffect(() => {
    if (!authSession) return
    let cancelled = false
    const delayMs = computeSilentRefreshDelayMs(authSession.expiresAtMs)

    const timer = setTimeout(() => {
      void (async () => {
        const refreshed = await refreshSessionToken(authSession)
        if (cancelled || !refreshed) return
        setAuthSession(refreshed)
        sttManagerRef.current?.setAccessToken(refreshed.accessToken, { silentRefresh: true })
        translationManagerRef.current?.setAccessToken(refreshed.accessToken)
      })()
    }, delayMs)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [authSession])

  const signInAccount = useCallback(
    async (
      email: string,
      password: string,
      mode: 'signin' | 'signup'
    ): Promise<{ emailVerificationRequired: boolean; message?: string }> => {
      const result = await signInWithEmailPassword(email, password, mode)
      if (result.emailVerificationRequired) {
        return {
          emailVerificationRequired: true,
          message: result.message
        }
      }
      setAuthSession(result.session)
      setAccountQuota(result.quota)
      setAvailablePlans(result.plans)
      sttManagerRef.current?.setAccessToken(result.session.accessToken)
      translationManagerRef.current?.setAccessToken(result.session.accessToken)
      setSttProvider('soniox-unified')
      setTranslationProvider('soniox-unified')
      setPipelineErrorMessage(null)
      return { emailVerificationRequired: false }
    },
    []
  )

  const signOutAccount = useCallback(async () => {
    const tokenToRevoke = authSession?.accessToken ?? null
    stopAudioEngine()
    await revokeServerSession(tokenToRevoke)
    await clearEncryptedSession()
    setAuthSession(null)
    setAccountQuota(null)
    sttManagerRef.current?.setAccessToken(null)
    translationManagerRef.current?.setAccessToken(null)
    setSttProvider('simulated-stt')
    setTranslationProvider('simulated-gemini')
  }, [authSession, stopAudioEngine])

  const requestPasswordResetAccount = useCallback(async (email: string): Promise<string> => {
    return requestPasswordReset(email)
  }, [])

  const resendVerificationEmailAccount = useCallback(async (email: string): Promise<string> => {
    return resendVerificationEmail(email)
  }, [])

  const refreshAccountQuota = useCallback(async () => {
    if (!authSession?.accessToken) return
    const snapshot = await fetchAuthoritativeQuota(authSession.accessToken)
    setAccountQuota(snapshot.quota)
    setAvailablePlans(snapshot.plans)
  }, [authSession])

  const startPlanCheckout = useCallback(
    async (planId: PlanId, provider: CheckoutProvider): Promise<CheckoutSessionResult> => {
      if (!authSession?.accessToken) {
        return { ok: false, error: 'Sign in first before starting checkout.' }
      }
      return createBillingCheckoutSession({
        accessToken: authSession.accessToken,
        planId,
        provider
      })
    },
    [authSession]
  )

  const verifyMsStoreReceipt = useCallback(
    async (storeIdKey: string, productId: string): Promise<{ verified: boolean; error?: string }> => {
      if (!authSession?.accessToken) {
        return { verified: false, error: 'Sign in required before verifying Store purchase.' }
      }
      const res = await verifyMicrosoftStorePurchase({
        accessToken: authSession.accessToken,
        storeIdKey,
        productId
      })
      if (res.verified) {
        await refreshAccountQuota()
      }
      return { verified: res.verified, error: res.error }
    },
    [authSession, refreshAccountQuota]
  )

  // Sync persisted global shortcuts into Electron Main on boot
  useEffect(() => {
    if (window.electronAPI?.updateGlobalShortcuts) {
      window.electronAPI.updateGlobalShortcuts(shortcutBindings)
    }
  }, [])

  // 5-second live Zero-Trust Gateway roundtrip telemetry ping (falls back cleanly when offline)
  useEffect(() => {
    let active = true
    const measurePing = async () => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)
      const t0 = performance.now()
      try {
        const res = await fetch(`${getGatewayHttpUrl()}/v1/health`, {
          method: 'GET',
          signal: controller.signal
        })
        if (active && res.ok) {
          setLatencyPingMs(Math.max(1, Math.round(performance.now() - t0)))
        }
      } catch {
        // Gateway offline: retain baseline mode latency estimate without noisy console errors
        if (active) {
          setLatencyPingMs(latencyMode === 'sub_second_live' ? 38 : 74)
        }
      } finally {
        clearTimeout(timeoutId)
      }
    }

    void measurePing()
    const pollInterval = setInterval(() => {
      void measurePing()
    }, 5000)

    return () => {
      active = false
      clearInterval(pollInterval)
    }
  }, [latencyMode])

  // Swap Source and Target Languages cleanly
  const swapLanguages = useCallback(() => {
    setSourceLang((prevSource) => {
      setTargetLang(prevSource)
      return targetLang
    })
  }, [targetLang])

  // Day 09: Global Spacebar Cough Mute Toggle (intercepts Space in workspace so focused buttons like Mini View never accidentally re-trigger)
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

      const insideModalOrMenu = Boolean(
        target?.closest('[role="dialog"], [role="listbox"], [role="menu"]')
      )

      if (e.code === 'Space' && !isEditable && !insideModalOrMenu) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) {
          toggleCoughMute()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
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
  const openSettingsModal = useCallback((initialTab?: unknown) => {
    if (
      initialTab === 'audio' ||
      initialTab === 'interpretation' ||
      initialTab === 'reading' ||
      initialTab === 'shortcuts' ||
      initialTab === 'privacy'
    ) {
      setSettingsInitialTab(initialTab)
    }
    setIsSettingsModalOpen(true)
  }, [])
  const closeSettingsModal = useCallback(() => setIsSettingsModalOpen(false), [])
  const openAccountModal = useCallback(() => setIsAccountModalOpen(true), [])
  const closeAccountModal = useCallback(() => setIsAccountModalOpen(false), [])

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
        settingsInitialTab,
        isAudioActive,
        isInitializingAudio,
        isCoughMuted,
        isMonitorLoopbackActive,
        selectedInputDeviceId,
        selectedLoopbackDeviceId,
        selectedOutputDeviceId,
        loopbackStatus,
        loopbackStatusMessage,
        pipelineErrorMessage,
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
        streamingTranslations,
        draftTranslationA,
        draftTranslationB,
        activeTranslation,
        translationLatencyMs,
        endToEndLatencyMs,
        translationProvider,
        isHudOpen,
        hudSettings,
        workspaceDisplaySettings,
        customGlossaryEntries,
        shortcutBindings,
        authSession,
        accountQuota,
        availablePlans,
        isAccountModalOpen,
        isGatewayAuthenticated,
        isQuotaExhausted,
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
        openAccountModal,
        closeAccountModal,
        startAudioEngine,
        stopAudioEngine,
        toggleCoughMute,
        setCoughMute,
        setGainChannelA,
        setGainChannelB,
        setVadThreshold,
        setSelectedInputDeviceId,
        setSelectedLoopbackDeviceId,
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
        updateWorkspaceDisplaySettings,
        resetWorkspaceDisplaySettings,
        addGlossaryEntry,
        importGlossaryEntries,
        removeGlossaryEntry,
        clearCustomGlossary,
        updateShortcutBinding,
        resetShortcutBindings,
        signInAccount,
        signOutAccount,
        requestPasswordResetAccount,
        resendVerificationEmailAccount,
        refreshAccountQuota,
        startPlanCheckout,
        verifyMsStoreReceipt
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
