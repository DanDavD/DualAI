/**
 * DUALAI ZERO-TRUST CLOUD GATEWAY - Gemini 2.0 Flash Streaming Proxy (SSE)
 * Holds GEMINI_API_KEY strictly on the server.
 * Enforces strict payload size caps, server-side domain system prompt injection,
 * authoritative quota checks, and HIPAA/GDPR Zero-Data Retention (no text persisted).
 */

import { ServerResponse } from 'node:http'
import { GoogleGenAI } from '@google/genai'
import { GatewayConfig } from '../config.js'
import { AuthenticatedUser } from '../security/authVerifier.js'
import { GatewayRateLimiter } from '../security/rateLimiter.js'
import { QuotaStore, UserQuotaRecord } from '../quota/quotaStore.js'

export interface TranslateProxyPayload {
  sourceText: string
  sourceLang: string
  targetLang: string
  operatingMode?: 'translate' | 'conversation'
  domainId: string
  speakerLabel?: string
  dialogueHistory?: Array<{
    speakerLabel: string
    sourceText: string
    translatedText: string
  }>
  customGlossary?: Record<string, string>
}

const STT_REPAIR_GUIDANCE =
  'The input comes from live real-time speech-to-text and may contain occasional phonetic mishearings, stray punctuation, or brief cross-language slips (e.g. a Portuguese word like "primeiro" or "e" inside Spanish speech). Silently infer the speaker\'s true intended meaning from context and domain vocabulary before translating. Preserve every conditional ("if"/"si"), negation ("not"/"no"), and speaker intent accurately even in colloquial or disfluent speech—never invert meaning. Never explain corrections; output ONLY the clean, natural translation.'

const DOMAIN_INSTRUCTIONS: Record<string, string> = {
  medical: `You are an expert clinical medical interpreter. Strictly follow ICD-10 anatomical nomenclature and pharmacological precision. Preserve all dosages, units, and numeric vitals verbatim. ${STT_REPAIR_GUIDANCE}`,
  legal: `You are a certified courtroom legal interpreter. Translate legal terms of art verbatim without colloquialisms, paraphrases, or softening. Preserve all statute numbers, dates, and monetary sums verbatim. ${STT_REPAIR_GUIDANCE}`,
  technical: `You are a systems engineering interpreter. Preserve technical acronyms, protocols, code identifiers, and numerical metrics accurately. ${STT_REPAIR_GUIDANCE}`,
  business: `You are an executive business interpreter. Use formal corporate register and preserve financial figures, percentages, and KPIs verbatim. ${STT_REPAIR_GUIDANCE}`,
  general: `You are a real-time professional simultaneous interpreter. Provide an accurate, natural, low-latency translation preserving all numbers and proper nouns. ${STT_REPAIR_GUIDANCE}`
}

const MAX_SOURCE_TEXT_LENGTH = 4000
const MAX_GLOSSARY_ENTRIES = 50
const MAX_HISTORY_TURNS = 4
const QUOTA_CACHE_TTL_MS = 8000
const MAX_QUOTA_CACHE_ENTRIES = 2000

interface CachedQuotaEntry {
  remainingSeconds: number
  subscriptionStatus: UserQuotaRecord['subscriptionStatus']
  fetchedAtMs: number
}

const translateQuotaCache = new Map<string, CachedQuotaEntry>()

export function invalidateTranslateQuotaCache(userId?: string): void {
  if (userId) {
    translateQuotaCache.delete(userId)
  } else {
    translateQuotaCache.clear()
  }
}

async function getFastQuotaState(
  userId: string,
  quotaStore: QuotaStore
): Promise<{
  remainingSeconds: number
  subscriptionStatus: UserQuotaRecord['subscriptionStatus']
}> {
  const now = Date.now()
  const cached = translateQuotaCache.get(userId)
  if (
    cached &&
    now - cached.fetchedAtMs <= QUOTA_CACHE_TTL_MS &&
    cached.remainingSeconds > 30 &&
    cached.subscriptionStatus !== 'canceled'
  ) {
    return {
      remainingSeconds: cached.remainingSeconds,
      subscriptionStatus: cached.subscriptionStatus
    }
  }
  const quota = await quotaStore.getOrCreateUserQuota(userId)
  if (!translateQuotaCache.has(userId) && translateQuotaCache.size >= MAX_QUOTA_CACHE_ENTRIES) {
    const oldestKey = translateQuotaCache.keys().next().value
    if (oldestKey) translateQuotaCache.delete(oldestKey)
  }
  translateQuotaCache.set(userId, {
    remainingSeconds: quota.remainingSeconds,
    subscriptionStatus: quota.subscriptionStatus,
    fetchedAtMs: now
  })
  return {
    remainingSeconds: quota.remainingSeconds,
    subscriptionStatus: quota.subscriptionStatus
  }
}

