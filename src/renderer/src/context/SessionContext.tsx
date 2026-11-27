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
  AccountSubscriptionSummary,
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
  resolveTranslationPairForUtterance,
  resolveEndpointingMs,
  sanitizeListenOnlyRoute
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
import { SmartSpeechGate } from '../audio/smartSpeechGate'
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
  resolveTurnPaneColors,
  sanitizeWorkspaceDisplaySettings
} from '../utils/typographyPreferences'
import {
  cancelUserSubscription,
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
  signInWithOAuthProvider,
  OAuthProvider,
  undoCancelUserSubscription,
  verifyMicrosoftStorePurchase
} from '../services/gatewayAuthService'

const STORAGE_KEY_HUD = 'dualai_hud_settings'
const STORAGE_KEY_GLOSSARY = 'dualai_custom_glossary'
const STORAGE_KEY_SHORTCUTS = 'dualai_shortcut_bindings'
const STORAGE_KEY_LOOPBACK_DEVICE = 'dualai_loopback_device_id'
const STORAGE_KEY_INPUT_DEVICE = 'dualai_input_device_id'
const STORAGE_KEY_OUTPUT_DEVICE = 'dualai_output_device_id'
const STORAGE_KEY_ACCOUNT_CACHE = 'dualai_account_display_cache'

interface AccountDisplayCache {
  userId: string
  quota: AccountQuota
  subscription: AccountSubscriptionSummary | null
  cachedAtMs: number
}

function readAccountDisplayCache(userId: string): AccountDisplayCache | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACCOUNT_CACHE)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AccountDisplayCache>
    if (
      parsed.userId !== userId ||
      !parsed.quota ||
      typeof parsed.quota.remainingSeconds !== 'number' ||
      typeof parsed.quota.totalAllocatedSeconds !== 'number'
    ) {
      return null
    }
    return {
      userId: parsed.userId,
      quota: parsed.quota,
      subscription: parsed.subscription ?? null,
      cachedAtMs: typeof parsed.cachedAtMs === 'number' ? parsed.cachedAtMs : Date.now()
    }
  } catch {
    return null
  }
}

function writeAccountDisplayCache(
  userId: string,
  quota: AccountQuota,
  subscription: AccountSubscriptionSummary | null
): void {
  try {
    const payload: AccountDisplayCache = {
      userId,
      quota,
      subscription,
      cachedAtMs: Date.now()
    }
    localStorage.setItem(STORAGE_KEY_ACCOUNT_CACHE, JSON.stringify(payload))
  } catch {
    // Ignore storage quota errors
  }
}

function clearAccountDisplayCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_ACCOUNT_CACHE)
  } catch {
    // Ignore storage errors
  }
}

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
  isSystemAudioMuted: boolean
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
  sttProvider:
    | 'soniox-unified'
    | 'deepgram-nova-3'
    | 'deepgram-nova-2'
    | 'whisper-turbo'
    | 'simulated-stt'
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
  accountSubscription: AccountSubscriptionSummary | null
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
  toggleSystemAudioMute: () => void
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
  signInWithOAuthAccount: (
    provider: OAuthProvider
  ) => Promise<{ emailVerificationRequired: boolean; message?: string }>
  signOutAccount: () => Promise<void>
  requestPasswordResetAccount: (email: string) => Promise<string>
  resendVerificationEmailAccount: (email: string) => Promise<string>
  refreshAccountQuota: (options?: { syncBilling?: boolean }) => Promise<void>
  cancelSubscriptionAccount: () => Promise<{
    ok: boolean
    subscription?: AccountSubscriptionSummary
    alreadyScheduled?: boolean
    message?: string
    error?: string
  }>
  undoCancelSubscriptionAccount: () => Promise<{
    ok: boolean
    subscription?: AccountSubscriptionSummary
    alreadyActive?: boolean
    message?: string
    error?: string
  }>
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
  const [audioRoute, setAudioRouteState] = useState<AudioRouteMode>('system')
  const setAudioRoute = useCallback((nextRoute: AudioRouteMode) => {
    setAudioRouteState(sanitizeListenOnlyRoute(nextRoute))
  }, [])
  const [operatingMode, setOperatingMode] = useState<OperatingMode>('translate')
  const [domainId, setDomainId] = useState<DomainId>('medical')
  const [sourceLang, setSourceLang] = useState('en')
  const [targetLang, setTargetLang] = useState('es')
  const [latencyMode] = useState<LatencyMode>('sentence_accurate')
  const setLatencyMode = useCallback((_mode: LatencyMode) => undefined, [])
  const [noiseSuppression, setNoiseSuppression] = useState(false)
  const [echoCancellation, setEchoCancellation] = useState(false)
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
  const [accountSubscription, setAccountSubscription] =
    useState<AccountSubscriptionSummary | null>(null)
  const [availablePlans, setAvailablePlans] = useState<BillingPlan[]>(DEFAULT_SAAS_PLANS)

  const quotaTotalHours = accountQuota ? accountQuota.totalAllocatedSeconds / 3600 : 1.0
  const quotaRemainingHours = accountQuota ? accountQuota.remainingSeconds / 3600 : 1.0
  const isGatewayAuthenticated = Boolean(authSession?.accessToken)
  const isQuotaExhausted = Boolean(accountQuota && accountQuota.remainingSeconds <= 0)

  // Audio Engine Ingestion & Hardware State
  const [isAudioActive, setIsAudioActive] = useState(false)
  const [isInitializingAudio, setIsInitializingAudio] = useState(false)
  const [isCoughMuted, setIsCoughMuted] = useState(false)
  const [isSystemAudioMuted, setIsSystemAudioMuted] = useState(false)
  const [isMonitorLoopbackActive, setIsMonitorLoopbackActive] = useState(false)
  const [hasPipelineError, setHasPipelineError] = useState(false)
  const [pipelineErrorMessage, setPipelineErrorMessage] = useState<string | null>(null)
  const [loopbackStatus, setLoopbackStatus] = useState<LoopbackSourceStatus>('inactive')
  const [loopbackStatusMessage, setLoopbackStatusMessage] = useState<string | null>(null)
  const [selectedInputDeviceId, setSelectedInputDeviceIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_INPUT_DEVICE) || 'default'
    } catch {
      return 'default'
    }
  })
  const [selectedLoopbackDeviceId, setSelectedLoopbackDeviceIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_LOOPBACK_DEVICE) || 'system_loopback'
    } catch {
      return 'system_loopback'
    }
  })
  const [selectedOutputDeviceId, setSelectedOutputDeviceIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_OUTPUT_DEVICE) || 'default'
    } catch {
      return 'default'
    }
  })
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
    'soniox-unified' | 'deepgram-nova-3' | 'deepgram-nova-2' | 'whisper-turbo' | 'simulated-stt'
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
  const operatingModeRef = useRef(operatingMode)
  const sourceLangRef = useRef(sourceLang)
  const targetLangRef = useRef(targetLang)
  const latencyModeRef = useRef(latencyMode)
  const routingDecisionRef = useRef(routingDecision)
  const isHudOpenRef = useRef(isHudOpen)
  const hudSettingsRef = useRef(hudSettings)
  const workspaceDisplaySettingsRef = useRef(workspaceDisplaySettings)
  const streamingTranslationsRef = useRef(streamingTranslations)
  const isAudioActiveRef = useRef(isAudioActive)
  const isCoughMutedRef = useRef(isCoughMuted)
  const speechGatesRef = useRef<Record<ChannelId, SmartSpeechGate>>({
    channel_a: new SmartSpeechGate(),
    channel_b: new SmartSpeechGate()
  })
  const telemetrySessionRef = useRef<{
    sessionId: string
    startedAtMs: number
    startedAtIso: string
    mode: OperatingMode
    pair: string
    domain: DomainId
  } | null>(null)
  const telemetryCheckpointTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const draftDebounceTimersRef = useRef<Partial<Record<ChannelId, ReturnType<typeof setTimeout>>>>(
    {}
  )
  const lastDraftRequestedRef = useRef<Partial<Record<ChannelId, { id: string; text: string }>>>({})
  const draftResultRef = useRef<Partial<Record<ChannelId, TranslationResult | null>>>({})
  const pendingCommitPromotionRef = useRef<
    Map<string, { committed: TranscriptUtterance; sourceLang: string; targetLang: string }>
  >(new Map())

  domainIdRef.current = domainId
  operatingModeRef.current = operatingMode
  sourceLangRef.current = sourceLang
  targetLangRef.current = targetLang
  latencyModeRef.current = latencyMode
  routingDecisionRef.current = routingDecision
  isHudOpenRef.current = isHudOpen
  hudSettingsRef.current = hudSettings
  workspaceDisplaySettingsRef.current = workspaceDisplaySettings
  streamingTranslationsRef.current = streamingTranslations
  isAudioActiveRef.current = isAudioActive

  const emitHudTurn = useCallback(
    (params: {
      id: string
      speakerId: string
      speakerLabel: string
      sourceText: string
      translatedText: string
      spokenLang?: string
      translatedLang?: string
      timestampMs: number
      isInterim: boolean
    }) => {
      if (!isHudOpenRef.current || !window.electronAPI?.sendHudTranscript) return
      const { originalColor, translationColor } = resolveTurnPaneColors({
        spokenLang: params.spokenLang,
        translatedLang: params.translatedLang,
        sourceLang: sourceLangRef.current,
        targetLang: targetLangRef.current,
        operatingMode: operatingModeRef.current,
        settings: workspaceDisplaySettingsRef.current
      })
      window.electronAPI.sendHudTranscript({
        id: params.id,
        speakerId: params.speakerId,
        speakerLabel: params.speakerLabel,
        sourceText: params.sourceText,
        translatedText: params.translatedText,
        originalColor,
        translationColor,
        timestampMs: params.timestampMs,
        isInterim: params.isInterim
      })
    },
    []
  )

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
        pendingCommitPromotionRef.current.clear()
      }
    }
  }, [])

  // Resolve Master Pipeline Finite State Machine (Day 09)
  // Note: OS-level call mic mute (isCoughMuted) mutes your mic across Zoom/Teams/calls
  // without pausing DualAI's System Audio interpretation (isSystemAudioMuted).
  const pipelineState = useMemo<PipelineStateSnapshot>(
    () =>
      resolvePipelineState({
        isAudioActive,
        isInitializing: isInitializingAudio,
        isMuted: isSystemAudioMuted,
        isSpeechActiveA: false,
        isSpeechActiveB,
        hasInterimTranscript: Boolean(interimTranscriptB),
        isTranslating: Boolean(activeTranslation),
        sttStatusA: 'disconnected',
        sttStatusB,
        hasError: hasPipelineError,
        bufferSamplesA: 0,
        bufferSamplesB
      }),
    [
      isAudioActive,
      isInitializingAudio,
      isSystemAudioMuted,
      isSpeechActiveB,
      interimTranscriptB,
      activeTranslation,
      sttStatusB,
      hasPipelineError,
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
          emitHudTurn({
            id: result.utteranceId,
            speakerId: result.channelId,
            speakerLabel: result.speakerLabel,
            sourceText: result.sourceText,
            translatedText: result.translatedText,
            spokenLang: result.sourceLang,
            translatedLang: result.targetLang,
            timestampMs: result.timestampMs,
            isInterim: true
          })
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
          emitHudTurn({
            id: result.utteranceId,
            speakerId: result.channelId,
            speakerLabel: result.speakerLabel,
            sourceText: result.sourceText,
            translatedText: result.translatedText,
            spokenLang: result.sourceLang,
            translatedLang: result.targetLang,
            timestampMs: result.timestampMs,
            isInterim: false
          })
        },
        onDraftStart: (result) => {
          // Option A: Keep in-flight tokens silent in RAM (zero partial-word flicker on screen)
          draftResultRef.current[result.channelId] = { ...result, isStreaming: true }
        },
        onDraftToken: (utteranceId, _token, accumulatedText) => {
          const updateCached = (channelId: ChannelId): void => {
            const prev = draftResultRef.current[channelId]
            if (!prev || prev.utteranceId !== utteranceId) return
            draftResultRef.current[channelId] = {
              ...prev,
              translatedText: accumulatedText,
              isStreaming: true
            }
          }
          updateCached('channel_a')
          updateCached('channel_b')
        },
        onDraftComplete: (result) => {
          const finalizedDraft: TranslationResult = {
            ...result,
            isStreaming: false,
            isComplete: true
          }

          // If the paragraph already committed while this exact translation was in-flight,
          // promote directly into finalized translations with zero abort & zero duplicate API call.
          const pendingCommit = pendingCommitPromotionRef.current.get(result.utteranceId)
          if (pendingCommit) {
            pendingCommitPromotionRef.current.delete(result.utteranceId)
            const { committed, sourceLang: pSrc, targetLang: pTgt } = pendingCommit
            const promoted: TranslationResult = {
              ...finalizedDraft,
              id: `trans-${committed.id}`,
              utteranceId: committed.id,
              sourceLang: pSrc,
              targetLang: pTgt,
              sourceText: committed.text,
              isStreaming: false,
              isComplete: true
            }
            setStreamingTranslations((prev) => {
              const next = { ...prev }
              delete next[committed.id]
              return next
            })
            setTranslations((prev) => {
              const filtered = prev.filter((t) => t.utteranceId !== committed.id)
              return [...filtered.slice(-999), promoted]
            })
            translationManagerRef.current?.appendDialogueTurn({
              id: `turn-${committed.id}`,
              channelId: committed.channelId,
              speakerLabel: committed.speakerLabel,
              sourceLang: pSrc,
              targetLang: pTgt,
              sourceText: committed.text,
              translatedText: promoted.translatedText,
              domainId: domainIdRef.current,
              timestampMs: Date.now()
            })
            emitHudTurn({
              id: committed.id,
              speakerId: committed.speakerId || committed.channelId,
              speakerLabel: committed.speakerLabel,
              sourceText: committed.text,
              translatedText: promoted.translatedText,
              spokenLang: pSrc,
              translatedLang: pTgt,
              timestampMs: committed.timestampMs,
              isInterim: false
            })
            return
          }

          // Option A atomic reveal: display the complete translated paragraph immediately (~0.9s)
          // without waiting for the 2.2s paragraph-grouping timer.
          const existing = draftResultRef.current[result.channelId]
          if (!existing || existing.utteranceId === result.utteranceId) {
            draftResultRef.current[result.channelId] = finalizedDraft
            if (result.channelId === 'channel_a') {
              setDraftTranslationA(finalizedDraft)
            } else {
              setDraftTranslationB(finalizedDraft)
            }
            emitHudTurn({
              id: finalizedDraft.utteranceId,
              speakerId: finalizedDraft.speakerId || finalizedDraft.channelId,
              speakerLabel: finalizedDraft.speakerLabel,
              sourceText: finalizedDraft.sourceText,
              translatedText: finalizedDraft.translatedText,
              spokenLang: finalizedDraft.sourceLang,
              translatedLang: finalizedDraft.targetLang,
              timestampMs: finalizedDraft.timestampMs,
              isInterim: false
            })
          }
        },
        onDraftError: (utteranceId, err) => {
          const pendingCommit = pendingCommitPromotionRef.current.get(utteranceId)
          if (pendingCommit) {
            pendingCommitPromotionRef.current.delete(utteranceId)
            setStreamingTranslations((prev) => {
              const next = { ...prev }
              delete next[pendingCommit.committed.id]
              return next
            })
            emitHudTurn({
              id: pendingCommit.committed.id,
              speakerId: pendingCommit.committed.speakerId || pendingCommit.committed.channelId,
              speakerLabel: pendingCommit.committed.speakerLabel,
              sourceText: pendingCommit.committed.text,
              translatedText: '',
              spokenLang: pendingCommit.sourceLang,
              translatedLang: pendingCommit.targetLang,
              timestampMs: pendingCommit.committed.timestampMs,
              isInterim: false
            })
            setPipelineErrorMessage(err.message)
          }
          for (const ch of ['channel_a', 'channel_b'] as ChannelId[]) {
            if (draftResultRef.current[ch]?.utteranceId === utteranceId) {
              draftResultRef.current[ch] = null
            }
          }
        },
        onTelemetry: (telemetry) => {
          setTranslationLatencyMs(telemetry.timeToFirstTokenMs)
          setEndToEndLatencyMs(telemetry.endToEndLatencyMs)
          setTranslationProvider(telemetry.provider)
        },
        onError: (err, utteranceId) => {
          console.warn('[DUALAI-SESSION] Translation Error:', err)
          if (utteranceId) {
            const failed = streamingTranslationsRef.current[utteranceId]
            setStreamingTranslations((prev) => {
              if (!(utteranceId in prev)) return prev
              const next = { ...prev }
              delete next[utteranceId]
              return next
            })
            if (failed) {
              emitHudTurn({
                id: failed.utteranceId,
                speakerId: failed.speakerId || failed.channelId,
                speakerLabel: failed.speakerLabel,
                sourceText: failed.sourceText,
                translatedText: '',
                spokenLang: failed.sourceLang,
                translatedLang: failed.targetLang,
                timestampMs: failed.timestampMs,
                isInterim: false
              })
            }
          }
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

  const flushAndStopClientTelemetry = useCallback(() => {
    if (telemetryCheckpointTimerRef.current) {
      clearInterval(telemetryCheckpointTimerRef.current)
      telemetryCheckpointTimerRef.current = null
    }
    if (telemetrySessionRef.current && window.electronAPI?.recordClientTelemetry) {
      const meta = telemetrySessionRef.current
      telemetrySessionRef.current = null
      const gateStats = speechGatesRef.current.channel_b.getStats()
      const tokStats = sttManagerRef.current?.getTokenTelemetry() || {
        finalOriginalTokens: 0,
        finalTranslationTokens: 0,
        finalizesSent: 0
      }
      window.electronAPI.recordClientTelemetry({
        sessionId: meta.sessionId,
        startedAtIso: meta.startedAtIso,
        endedAtIso: new Date().toISOString(),
        status: 'closed',
        gatewayUrl: getGatewayHttpUrl(),
        mode: meta.mode,
        pair: meta.pair,
        domain: meta.domain,
        wallClockMs: Math.max(0, Date.now() - meta.startedAtMs),
        audioSecondsCaptured:
          Math.round((gateStats.totalInputSamples / TARGET_STREAM_SAMPLE_RATE) * 100) / 100,
        audioSecondsSent:
          Math.round((gateStats.totalSentSamples / TARGET_STREAM_SAMPLE_RATE) * 100) / 100,
        audioSecondsSuppressed:
          Math.round((gateStats.suppressedSamples / TARGET_STREAM_SAMPLE_RATE) * 100) / 100,
        audioSecondsEchoBlocked:
          Math.round((gateStats.echoBlockedSamples / TARGET_STREAM_SAMPLE_RATE) * 100) / 100,
        finalOriginalTokens: tokStats.finalOriginalTokens,
        finalTranslationTokens: tokStats.finalTranslationTokens,
        finalizesSent: tokStats.finalizesSent
      })
    }
  }, [])

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

          // Compact Stacked Mini View parity: stream live original text immediately on top
          const cachedDraft = draftResultRef.current[draft.channelId]
          const readyTranslatedText =
            cachedDraft && cachedDraft.utteranceId === draft.id && cachedDraft.isComplete
              ? cachedDraft.translatedText
              : ''
          emitHudTurn({
            id: draft.id,
            speakerId: draft.speakerId || draft.channelId,
            speakerLabel: draft.speakerLabel,
            sourceText: draft.text,
            translatedText: readyTranslatedText,
            spokenLang: draft.language,
            timestampMs: draft.timestampMs,
            isInterim: true
          })

          // Option A sub-second trigger: never fire Gemini on unstable raw interims.
          // Fire IMMEDIATELY (0ms debounce) on Deepgram speech_final: true so the complete
          // translation lands on screen in ~0.85s-0.96s without waiting for the 2.2s commit timer.
          if (!meta.isClauseFinalized) {
            return
          }

          const normalized = normalizeTextForMatch(draft.text)
          const prevReq = lastDraftRequestedRef.current[draft.channelId]
          if (prevReq && prevReq.id === draft.id && prevReq.text === normalized) {
            return
          }

          const endsSentence = /[.!?。？！]["”'»)]*$/.test(draft.text.trim())
          if (!meta.isSpeechFinal && !endsSentence) {
            return
          }

          const existingTimer = draftDebounceTimersRef.current[draft.channelId]
          if (existingTimer) {
            clearTimeout(existingTimer)
          }

          const firePrefetch = (): void => {
            delete draftDebounceTimersRef.current[draft.channelId]
            lastDraftRequestedRef.current[draft.channelId] = {
              id: draft.id,
              text: normalized
            }
            const pair = resolveTranslationPairForUtterance({
              utteranceLang: draft.language,
              channelId: draft.channelId,
              decision: routingDecisionRef.current,
              operatingMode: operatingModeRef.current,
              sourceLang: sourceLangRef.current,
              targetLang: targetLangRef.current
            })
            void translationManagerRef.current?.translateDraftPreview(
              draft,
              domainIdRef.current,
              pair.targetLang,
              operatingModeRef.current,
              pair.sourceLang
            )
          }

          if (meta.isSpeechFinal) {
            firePrefetch()
          } else {
            draftDebounceTimersRef.current[draft.channelId] = setTimeout(firePrefetch, 350)
          }
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

          const pair = resolveTranslationPairForUtterance({
            utteranceLang: committed.language,
            channelId: committed.channelId,
            decision: routingDecisionRef.current,
            operatingMode: operatingModeRef.current,
            sourceLang: sourceLangRef.current,
            targetLang: targetLangRef.current
          })
          const target = pair.targetLang

          // Instant 0ms promotion: if silent background prefetch already translated this exact paragraph,
          // reveal the complete translation immediately with zero "Translating..." wait and zero extra API call.
          const canPromoteDraftImmediately =
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
              sourceLang: pair.sourceLang,
              targetLang: target,
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
              sourceLang: pair.sourceLang,
              targetLang: target,
              sourceText: committed.text,
              translatedText: promoted.translatedText,
              domainId: domainIdRef.current,
              timestampMs: Date.now()
            })
            emitHudTurn({
              id: committed.id,
              speakerId: committed.speakerId || committed.channelId,
              speakerLabel: committed.speakerLabel,
              sourceText: committed.text,
              translatedText: promoted.translatedText,
              spokenLang: pair.sourceLang,
              translatedLang: target,
              timestampMs: committed.timestampMs,
              isInterim: false
            })
            return
          }

          // If an identical background translation is STILL in-flight, promote its AbortController
          // into finalControllers so subsequent speaker drafts cannot abort it (zero double-call).
          const isMatchingInFlightDraft =
            Boolean(latestDraft) &&
            latestDraft?.utteranceId === committed.id &&
            latestDraft?.isStreaming &&
            normalizeTextForMatch(latestDraft.sourceText) === normalizeTextForMatch(committed.text)

          if (
            isMatchingInFlightDraft &&
            latestDraft &&
            translationManagerRef.current?.promoteDraftToFinal(committed.channelId, committed.id)
          ) {
            pendingCommitPromotionRef.current.set(committed.id, {
              committed,
              sourceLang: pair.sourceLang,
              targetLang: target
            })
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
            target,
            operatingModeRef.current,
            pair.sourceLang
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

          emitHudTurn({
            id: utterance.id,
            speakerId: utterance.speakerId || utterance.channelId,
            speakerLabel: utterance.speakerLabel,
            sourceText: utterance.text,
            translatedText: translation.translatedText,
            spokenLang: utterance.language,
            translatedLang: translation.targetLang,
            timestampMs: utterance.timestampMs,
            isInterim: true
          })
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

          emitHudTurn({
            id: utterance.id,
            speakerId: utterance.speakerId || utterance.channelId,
            speakerLabel: utterance.speakerLabel,
            sourceText: utterance.text,
            translatedText: translation.translatedText,
            spokenLang: utterance.language,
            translatedLang: translation.targetLang,
            timestampMs: utterance.timestampMs,
            isInterim: false
          })
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
          emitHudTurn({
            id: utterance.id,
            speakerId: utterance.speakerId || utterance.channelId,
            speakerLabel: utterance.speakerLabel,
            sourceText: utterance.text,
            translatedText: translation.translatedText,
            spokenLang: utterance.language,
            translatedLang: translation.targetLang,
            timestampMs: utterance.timestampMs,
            isInterim: false
          })
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
          if (/restarting|reconnecting/i.test(err.message)) {
            return
          }
          setPipelineErrorMessage(
            `Connection interrupted (${err.message}). Check your internet connection or sign in again under Account.`
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
          flushAndStopClientTelemetry()
          engineRef.current?.stop()
          speechGatesRef.current.channel_a.reset()
          speechGatesRef.current.channel_b.reset()
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

  useEffect(() => {
    engineRef.current?.setEchoBlockerEnabled(echoCancellation)
  }, [echoCancellation])

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
        // Listen-only architecture: strictly stream Channel B (System Audio / Call Loopback)
        // through SmartSpeechGate; local microphone (Channel A) is never captured or sent to Soniox.
        // When local self-voice echo blocker detects the interpreter speaking, call return echo/sidetone
        // in System Audio is suppressed so the interpreter's own voice is never translated.
        if (sttManagerRef.current?.isGatewayAuthenticated()) {
          if (channelId !== 'channel_b') {
            return
          }
          if (engineRef.current?.getIsSystemAudioMuted()) {
            return
          }
          const actualRate = engineRef.current?.getActualSampleRate() || TARGET_STREAM_SAMPLE_RATE
          const streamPcm = downsampleInt16Pcm(pcmData, actualRate, TARGET_STREAM_SAMPLE_RATE)
          if (streamPcm.length > 0) {
            const nowMs = Date.now()
            const suppressAsSelfEcho = engineRef.current?.getIsLocalUserSpeaking(nowMs) ?? false
            const gateResult = speechGatesRef.current.channel_b.processChunk(streamPcm, nowMs, {
              suppressAsSelfEcho
            })
            for (const batchedFrame of gateResult.framesToSend) {
              sttManagerRef.current.sendAudio('channel_b', batchedFrame)
            }
            if (gateResult.shouldFinalize) {
              sttManagerRef.current.finalizeChannelPause('channel_b')
            }
          }
        }
      },
      onVadTelemetry: (channelId, prob, isSpeech, latencyMs) => {
        speechGatesRef.current[channelId].updateVadTelemetry(prob, isSpeech, Date.now())
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
        const ready = status === 'ready'
        speechGatesRef.current.channel_a.setVadReady(ready)
        speechGatesRef.current.channel_b.setVadReady(ready)
        setIsVadReady(ready)
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
      flushAndStopClientTelemetry()
      engine.dispose()
    }
  }, [flushAndStopClientTelemetry])

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
          'Unable to reach the DualAI translation service. Check your internet connection and try again.'
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
        outputDeviceId: selectedOutputDeviceId,
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
      sttManagerRef.current?.resetTokenTelemetry()
      sttManagerRef.current?.start()
      setIsAudioActive(true)

      const nowMs = Date.now()
      telemetrySessionRef.current = {
        sessionId: `client-${nowMs}-${Math.random().toString(36).slice(2, 8)}`,
        startedAtMs: nowMs,
        startedAtIso: new Date(nowMs).toISOString(),
        mode: operatingMode,
        pair: `${sourceLangRef.current}<->${targetLangRef.current}`,
        domain: domainIdRef.current
      }
      if (telemetryCheckpointTimerRef.current) {
        clearInterval(telemetryCheckpointTimerRef.current)
      }
      telemetryCheckpointTimerRef.current = setInterval(() => {
        const meta = telemetrySessionRef.current
        if (!meta || !window.electronAPI?.recordClientTelemetry) return
        const gateStats = speechGatesRef.current.channel_b.getStats()
        const tokStats = sttManagerRef.current?.getTokenTelemetry() || {
          finalOriginalTokens: 0,
          finalTranslationTokens: 0,
          finalizesSent: 0
        }
        window.electronAPI.recordClientTelemetry({
          sessionId: meta.sessionId,
          startedAtIso: meta.startedAtIso,
          endedAtIso: null,
          status: 'active',
          gatewayUrl: getGatewayHttpUrl(),
          mode: meta.mode,
          pair: meta.pair,
          domain: meta.domain,
          wallClockMs: Math.max(0, Date.now() - meta.startedAtMs),
          audioSecondsCaptured: Math.round((gateStats.totalInputSamples / TARGET_STREAM_SAMPLE_RATE) * 100) / 100,
          audioSecondsSent: Math.round((gateStats.totalSentSamples / TARGET_STREAM_SAMPLE_RATE) * 100) / 100,
          audioSecondsSuppressed: Math.round((gateStats.suppressedSamples / TARGET_STREAM_SAMPLE_RATE) * 100) / 100,
          audioSecondsEchoBlocked: Math.round((gateStats.echoBlockedSamples / TARGET_STREAM_SAMPLE_RATE) * 100) / 100,
          finalOriginalTokens: tokStats.finalOriginalTokens,
          finalTranslationTokens: tokStats.finalTranslationTokens,
          finalizesSent: tokStats.finalizesSent
        })
      }, 15_000)
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
    selectedOutputDeviceId,
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
    flushAndStopClientTelemetry()
    speechGatesRef.current.channel_a.reset()
    speechGatesRef.current.channel_b.reset()
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

  // Sync initial OS-wide call microphone mute state on boot
  useEffect(() => {
    let active = true
    if (window.electronAPI?.getSystemMicMute) {
      void window.electronAPI
        .getSystemMicMute()
        .then((res) => {
          if (active && typeof res?.muted === 'boolean') {
            setIsCoughMuted(res.muted)
          }
        })
        .catch(() => {
          // Ignore non-Electron browser preview
        })
    }
    return () => {
      active = false
    }
  }, [])

  // OS-Wide System Call Microphone Mute (mutes your mic across Zoom/Teams/Meet/calls during hold/silence;
  // does NOT capture mic audio or affect Soniox listening to System Audio)
  const applyOsMicMute = useCallback((muted: boolean) => {
    isCoughMutedRef.current = muted
    setIsCoughMuted(muted)
    if (window.electronAPI?.setSystemMicMute) {
      void window.electronAPI
        .setSystemMicMute(muted)
        .then((res) => {
          if (res && typeof res.muted === 'boolean' && res.muted !== muted) {
            isCoughMutedRef.current = res.muted
            setIsCoughMuted(res.muted)
          }
        })
        .catch(() => {
          // Keep optimistic UI state in non-Electron environments
        })
    }
  }, [])

  const setCoughMute = useCallback(
    (muted: boolean) => {
      applyOsMicMute(muted)
    },
    [applyOsMicMute]
  )

  const toggleCoughMute = useCallback(() => {
    // Read ref outside state updater so React 18 StrictMode never double-fires IPC
    applyOsMicMute(!isCoughMutedRef.current)
  }, [applyOsMicMute])

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
    const syncedHud = mergeWorkspaceTypographyIntoHud(
      hudSettingsRef.current,
      workspaceDisplaySettingsRef.current
    )
    setHudSettings(syncedHud)
    if (window.electronAPI?.openHud) {
      await window.electronAPI.openHud(syncedHud.bounds)
      window.electronAPI.sendHudConfig?.(syncedHud)
      await window.electronAPI.setHudClickThrough?.(syncedHud.isClickThrough)
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

        // Always sync Compact Stacked / Dual Pane typography and language colors into Mini View
        setHudSettings((prevHud) => {
          const syncedHud = mergeWorkspaceTypographyIntoHud(prevHud, next)
          window.electronAPI?.sendHudConfig?.(syncedHud)
          return syncedHud
        })
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

  const setSelectedInputDeviceId = useCallback(
    (deviceId: string) => {
      const next = deviceId || 'default'
      setSelectedInputDeviceIdState(next)
      try {
        localStorage.setItem(STORAGE_KEY_INPUT_DEVICE, next)
      } catch {
        // Ignore storage error
      }
      if (engineRef.current?.getIsRunning()) {
        void engineRef.current
          .switchInputDevice(next, { noiseSuppression, echoCancellation })
          .catch((err) => {
            console.warn('[DUALAI] Live microphone switch failed:', err)
          })
      }
    },
    [noiseSuppression, echoCancellation]
  )

  const setSelectedOutputDeviceId = useCallback((deviceId: string) => {
    const next = deviceId || 'default'
    setSelectedOutputDeviceIdState(next)
    try {
      localStorage.setItem(STORAGE_KEY_OUTPUT_DEVICE, next)
    } catch {
      // Ignore storage error
    }
    void engineRef.current?.setOutputDevice(next)
  }, [])

  const toggleSystemAudioMute = useCallback(() => {
    setIsSystemAudioMuted((prev) => {
      const next = !prev
      engineRef.current?.setSystemAudioMuted(next)
      if (next) {
        speechGatesRef.current.channel_b.forceMuteClose()
        sttManagerRef.current?.pauseChannel('channel_b')
        setIsSpeechActiveB(false)
        setVadProbabilityB(0)
      }
      return next
    })
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
      // Hydrate last-known non-sensitive display quota immediately in the same render batch (zero 1h flash)
      const cached = readAccountDisplayCache(saved.user.userId)
      setAuthSession(saved)
      if (cached) {
        setAccountQuota(cached.quota)
        setAccountSubscription(cached.subscription)
      }
      sttManagerRef.current?.setAccessToken(saved.accessToken)
      translationManagerRef.current?.setAccessToken(saved.accessToken)
      setSttProvider('soniox-unified')
      setTranslationProvider('soniox-unified')
      try {
        const snapshot = await fetchAuthoritativeQuota(saved.accessToken)
        if (!active) return
        setAccountQuota(snapshot.quota)
        setAccountSubscription(snapshot.subscription)
        setAvailablePlans(snapshot.plans)
        writeAccountDisplayCache(saved.user.userId, snapshot.quota, snapshot.subscription)
      } catch {
        // Gateway may be offline during local cold start; keep cached encrypted session
      }
    })()
    return () => {
      active = false
    }
  }, [])

  // Keep display-only quota/subscription cache synced (including live session metering)
  useEffect(() => {
    if (authSession?.user?.userId && accountQuota) {
      writeAccountDisplayCache(authSession.user.userId, accountQuota, accountSubscription)
    }
  }, [authSession?.user?.userId, accountQuota, accountSubscription])

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
      setAccountSubscription(result.subscription)
      setAvailablePlans(result.plans)
      writeAccountDisplayCache(result.session.user.userId, result.quota, result.subscription)
      sttManagerRef.current?.setAccessToken(result.session.accessToken)
      translationManagerRef.current?.setAccessToken(result.session.accessToken)
      setSttProvider('soniox-unified')
      setTranslationProvider('soniox-unified')
      setPipelineErrorMessage(null)
      return { emailVerificationRequired: false }
    },
    []
  )

  const signInWithOAuthAccount = useCallback(
    async (
      provider: OAuthProvider
    ): Promise<{ emailVerificationRequired: boolean; message?: string }> => {
      const result = await signInWithOAuthProvider(provider)
      if (result.emailVerificationRequired) {
        return {
          emailVerificationRequired: true,
          message: result.message
        }
      }
      setAuthSession(result.session)
      setAccountQuota(result.quota)
      setAccountSubscription(result.subscription)
      setAvailablePlans(result.plans)
      writeAccountDisplayCache(result.session.user.userId, result.quota, result.subscription)
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
    clearAccountDisplayCache()
    setAuthSession(null)
    setAccountQuota(null)
    setAccountSubscription(null)
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

  const refreshAccountQuota = useCallback(
    async (options?: { syncBilling?: boolean }) => {
      if (!authSession?.accessToken) return
      const snapshot = await fetchAuthoritativeQuota(authSession.accessToken, options)
      setAccountQuota(snapshot.quota)
      setAccountSubscription(snapshot.subscription)
      setAvailablePlans(snapshot.plans)
      writeAccountDisplayCache(authSession.user.userId, snapshot.quota, snapshot.subscription)
    },
    [authSession]
  )

  const cancelSubscriptionAccount = useCallback(async (): Promise<{
    ok: boolean
    subscription?: AccountSubscriptionSummary
    alreadyScheduled?: boolean
    message?: string
    error?: string
  }> => {
    if (!authSession?.accessToken) {
      return { ok: false, error: 'Sign in first before managing your subscription.' }
    }
    const res = await cancelUserSubscription(authSession.accessToken)
    if (res.subscription) {
      setAccountSubscription(res.subscription)
      if (accountQuota) {
        writeAccountDisplayCache(authSession.user.userId, accountQuota, res.subscription)
      }
    }
    if (res.ok) {
      await refreshAccountQuota().catch(() => undefined)
      return {
        ok: true,
        subscription: res.subscription,
        alreadyScheduled: res.alreadyScheduled,
        message: res.message
      }
    }
    if (res.subscription) {
      await refreshAccountQuota().catch(() => undefined)
    }
    return {
      ok: false,
      subscription: res.subscription,
      error: res.error || 'Could not cancel subscription.'
    }
  }, [authSession, accountQuota, refreshAccountQuota])

  const undoCancelSubscriptionAccount = useCallback(async (): Promise<{
    ok: boolean
    subscription?: AccountSubscriptionSummary
    alreadyActive?: boolean
    message?: string
    error?: string
  }> => {
    if (!authSession?.accessToken) {
      return { ok: false, error: 'Sign in first before managing your subscription.' }
    }
    const res = await undoCancelUserSubscription(authSession.accessToken)
    if (res.subscription) {
      setAccountSubscription(res.subscription)
      if (accountQuota) {
        writeAccountDisplayCache(authSession.user.userId, accountQuota, res.subscription)
      }
    }
    if (res.ok) {
      await refreshAccountQuota().catch(() => undefined)
      return {
        ok: true,
        subscription: res.subscription,
        alreadyActive: res.alreadyActive,
        message: res.message
      }
    }
    if (res.subscription) {
      await refreshAccountQuota().catch(() => undefined)
    }
    return {
      ok: false,
      subscription: res.subscription,
      error: res.error || 'Could not keep subscription.'
    }
  }, [authSession, accountQuota, refreshAccountQuota])

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
        isSystemAudioMuted,
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
        accountSubscription,
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
        toggleSystemAudioMute,
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
        signInWithOAuthAccount,
        signOutAccount,
        requestPasswordResetAccount,
        resendVerificationEmailAccount,
        refreshAccountQuota,
        cancelSubscriptionAccount,
        undoCancelSubscriptionAccount,
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
