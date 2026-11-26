-- ============================================================================
-- DUALAI: ATOMIC BILLING, SUBSCRIPTION MIRROR & REFUND CLAWBACK HARDENING
-- Migration: 003_atomic_billing_hardening.sql
--
-- Guarantees:
--   1. Plans catalog paddle_price_id columns match live Paddle Price IDs.
--   2. FORCE ROW LEVEL SECURITY + REVOKE mutations on customers & subscriptions.
--   3. billing_events supports idempotent credit & refund/chargeback clawback
--      audit entries under the same UNIQUE (provider, external_transaction_id).
--   4. Atomic credit_billing_purchase RPC provisions missing quota rows and
--      prevents double crediting in a single PostgreSQL transaction.
--   5. Atomic revoke_billing_adjustment RPC claws back refunded/charged-back
--      seconds idempotently (clamped >= 0).
--   6. Atomic upsert_paddle_customer & upsert_paddle_subscription RPCs enforce
--      monotonic last_event_at ordering and FK safety for out-of-order webhooks.
-- ============================================================================

-- 1. Link authoritative live Paddle Price IDs into plans catalog
UPDATE public.plans SET paddle_price_id = 'pri_01m8aw2f6rzakqqenynbztq74f' WHERE id = 'pro_40h';
UPDATE public.plans SET paddle_price_id = 'pri_01m8avr4a5504btrxkscxhh75g' WHERE id = 'pro_plus_70h';
UPDATE public.plans SET paddle_price_id = 'pri_01m8aw5w9mdx3bjm1q7pt3n3cz' WHERE id = 'unlimited';

-- 2. Enforce FORCE RLS + least-privilege grants on Paddle mirror tables
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.customers FROM anon, authenticated;
REVOKE ALL ON public.subscriptions FROM anon, authenticated;
GRANT SELECT ON public.customers TO authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;

-- 3. Add event_kind audit column to billing_events for refund/chargeback clawbacks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'billing_events' AND column_name = 'event_kind'
  ) THEN
    ALTER TABLE public.billing_events
      ADD COLUMN event_kind TEXT NOT NULL DEFAULT 'credit'
      CHECK (event_kind IN ('credit', 'refund_clawback', 'chargeback_clawback'));
  END IF;
END $$;