let cachedClientKey: string | null = null
let cachedGenAiClient: GoogleGenAI | null = null

function getGenAiClient(apiKey: string): GoogleGenAI {
  if (!cachedGenAiClient || cachedClientKey !== apiKey) {
    cachedGenAiClient = new GoogleGenAI({ apiKey })
    cachedClientKey = apiKey
  }
  return cachedGenAiClient
}

export function buildGeminiTranslationPrompt(params: {
  cleanSourceText: string
  sourceLang: string
  targetLang: string
  operatingMode?: 'translate' | 'conversation'
  historyLines: string[]
  glossaryEntries: Array<[string, string]>
}): string {
  const { cleanSourceText, sourceLang, targetLang, operatingMode, historyLines, glossaryEntries } =
    params
  const promptSections: string[] = []
  if (glossaryEntries.length > 0) {
    promptSections.push(
      'MANDATORY CUSTOM GLOSSARY:\n' +
        glossaryEntries
          .map(([src, tgt]) => `- "${src.slice(0, 80)}" => "${String(tgt).slice(0, 80)}"`)
          .join('\n')
    )
  }
  if (historyLines.length > 0) {
    promptSections.push(`RECENT DIALOGUE CONTEXT:\n${historyLines.join('\n')}`)
  }

  const isTwoWayConversation =
    operatingMode === 'conversation' && sourceLang.toLowerCase() !== targetLang.toLowerCase()

  if (isTwoWayConversation) {
    promptSections.push(
      `This is a live two-way bilingual conversation between ${sourceLang.toUpperCase()} and ${targetLang.toUpperCase()}. ` +
        `Detect which language the utterance is spoken in: if it is in ${sourceLang.toUpperCase()}, translate it into ${targetLang.toUpperCase()}; ` +
        `if it is in ${targetLang.toUpperCase()}, translate it into ${sourceLang.toUpperCase()}. ` +
        `Output ONLY the direct translation without quotes or labels:\n"${cleanSourceText}"`
    )
  } else {
    promptSections.push(
      `Translate the following utterance from ${sourceLang.toUpperCase()} to ${targetLang.toUpperCase()}:\n"${cleanSourceText}"`
    )
  }

  return promptSections.join('\n\n')
}

