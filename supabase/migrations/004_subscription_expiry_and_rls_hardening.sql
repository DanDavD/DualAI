-- ============================================================================
-- DUALAI: SUBSCRIPTION EXPIRY, ZERO-ROLLOVER ON CANCELED & RLS HARDENING
-- Migration: 004_subscription_expiry_and_rls_hardening.sql
-- Safe to run idempotently on top of 001, 002, and 003 in Supabase SQL Editor.
-- ============================================================================

-- 1. Enforce case-insensitive email match in customers RLS policy
DROP POLICY IF EXISTS "Users can view their own customer record" ON public.customers;
CREATE POLICY "Users can view their own customer record"
  ON public.customers FOR SELECT
  TO authenticated
  USING (
    auth.uid()::text = user_id
    OR LOWER(COALESCE(auth.jwt() ->> 'email', '')) = LOWER(email)
  );

-- 2. Harden credit_billing_purchase so expired/canceled accounts never carry
--    over stale hours from a previously canceled cycle into a new subscription.
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
    remaining_seconds = CASE
      WHEN public.user_quotas.subscription_status = 'canceled' THEN p_seconds
      ELSE public.user_quotas.remaining_seconds + p_seconds
    END,
    total_allocated_seconds = public.user_quotas.total_allocated_seconds + p_seconds,
    subscription_status = 'active',
    updated_at = NOW()
  RETURNING public.user_quotas.remaining_seconds, public.user_quotas.total_allocated_seconds
  INTO v_remaining, v_allocated;

  RETURN QUERY SELECT TRUE, v_remaining, v_allocated;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_billing_purchase(TEXT, TEXT, UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_billing_purchase(TEXT, TEXT, UUID, TEXT, INTEGER) TO service_role;

-- 3. Clean up any existing canceled rows that still hold stale remaining_seconds
UPDATE public.user_quotas
SET remaining_seconds = 0, updated_at = NOW()
WHERE subscription_status = 'canceled' AND remaining_seconds > 0;
