-- ============================================================================
-- DUALAI: PADDLE CUSTOMERS & SUBSCRIPTIONS STATE MIRROR
-- Migration: 002_paddle_fulfillment_subscriptions.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.customers (
  customer_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  user_id TEXT,
  last_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  subscription_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES public.customers(customer_id) ON DELETE CASCADE,
  user_id TEXT,
  status TEXT NOT NULL,
  price_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  scheduled_change_action TEXT,
  scheduled_change_at TIMESTAMPTZ,
  paddle_created_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optimization & foreign key lookup indexes
CREATE INDEX IF NOT EXISTS idx_customers_email ON public.customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_user_id ON public.customers(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer_id ON public.subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);

-- Force Row Level Security (RLS)
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view only their own records
CREATE POLICY "Users can view their own customer record"
  ON public.customers FOR SELECT
  TO authenticated
  USING (auth.uid()::text = user_id OR auth.jwt() ->> 'email' = email);

CREATE POLICY "Users can view their own subscriptions"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid()::text = user_id);

-- Restrict mutations exclusively to service_role (Cloud Gateway)
CREATE POLICY "Service role manages customers"
  ON public.customers FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role manages subscriptions"
  ON public.subscriptions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