function sendSseEvent(res: ServerResponse, event: string, data: unknown): void {
  if (res.writableEnded) return
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function handleGeminiTranslateStream(params: {
  payload: TranslateProxyPayload
  res: ServerResponse
  user: AuthenticatedUser
  config: GatewayConfig
  quotaStore: QuotaStore
  rateLimiter?: GatewayRateLimiter
}): Promise<void> {
  const { payload, res, user, config, quotaStore, rateLimiter } = params

  // 1. Validate authoritative quota & subscription status
  const quotaState = await getFastQuotaState(user.userId, quotaStore)
  if (quotaState.subscriptionStatus === 'canceled') {
    translateQuotaCache.delete(user.userId)
    res.writeHead(402, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        code: 'SUBSCRIPTION_CANCELED',
        message: 'Your subscription has ended. Upgrade your plan to continue.',
        remainingSeconds: 0
      })
    )
    return
  }

  let remainingSeconds = quotaState.remainingSeconds
  if (remainingSeconds <= 0) {
    translateQuotaCache.delete(user.userId)
    res.writeHead(402, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        code: 'QUOTA_EXHAUSTED',
        message: 'Your interpretation quota has been exhausted. Upgrade your plan to continue.',
        remainingSeconds: 0
      })
    )
    return
  }

  // Anti-abuse metering: if caller invokes /v1/translate directly WITHOUT an active
  // metered /v1/stt WebSocket session, deduct 1 second per request so attackers cannot
  // script unlimited free Gemini translations on a 1-second balance.
  if (rateLimiter && rateLimiter.getActiveSessionCount(user.userId) === 0) {
    try {
      const deducted = await quotaStore.deductSeconds(
        user.userId,
        'translate-direct',
        1,
        'system'
      )
      remainingSeconds = deducted.remainingSeconds
      translateQuotaCache.set(user.userId, {
        remainingSeconds,
        subscriptionStatus: deducted.exhausted ? 'exhausted' : quotaState.subscriptionStatus,
        fetchedAtMs: Date.now()
      })
    } catch {
      // Fall through only if quotaStore failed to deduct; active quota check already ran
    }
  }

  // 2. Validate payload bounds (anti-abuse / anti-prompt-stuffing)
  const cleanSourceText = typeof payload.sourceText === 'string' ? payload.sourceText.trim() : ''
  if (!cleanSourceText) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ code: 'INVALID_INPUT', message: 'sourceText is required.' }))
    return
  }
  if (cleanSourceText.length > MAX_SOURCE_TEXT_LENGTH) {
    res.writeHead(413, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        code: 'PAYLOAD_TOO_LARGE',
        message: `sourceText exceeds maximum allowed length of ${MAX_SOURCE_TEXT_LENGTH} characters.`
      })
    )
    return
  }

  const sourceLang = (payload.sourceLang || 'en').slice(0, 10)
  const targetLang = (payload.targetLang || 'es').slice(0, 10)
  const domainKey = DOMAIN_INSTRUCTIONS[payload.domainId] ? payload.domainId : 'general'
  const systemInstruction = DOMAIN_INSTRUCTIONS[domainKey]

  const historyLines = (Array.isArray(payload.dialogueHistory) ? payload.dialogueHistory : [])
    .slice(-MAX_HISTORY_TURNS)
    .map(
      (turn) =>
        `${String(turn.speakerLabel || 'Speaker').slice(0, 40)}: "${String(turn.sourceText || '').slice(0, 300)}" -> "${String(turn.translatedText || '').slice(0, 300)}"`
    )

  const glossaryEntries =
    payload.customGlossary && typeof payload.customGlossary === 'object'
      ? Object.entries(payload.customGlossary).slice(0, MAX_GLOSSARY_ENTRIES)
      : []

  const prompt = buildGeminiTranslationPrompt({
    cleanSourceText,
    sourceLang,
    targetLang,
    operatingMode: payload.operatingMode,
    historyLines,
    glossaryEntries
  })

  // 3. Begin Server-Sent Events stream
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })

  if (!config.geminiApiKey) {
    if (config.nodeEnv === 'production') {
      sendSseEvent(res, 'error', {
        code: 'PROVIDER_NOT_CONFIGURED',
        message: 'Translation provider is not configured on Gateway.'
      })
      res.end()
      return
    }

    // Non-production dev fallback stream when GEMINI_API_KEY is not yet set in server/.env
    const mockTranslation = `[Gateway Dev ${targetLang.toUpperCase()}] ${cleanSourceText}`
    for (const part of mockTranslation.split(' ')) {
      sendSseEvent(res, 'token', { text: `${part} ` })
    }
    sendSseEvent(res, 'done', {
      provider: 'gateway-dev-mock',
      remainingSeconds
    })
    res.end()
    return
  }

  try {
    const client = getGenAiClient(config.geminiApiKey)
    const candidateModels = Array.from(
      new Set([
        config.geminiModel,
        'gemini-2.5-flash-lite',
        'gemini-3.5-flash-lite',
        'gemini-3.8-flash'
      ])
    )

    let lastError: unknown = null
    let succeeded = false

    for (const modelName of candidateModels) {
      try {
        const stream = await client.models.generateContentStream({
          model: modelName,
          contents: prompt,
          config: {
            systemInstruction,
            temperature: 0.1
          }
        })

        for await (const chunk of stream) {
          if (res.writableEnded) break
          const text = chunk.text
          if (text) {
            sendSseEvent(res, 'token', { text })
          }
        }

        succeeded = true
        break
      } catch (modelErr) {
        lastError = modelErr
        const errText = modelErr instanceof Error ? modelErr.message : String(modelErr)
        const isRetryableModelErr =
          errText.includes('404') || errText.includes('503') || errText.includes('no longer available')
        if (!isRetryableModelErr) {
          throw modelErr
        }
      }
    }

    if (!succeeded) {
      throw lastError || new Error('All configured Gemini models unavailable.')
    }

    sendSseEvent(res, 'done', {
      provider: 'gemini-2.0-flash',
      remainingSeconds
    })
    res.end()
  } catch (err) {
    // Sanitize upstream provider errors (strip any accidental key pattern) while preserving actionable status
    const rawMsg = err instanceof Error ? err.message : String(err)
    const isQuotaOrBilling = rawMsg.includes('402') || rawMsg.toLowerCase().includes('prepayment credits')
    const isRateLimit = rawMsg.includes('429') || rawMsg.toLowerCase().includes('resource_exhausted')

    const safeMessage = isQuotaOrBilling
      ? 'Google Gemini API project has depleted prepayment credits (HTTP 402). Create a Free Tier key at https://aistudio.google.com/apikey or add billing credits.'
      : isRateLimit
        ? 'Google Gemini API rate limit reached (HTTP 429). Please retry in a few seconds.'
        : 'Real-time translation service encountered an upstream error.'

    sendSseEvent(res, 'error', {
      code: isQuotaOrBilling ? 'UPSTREAM_BILLING_REQUIRED' : 'UPSTREAM_TRANSLATION_ERROR',
      message: safeMessage
    })
    res.end()
  }
}
