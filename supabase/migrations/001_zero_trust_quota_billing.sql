-- ============================================================================
-- DUALAI: ZERO-TRUST SAAS QUOTA, BILLING & RLS SECURITY SCHEMA
-- Migration: 001_zero_trust_quota_billing.sql
-- Security Model:
--   1. ZERO provider API keys (Deepgram/Gemini/Azure/PayPal) are EVER stored in DB.
--   2. FORCE ROW LEVEL SECURITY on all tables.
--   3. Authenticated clients have READ-ONLY (SELECT) access strictly to their own rows.
--   4. ZERO INSERT/UPDATE/DELETE grants for anon or authenticated roles on quota/billing.
--   5. All quota deductions and payment credits execute exclusively via SECURITY DEFINER
--      RPCs restricted to `service_role` (called solely by the DualAI Cloud Gateway).
--   6. Strict Zero-Data Retention (ZDR): zero raw audio or transcript text persisted.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. SUBSCRIPTION & HOUR-PACK PLANS CATALOG
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  included_seconds INTEGER NOT NULL CHECK (included_seconds > 0),
  monthly_price_usd NUMERIC(10, 2) NOT NULL CHECK (monthly_price_usd >= 0),
  ms_store_product_id TEXT UNIQUE,
  paypal_plan_id TEXT UNIQUE,
  paddle_price_id TEXT UNIQUE,
  max_concurrent_sessions INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrent_sessions >= 1),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.plans (
  id, name, description, included_seconds, monthly_price_usd,
  ms_store_product_id, max_concurrent_sessions
)
VALUES
  (
    'free_tier',
    'Free Trial (1 Hour)',
    'Automatic 1-hour real-time interpretation trial. All features included.',
    3600,
    0.00,
    NULL,
    1
  ),
  (
    'pro_40h',
    'Pro (40 Hours)',
    '40 hours/month of unified multi-speaker live translation across 60+ languages.',
    144000,
    8.99,
    '9NBLGGH4DUAL40H',
    1
  ),
  (
    'pro_plus_70h',
    'Pro+ (70 Hours)',
    '70 hours/month for active medical, legal, and business interpreters.',
    252000,
    14.99,
    '9NBLGGH4DUAL70H',
    1
  ),
  (
    'unlimited',
    'Unlimited',
    'Unlimited monthly interpretation for full-time interpreters (single-user fair use).',
    576000,
    24.99,
    '9NBLGGH4DUALUNL',
    1
  )
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. AUTHORITATIVE USER QUOTAS (SERVER-CONTROLLED ONLY)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_quotas (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES public.plans(id) DEFAULT 'free_tier',
  remaining_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (remaining_seconds >= 0),
  total_allocated_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (total_allocated_seconds >= 0),
  total_consumed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (total_consumed_seconds >= 0),
  subscription_status TEXT NOT NULL DEFAULT 'free_trial'
    CHECK (subscription_status IN ('free_trial', 'active', 'past_due', 'exhausted', 'canceled')),
  free_tier_granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. APPEND-ONLY METERED USAGE LEDGER (ZERO-DATA RETENTION: NO AUDIO / NO TEXT)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usage_ledger (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  seconds_billed INTEGER NOT NULL CHECK (seconds_billed > 0),
  channel_mode TEXT NOT NULL CHECK (channel_mode IN ('system', 'mic', 'bilateral', 'app')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_user_created
  ON public.usage_ledger (user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. IDEMPOTENT BILLING EVENTS (MICROSOFT STORE / PAYPAL / PADDLE)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('microsoft_store', 'paypal', 'paddle')),
  external_transaction_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES public.plans(id),
  seconds_credited INTEGER NOT NULL CHECK (seconds_credited > 0),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_billing_provider_tx UNIQUE (provider, external_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_events_user
  ON public.billing_events (user_id, verified_at DESC);

-- ----------------------------------------------------------------------------
-- 5. STRICT ROW LEVEL SECURITY (RLS) ENFORCEMENT
-- ----------------------------------------------------------------------------
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_quotas FORCE ROW LEVEL SECURITY;

ALTER TABLE public.usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_ledger FORCE ROW LEVEL SECURITY;

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events FORCE ROW LEVEL SECURITY;

-- Revoke all mutating privileges from client-facing roles
REVOKE ALL ON public.plans FROM anon, authenticated;
REVOKE ALL ON public.user_quotas FROM anon, authenticated;
REVOKE ALL ON public.usage_ledger FROM anon, authenticated;
REVOKE ALL ON public.billing_events FROM anon, authenticated;

-- Grant strictly read-only SELECT access (governed by RLS predicates below)
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT SELECT ON public.user_quotas TO authenticated;
GRANT SELECT ON public.usage_ledger TO authenticated;
GRANT SELECT ON public.billing_events TO authenticated;

-- RLS Policies: Clients may ONLY read active plans and their own quota/ledger rows
DROP POLICY IF EXISTS "plans_read_active" ON public.plans;
CREATE POLICY "plans_read_active"
  ON public.plans FOR SELECT
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "user_quotas_select_own" ON public.user_quotas;
CREATE POLICY "user_quotas_select_own"
  ON public.user_quotas FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "usage_ledger_select_own" ON public.usage_ledger;
CREATE POLICY "usage_ledger_select_own"
  ON public.usage_ledger FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "billing_events_select_own" ON public.billing_events;
CREATE POLICY "billing_events_select_own"
  ON public.billing_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 6. AUTOMATIC 1-HOUR FREE TIER PROVISIONING TRIGGER ON SIGNUP
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user_free_tier()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_quotas (
    user_id,
    plan_id,
    remaining_seconds,
    total_allocated_seconds,
    total_consumed_seconds,
    subscription_status
  )
  VALUES (
    NEW.id,
    'free_tier',
    3600,
    3600,
    0,
    'free_trial'
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_grant_free_tier ON auth.users;
CREATE TRIGGER on_auth_user_created_grant_free_tier
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_free_tier();

-- ----------------------------------------------------------------------------
-- 7. SERVER-ONLY ATOMIC RPCs (REVOKED FROM PUBLIC/ANON/AUTHENTICATED)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deduct_usage_seconds(
  p_user_id UUID,
  p_session_id TEXT,
  p_seconds INTEGER,
  p_channel_mode TEXT DEFAULT 'system'
)
RETURNS TABLE (
  remaining_seconds INTEGER,
  total_allocated_seconds INTEGER,
  total_consumed_seconds INTEGER,
  exhausted BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining INTEGER;
  v_allocated INTEGER;
  v_consumed INTEGER;
BEGIN
  IF p_seconds <= 0 THEN
    RAISE EXCEPTION 'p_seconds must be positive';
  END IF;

  UPDATE public.user_quotas uq
  SET
    remaining_seconds = GREATEST(0, uq.remaining_seconds - p_seconds),
    total_consumed_seconds = uq.total_consumed_seconds + LEAST(uq.remaining_seconds, p_seconds),
    subscription_status = CASE
      WHEN GREATEST(0, uq.remaining_seconds - p_seconds) = 0 THEN 'exhausted'
      ELSE uq.subscription_status
    END,
    updated_at = NOW()
  WHERE uq.user_id = p_user_id
  RETURNING uq.remaining_seconds, uq.total_allocated_seconds, uq.total_consumed_seconds
  INTO v_remaining, v_allocated, v_consumed;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quota profile not found for user %', p_user_id;
  END IF;

  INSERT INTO public.usage_ledger (user_id, session_id, seconds_billed, channel_mode)
  VALUES (p_user_id, p_session_id, p_seconds, p_channel_mode);

  RETURN QUERY SELECT v_remaining, v_allocated, v_consumed, (v_remaining <= 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_billing_purchase(
  p_provider TEXT,
  p_external_tx_id TEXT,
  p_user_id UUID,
  p_plan_id TEXT,
  p_seconds INTEGER
)
RETURNS TABLE (
  credited BOOLEAN,
  remaining_seconds INTEGER,
  total_allocated_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_id BIGINT;
  v_remaining INTEGER;
  v_allocated INTEGER;
BEGIN
  IF p_seconds <= 0 THEN
    RAISE EXCEPTION 'p_seconds must be positive';
  END IF;

  -- Idempotency guard: replay of the same transaction ID is safely ignored
  INSERT INTO public.billing_events (
    provider, external_transaction_id, user_id, plan_id, seconds_credited
  )
  VALUES (
    p_provider, p_external_tx_id, p_user_id, p_plan_id, p_seconds
  )
  ON CONFLICT (provider, external_transaction_id) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    SELECT uq.remaining_seconds, uq.total_allocated_seconds
    INTO v_remaining, v_allocated
    FROM public.user_quotas uq
    WHERE uq.user_id = p_user_id;

    RETURN QUERY SELECT FALSE, COALESCE(v_remaining, 0), COALESCE(v_allocated, 0);
    RETURN;
  END IF;

  UPDATE public.user_quotas uq
  SET
    plan_id = p_plan_id,
    remaining_seconds = uq.remaining_seconds + p_seconds,
    total_allocated_seconds = uq.total_allocated_seconds + p_seconds,
    subscription_status = 'active',
    updated_at = NOW()
  WHERE uq.user_id = p_user_id
  RETURNING uq.remaining_seconds, uq.total_allocated_seconds
  INTO v_remaining, v_allocated;

  RETURN QUERY SELECT TRUE, v_remaining, v_allocated;
END;
$$;

-- Restrict RPC execution strictly to server-side service_role
REVOKE ALL ON FUNCTION public.deduct_usage_seconds(UUID, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_usage_seconds(UUID, TEXT, INTEGER, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.credit_billing_purchase(TEXT, TEXT, UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_billing_purchase(TEXT, TEXT, UUID, TEXT, INTEGER) TO service_role;
