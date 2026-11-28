/**
 * DUALAI ZERO-TRUST CLOUD GATEWAY - Rate Limiter & Concurrency Guard
 * Protects upstream Deepgram/Gemini quotas from abuse, floods, and multi-device account sharing.
 */

interface BucketState {
  tokens: number
  lastRefillMs: number
}

export class GatewayRateLimiter {
  private buckets: Map<string, BucketState> = new Map()
  private activeSessions: Map<string, Set<string>> = new Map()
  private readonly maxTokens: number
  private readonly refillPerSecond: number
  private readonly maxTrackedBuckets = 5000

  constructor(options?: { maxTokens?: number; refillPerSecond?: number }) {
    this.maxTokens = options?.maxTokens ?? 40
    this.refillPerSecond = options?.refillPerSecond ?? 5
  }

  private pruneStaleBuckets(now: number): void {
    if (this.buckets.size < this.maxTrackedBuckets) return
    const staleThresholdMs = Math.ceil((this.maxTokens / this.refillPerSecond) * 1000) + 60_000
    for (const [k, state] of this.buckets.entries()) {
      if (now - state.lastRefillMs > staleThresholdMs) {
        this.buckets.delete(k)
      }
    }
    // Hard eviction cap if still over threshold under distributed IP flood
    while (this.buckets.size >= this.maxTrackedBuckets) {
      const oldestKey = this.buckets.keys().next().value
      if (!oldestKey) break
      this.buckets.delete(oldestKey)
    }
  }

  public consume(key: string, cost: number = 1): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now()
    let bucket = this.buckets.get(key)

    if (!bucket) {
      this.pruneStaleBuckets(now)
      bucket = { tokens: this.maxTokens, lastRefillMs: now }
      this.buckets.set(key, bucket)
    } else {
      const elapsedSec = (now - bucket.lastRefillMs) / 1000
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsedSec * this.refillPerSecond)
      bucket.lastRefillMs = now
    }

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost
      return { allowed: true, retryAfterSec: 0 }
    }

    const deficit = cost - bucket.tokens
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil(deficit / this.refillPerSecond))
    }
  }

  public acquireSession(userId: string, sessionId: string, maxConcurrent: number): boolean {
    let sessions = this.activeSessions.get(userId)
    if (!sessions) {
      sessions = new Set()
      this.activeSessions.set(userId, sessions)
    }

    if (sessions.size >= maxConcurrent && !sessions.has(sessionId)) {
      return false
    }

    sessions.add(sessionId)
    return true
  }

  public releaseSession(userId: string, sessionId: string): void {
    const sessions = this.activeSessions.get(userId)
    if (!sessions) return
    sessions.delete(sessionId)
    if (sessions.size === 0) {
      this.activeSessions.delete(userId)
    }
  }

  public getActiveSessionCount(userId: string): number {
    return this.activeSessions.get(userId)?.size ?? 0
  }
}
