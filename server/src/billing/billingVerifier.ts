/**
 * DUALAI ZERO-TRUST CLOUD GATEWAY - Billing & Entitlement Verifier
 * Supports Honduras & Global Payout Architectures:
 * 1. Microsoft Store Collections & Subscriptions API (Entra ID server-to-server verification)
 *    for Windows MSIX Store users (zero Stripe required; native Microsoft card checkout).
 * 2. Cross-Platform HMAC-SHA256 Webhook Verification (PayPal / Paddle Merchant of Record)
 *    for macOS and Web users.
 */

import crypto from 'node:crypto'
import { GatewayConfig } from '../config.js'
import {
  PLAN_CATALOG,
  PlanId,
  QuotaStore,
  findPlanByMsStoreProductId
} from '../quota/quotaStore.js'

export interface MicrosoftStoreVerifyRequest {
  userId: string
  storeIdKey: string
  productId: string
  transactionId?: string
}

export interface BillingVerificationResult {
  verified: boolean
  credited: boolean
  planId?: PlanId
  remainingSeconds?: number
  totalAllocatedSeconds?: number
  error?: string
}

interface MsCollectionsItem {
  productId?: string
  skuId?: string
  status?: string
  transactionId?: string
  id?: string
}

export type CheckoutProvider = 'paypal' | 'paddle' | 'microsoft_store'

export interface CheckoutSessionRequest {
  userId: string
  planId: string
  provider: CheckoutProvider
}

export interface CheckoutSessionResponse {
  ok: boolean
  provider?: CheckoutProvider
  planId?: PlanId
  planName?: string
  monthlyPriceUsd?: number
  includedHours?: number
  checkoutSessionId?: string
  checkoutUrl?: string
  msStoreProductId?: string | null
  storeUri?: string
  verificationEndpoint?: string
  error?: string
}

export class BillingVerifier {
  private config: GatewayConfig
  private quotaStore: QuotaStore
  private fetchImpl: typeof fetch

  constructor(config: GatewayConfig, quotaStore: QuotaStore, fetchImpl?: typeof fetch) {
    this.config = config
    this.quotaStore = quotaStore
    this.fetchImpl = fetchImpl || fetch
  }

  /**
   * Creates an authoritative checkout session payload using server-catalog prices & hours.
   * Client-supplied amounts are never trusted.
   */
  public createCheckoutSession(req: CheckoutSessionRequest): CheckoutSessionResponse {
    const plan = PLAN_CATALOG[req.planId as PlanId]
    if (!plan || plan.id === 'free_tier') {
      return { ok: false, error: 'Select a valid paid plan (pro_40h, pro_plus_70h, or unlimited).' }
    }

    const checkoutSessionId = `chk_${crypto.randomUUID()}`
    const includedHours = Math.round(plan.includedSeconds / 3600)

    if (req.provider === 'microsoft_store') {
      if (!plan.msStoreProductId) {
        return { ok: false, error: 'Selected plan does not have a Microsoft Store Product ID.' }
      }
      return {
        ok: true,
        provider: 'microsoft_store',
        planId: plan.id,
        planName: plan.name,
        monthlyPriceUsd: plan.monthlyPriceUsd,
        includedHours,
        checkoutSessionId,
        msStoreProductId: plan.msStoreProductId,
        storeUri: `ms-windows-store://pdp/?ProductId=${encodeURIComponent(plan.msStoreProductId)}`,
        verificationEndpoint: '/v1/billing/microsoft-store/verify'
      }
    }

    const baseUrl =
      req.provider === 'paddle'
        ? this.config.paddleCheckoutBaseUrl
        : this.config.paypalCheckoutBaseUrl

    let checkoutUrl: string
    try {
      const parsed = new URL(baseUrl)
      parsed.searchParams.set('plan', plan.id)
      parsed.searchParams.set('session', checkoutSessionId)
      parsed.searchParams.set('uid', req.userId)
      parsed.searchParams.set('amount_usd', plan.monthlyPriceUsd.toFixed(2))
      parsed.searchParams.set('hours', String(includedHours))
      checkoutUrl = parsed.toString()
    } catch {
      return { ok: false, error: 'Checkout provider URL is misconfigured on Gateway.' }
    }

    return {
      ok: true,
      provider: req.provider,
      planId: plan.id,
      planName: plan.name,
      monthlyPriceUsd: plan.monthlyPriceUsd,
      includedHours,
      checkoutSessionId,
      checkoutUrl
    }
  }

