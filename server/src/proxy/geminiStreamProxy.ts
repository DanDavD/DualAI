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
import { QuotaStore } from '../quota/quotaStore.js'

export interface TranslateProxyPayload {
  sourceText: string
  sourceLang: string
  targetLang: string
  domainId: string
  speakerLabel?: string
  dialogueHistory?: Array<{
    speakerLabel: string
    sourceText: string
    translatedText: string
  }>
  customGlossary?: Record<string, string>
}

const DOMAIN_INSTRUCTIONS: Record<string, string> = {
  medical:
    'You are an expert clinical medical interpreter. Strictly follow ICD-10 anatomical nomenclature and pharmacological precision. Preserve all dosages, units, and numeric vitals verbatim. Output ONLY the direct translation without explanations.',
  legal:
    'You are a certified courtroom legal interpreter. Translate legal terms of art verbatim without colloquialisms, paraphrases, or softening. Preserve all statute numbers, dates, and monetary sums verbatim. Output ONLY the direct translation.',
  technical:
    'You are a systems engineering interpreter. Preserve technical acronyms, protocols, code identifiers, and numerical metrics accurately. Output ONLY the direct translation.',
  business:
    'You are an executive business interpreter. Use formal corporate register and preserve financial figures, percentages, and KPIs verbatim. Output ONLY the direct translation.',
  general:
    'You are a real-time professional simultaneous interpreter. Provide an accurate, natural, low-latency translation preserving all numbers and proper nouns. Output ONLY the direct translation.'
}

const MAX_SOURCE_TEXT_LENGTH = 4000
const MAX_GLOSSARY_ENTRIES = 50
const MAX_HISTORY_TURNS = 20

let cachedClientKey: string | null = null
let cachedGenAiClient: GoogleGenAI | null = null

function getGenAiClient(apiKey: string): GoogleGenAI {
  if (!cachedGenAiClient || cachedClientKey !== apiKey) {
    cachedGenAiClient = new GoogleGenAI({ apiKey })
    cachedClientKey = apiKey
  }
  return cachedGenAiClient
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
}): Promise<void> {
  const { payload, res, user, config, quotaStore } = params

  // 1. Validate authoritative quota
  const quota = await quotaStore.getOrCreateUserQuota(user.userId)
  if (quota.remainingSeconds <= 0) {
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
  promptSections.push(
    `Translate the following utterance from ${sourceLang.toUpperCase()} to ${targetLang.toUpperCase()}:\n"${cleanSourceText}"`
  )
  const prompt = promptSections.join('\n\n')

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
      remainingSeconds: quota.remainingSeconds
    })
    res.end()
    return
  }

  try {
    const client = getGenAiClient(config.geminiApiKey)
    const candidateModels = Array.from(
      new Set([config.geminiModel, 'gemini-3.5-flash-lite', 'gemini-3.8-flash'])
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
      remainingSeconds: quota.remainingSeconds
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