-- 4. Atomic credit_billing_purchase RPC (single-transaction idempotency + upsert)
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

  -- Prevent crediting subscription IDs directly on Paddle (only txn_... credits hours)
  IF p_provider = 'paddle' AND p_external_tx_id LIKE 'sub_%' THEN
    RAISE EXCEPTION 'Paddle hours must be credited exclusively from transaction.completed (txn_*)';
  END IF;

  -- Atomic idempotency guard on (provider, external_transaction_id)
  INSERT INTO public.billing_events (
    provider, external_transaction_id, user_id, plan_id, seconds_credited, event_kind
  )
  VALUES (
    p_provider, p_external_tx_id, p_user_id, p_plan_id, p_seconds, 'credit'
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

  -- Atomically create or increment user_quotas in the same transaction
  INSERT INTO public.user_quotas (
    user_id,
    plan_id,
    remaining_seconds,
    total_allocated_seconds,
    total_consumed_seconds,
    subscription_status,
    updated_at
  )
  VALUES (
    p_user_id,
    p_plan_id,
    3600 + p_seconds,
    3600 + p_seconds,
    0,
    'active',
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    plan_id = EXCLUDED.plan_id,
    remaining_seconds = public.user_quotas.remaining_seconds + p_seconds,
    total_allocated_seconds = public.user_quotas.total_allocated_seconds + p_seconds,
    subscription_status = 'active',
    updated_at = NOW()
  RETURNING public.user_quotas.remaining_seconds, public.user_quotas.total_allocated_seconds
  INTO v_remaining, v_allocated;

  RETURN QUERY SELECT TRUE, v_remaining, v_allocated;
END;
$$;

-- 5. Atomic refund / chargeback clawback RPC (idempotent on adjustment ID)
CREATE OR REPLACE FUNCTION public.revoke_billing_adjustment(
  p_provider TEXT,
  p_adjustment_id TEXT,
  p_user_id UUID,
  p_plan_id TEXT,
  p_seconds INTEGER,
  p_event_kind TEXT DEFAULT 'refund_clawback'
)
RETURNS TABLE (
  revoked BOOLEAN,
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
  v_key TEXT;
BEGIN
  IF p_seconds <= 0 THEN
    RAISE EXCEPTION 'p_seconds must be positive';
  END IF;

  IF p_event_kind NOT IN ('refund_clawback', 'chargeback_clawback') THEN
    RAISE EXCEPTION 'Invalid clawback event_kind: %', p_event_kind;
  END IF;

  v_key := 'adj:' || p_adjustment_id;

  INSERT INTO public.billing_events (
    provider, external_transaction_id, user_id, plan_id, seconds_credited, event_kind
  )
  VALUES (
    p_provider, v_key, p_user_id, p_plan_id, p_seconds, p_event_kind
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
    remaining_seconds = GREATEST(0, uq.remaining_seconds - p_seconds),
    total_allocated_seconds = GREATEST(0, uq.total_allocated_seconds - p_seconds),
    subscription_status = CASE
      WHEN p_event_kind = 'chargeback_clawback' THEN 'canceled'
      WHEN GREATEST(0, uq.remaining_seconds - p_seconds) = 0 THEN 'exhausted'
      ELSE uq.subscription_status
    END,
    updated_at = NOW()
  WHERE uq.user_id = p_user_id
  RETURNING uq.remaining_seconds, uq.total_allocated_seconds
  INTO v_remaining, v_allocated;

  RETURN QUERY SELECT TRUE, COALESCE(v_remaining, 0), COALESCE(v_allocated, 0);
END;
$$;

-- 6. Atomic monotonic upserts for Paddle customers & subscriptions
CREATE OR REPLACE FUNCTION public.upsert_paddle_customer(
  p_customer_id TEXT,
  p_email TEXT,
  p_user_id TEXT DEFAULT NULL,
  p_last_event_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.customers AS c (
    customer_id, email, user_id, last_event_at, updated_at
  )
  VALUES (
    p_customer_id,
    COALESCE(NULLIF(p_email, ''), 'pending@paddle.local'),
    NULLIF(p_user_id, ''),
    p_last_event_at,
    NOW()
  )
  ON CONFLICT (customer_id) DO UPDATE SET
    email = CASE
      WHEN NULLIF(EXCLUDED.email, '') IS NOT NULL AND EXCLUDED.email <> 'pending@paddle.local'
        THEN EXCLUDED.email
      ELSE c.email
    END,
    user_id = COALESCE(NULLIF(EXCLUDED.user_id, ''), c.user_id),
    last_event_at = GREATEST(COALESCE(c.last_event_at, '-infinity'::timestamptz), COALESCE(EXCLUDED.last_event_at, NOW())),
    updated_at = NOW()
  WHERE c.last_event_at IS NULL
     OR EXCLUDED.last_event_at IS NULL
     OR c.last_event_at <= EXCLUDED.last_event_at
     OR (c.user_id IS NULL AND NULLIF(EXCLUDED.user_id, '') IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_paddle_subscription(
  p_subscription_id TEXT,
  p_customer_id TEXT,
  p_user_id TEXT,
  p_status TEXT,
  p_price_id TEXT,
  p_product_id TEXT,
  p_scheduled_change_action TEXT,
  p_scheduled_change_at TIMESTAMPTZ,
  p_paddle_created_at TIMESTAMPTZ,
  p_last_event_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guarantee parent customer row exists atomically (prevents FK failure on out-of-order webhooks)
  PERFORM public.upsert_paddle_customer(p_customer_id, '', p_user_id, p_last_event_at);

  INSERT INTO public.subscriptions AS s (
    subscription_id,
    customer_id,
    user_id,
    status,
    price_id,
    product_id,
    scheduled_change_action,
    scheduled_change_at,
    paddle_created_at,
    last_event_at,
    updated_at
  )
  VALUES (
    p_subscription_id,
    p_customer_id,
    NULLIF(p_user_id, ''),
    p_status,
    p_price_id,
    p_product_id,
    p_scheduled_change_action,
    p_scheduled_change_at,
    p_paddle_created_at,
    p_last_event_at,
    NOW()
  )
  ON CONFLICT (subscription_id) DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    user_id = COALESCE(NULLIF(EXCLUDED.user_id, ''), s.user_id),
    status = EXCLUDED.status,
    price_id = CASE WHEN EXCLUDED.price_id <> '' THEN EXCLUDED.price_id ELSE s.price_id END,
    product_id = CASE WHEN EXCLUDED.product_id <> '' THEN EXCLUDED.product_id ELSE s.product_id END,
    scheduled_change_action = EXCLUDED.scheduled_change_action,
    scheduled_change_at = EXCLUDED.scheduled_change_at,
    paddle_created_at = COALESCE(EXCLUDED.paddle_created_at, s.paddle_created_at),
    last_event_at = EXCLUDED.last_event_at,
    updated_at = NOW()
  WHERE s.last_event_at IS NULL
     OR EXCLUDED.last_event_at IS NULL
     OR s.last_event_at <= EXCLUDED.last_event_at;
END;
$$;

-- Restrict all billing RPCs strictly to service_role
REVOKE ALL ON FUNCTION public.credit_billing_purchase(TEXT, TEXT, UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_billing_purchase(TEXT, TEXT, UUID, TEXT, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.revoke_billing_adjustment(TEXT, TEXT, UUID, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_billing_adjustment(TEXT, TEXT, UUID, TEXT, INTEGER, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.upsert_paddle_customer(TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_paddle_customer(TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.upsert_paddle_subscription(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_paddle_subscription(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