  /**
   * Verifies a Microsoft Store purchase/subscription server-to-server against
   * Microsoft Store Collections API v9.0 using server-only Entra ID credentials.
   */
  public async verifyMicrosoftStoreEntitlement(
    req: MicrosoftStoreVerifyRequest
  ): Promise<BillingVerificationResult> {
    const plan = findPlanByMsStoreProductId(req.productId)
    if (!plan) {
      return { verified: false, credited: false, error: 'Unknown Microsoft Store productId.' }
    }

    if (!req.storeIdKey || req.storeIdKey.trim().length < 16) {
      return { verified: false, credited: false, error: 'Invalid Microsoft Store ID key.' }
    }

    if (
      !this.config.msStoreTenantId ||
      !this.config.msStoreClientId ||
      !this.config.msStoreClientSecret
    ) {
      return {
        verified: false,
        credited: false,
        error:
          'Microsoft Store server credentials (MS_STORE_TENANT_ID / CLIENT_ID / CLIENT_SECRET) are not configured on Gateway.'
      }
    }

    try {
      // 1. Obtain Microsoft Entra ID access token for Store Collections audience
      const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(this.config.msStoreTenantId)}/oauth2/token`
      const tokenBody = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.msStoreClientId,
        client_secret: this.config.msStoreClientSecret,
        resource: 'https://onestore.microsoft.com'
      })

      const tokenRes = await this.fetchImpl(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString()
      })

      if (!tokenRes.ok) {
        return {
          verified: false,
          credited: false,
          error: `Microsoft Entra ID authentication failed (${tokenRes.status}).`
        }
      }

      const tokenJson = (await tokenRes.json()) as { access_token?: string }
      if (!tokenJson.access_token) {
        return { verified: false, credited: false, error: 'Entra ID returned no access token.' }
      }

      // 2. Query Microsoft Store Collections v9.0 API with user's storeIdKey
      const collectionsRes = await this.fetchImpl(
        'https://collections.mp.microsoft.com/v9.0/collections/query',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokenJson.access_token}`
          },
          body: JSON.stringify({
            maxPageSize: 25,
            productSkuIds: [{ productId: req.productId }],
            beneficiaries: [
              {
                identitytype: 'b2b',
                identityvalue: req.storeIdKey,
                localticketreference: 'dualai-gateway'
              }
            ]
          })
        }
      )

      if (!collectionsRes.ok) {
        return {
          verified: false,
          credited: false,
          error: `Microsoft Store Collections verification failed (${collectionsRes.status}).`
        }
      }

      const collectionsJson = (await collectionsRes.json()) as { items?: MsCollectionsItem[] }
      const matched = (collectionsJson.items || []).find(
        (item) =>
          item.productId === req.productId &&
          (item.status === 'Active' || item.status === 'Purchased')
      )

      if (!matched) {
        return {
          verified: false,
          credited: false,
          error: 'No active Microsoft Store entitlement found for this product.'
        }
      }

      const externalTxId =
        matched.transactionId || matched.id || req.transactionId || `ms-${req.productId}-${Date.now()}`

      const creditResult = await this.quotaStore.creditPurchase({
        provider: 'microsoft_store',
        externalTransactionId: externalTxId,
        userId: req.userId,
        planId: plan.id,
        seconds: plan.includedSeconds
      })

      return {
        verified: true,
        credited: creditResult.credited,
        planId: plan.id,
        remainingSeconds: creditResult.remainingSeconds,
        totalAllocatedSeconds: creditResult.totalAllocatedSeconds
      }
    } catch {
      return {
        verified: false,
        credited: false,
        error: 'Upstream Microsoft Store verification network failure.'
      }
    }
  }

  /**
   * Constant-time HMAC-SHA256 webhook verification for PayPal / Paddle cross-platform checkout.
   */
  public verifyWebhookSignature(rawBody: Buffer, providedSignatureHeader?: string): boolean {
    if (!this.config.billingWebhookSecret || !providedSignatureHeader) {
      return false
    }

    const cleanedSig = providedSignatureHeader.replace(/^sha256=/i, '').trim()
    const expectedSig = crypto
      .createHmac('sha256', this.config.billingWebhookSecret)
      .update(rawBody)
      .digest('hex')

    const providedBuf = Buffer.from(cleanedSig, 'utf-8')
    const expectedBuf = Buffer.from(expectedSig, 'utf-8')
    if (providedBuf.length !== expectedBuf.length) {
      return false
    }

    return crypto.timingSafeEqual(providedBuf, expectedBuf)
  }

  public async processVerifiedWebhook(payload: {
    provider: 'paypal' | 'paddle'
    transactionId: string
    userId: string
    planId: string
  }): Promise<BillingVerificationResult> {
    const plan = PLAN_CATALOG[payload.planId as PlanId]
    if (!plan || plan.id === 'free_tier') {
      return { verified: false, credited: false, error: 'Invalid paid planId in webhook payload.' }
    }
    if (!payload.transactionId || !payload.userId) {
      return { verified: false, credited: false, error: 'Missing transactionId or userId.' }
    }

    const result = await this.quotaStore.creditPurchase({
      provider: payload.provider,
      externalTransactionId: payload.transactionId,
      userId: payload.userId,
      planId: plan.id,
      seconds: plan.includedSeconds
    })

    return {
      verified: true,
      credited: result.credited,
      planId: plan.id,
      remainingSeconds: result.remainingSeconds,
      totalAllocatedSeconds: result.totalAllocatedSeconds
    }
  }
}
