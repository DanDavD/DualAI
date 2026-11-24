/**
 * DUALAI ZERO-TRUST CLOUD GATEWAY - Server Configuration
 * Loads secrets strictly inside the isolated server runtime.
 * Secrets are NEVER serialized into HTTP responses, WebSocket frames, or client bundles.
 */

import fs from 'node:fs'
import path from 'node:path'

export interface GatewayConfig {
  nodeEnv: 'development' | 'production' | 'test'
  port: number
  host: string
  allowedOrigins: string[]
  deepgramApiKey: string | null
  geminiApiKey: string | null
  geminiModel: string
  supabaseUrl: string | null
  supabaseServiceRoleKey: string | null
  msStoreTenantId: string | null
  msStoreClientId: string | null
  msStoreClientSecret: string | null
  billingWebhookSecret: string | null
  devLocalAuthSecret: string
  quotaMeterIntervalMs: number
}

function loadLocalEnvFile(envFilePath: string): void {
  if (!fs.existsSync(envFilePath)) return
  const raw = fs.readFileSync(envFilePath, 'utf-8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx <= 0) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

function normalizeSecret(val?: string): string | null {
  if (!val) return null
  const trimmed = val.trim()
  if (
    trimmed.length < 10 ||
    trimmed.startsWith('your_') ||
    trimmed === 'changeme'
  ) {
    return null
  }
  return trimmed
}

export function loadGatewayConfig(overrides?: Partial<GatewayConfig>): GatewayConfig {
  const serverEnvPath = path.resolve(process.cwd(), 'server', '.env')
  loadLocalEnvFile(serverEnvPath)

  const rawEnv = process.env.NODE_ENV
  const nodeEnv: GatewayConfig['nodeEnv'] =
    rawEnv === 'production' ? 'production' : rawEnv === 'test' ? 'test' : 'development'

  const port = Number(process.env.GATEWAY_PORT || 8787)
  const host = process.env.GATEWAY_HOST || '127.0.0.1'
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,app://dualai')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const config: GatewayConfig = {
    nodeEnv,
    port: Number.isFinite(port) && port > 0 ? port : 8787,
    host,
    allowedOrigins,
    deepgramApiKey: normalizeSecret(process.env.DEEPGRAM_API_KEY),
    geminiApiKey: normalizeSecret(process.env.GEMINI_API_KEY),
    geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
    supabaseUrl: process.env.SUPABASE_URL?.trim() || null,
    supabaseServiceRoleKey: normalizeSecret(process.env.SUPABASE_SERVICE_ROLE_KEY),
    msStoreTenantId: process.env.MS_STORE_TENANT_ID?.trim() || null,
    msStoreClientId: process.env.MS_STORE_CLIENT_ID?.trim() || null,
    msStoreClientSecret: normalizeSecret(process.env.MS_STORE_CLIENT_SECRET),
    billingWebhookSecret: normalizeSecret(process.env.BILLING_WEBHOOK_SECRET),
    devLocalAuthSecret:
      process.env.DEV_LOCAL_AUTH_SECRET?.trim() || 'dualai_local_dev_hmac_secret_ephemeral',
    quotaMeterIntervalMs: Number(process.env.QUOTA_METER_INTERVAL_MS || 5000),
    ...overrides
  }

  if (config.nodeEnv === 'production') {
    if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
      throw new Error(
        '[SECURITY-FATAL] Production Gateway requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
      )
    }
  }

  return config
}
