# DualAI Zero-Trust Cloud Gateway: Production Deployment Runbook (CARD-18)

This runbook documents the production deployment of the **DualAI Zero-Trust Cloud Gateway** (`https://` and `wss://`), **Supabase Auth + Force RLS**, and **Honduras-Compatible Checkout** (Microsoft Store MSIX Collections v9.0 + PayPal/Paddle).

---

## 1. Required Cloud Vault Secrets (Never Committed to Git)

Configure these environment variables inside Railway Variables or Fly.io Secrets (`fly secrets set`):

| Variable | Required | Purpose |
| :--- | :--- | :--- |
| `NODE_ENV` | Yes (`production`) | Disables `/v1/auth/dev-signin`, enforces `ALLOWED_ORIGINS`, HSTS, and TLS |
| `ALLOWED_ORIGINS` | Yes | Comma-separated allowlist (e.g. `app://dualai,file://,https://app.dualai.app`) |
| `SONIOX_API_KEY` | Yes | Primary unified real-time STT + 15-speaker diarization + 2-way translation |
| `SONIOX_MODEL` | Optional | Defaults to `stt-rt-v6` |
| `SUPABASE_URL` | Yes | Production Supabase project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only Supabase `service_role` key (never exposed to Electron client) |
| `BILLING_WEBHOOK_SECRET` | Yes | Shared HMAC-SHA256 secret verifying PayPal/Paddle purchase webhooks |
| `PAYPAL_CHECKOUT_BASE_URL` | Optional | Hosted PayPal/Paddle checkout link base URL (Honduras payout compatible) |
| `PADDLE_CHECKOUT_BASE_URL` | Optional | Hosted Paddle Merchant-of-Record checkout link base URL |
| `MS_STORE_TENANT_ID` | Windows Store | Microsoft Entra ID tenant ID for Store Collections API v9.0 |
| `MS_STORE_CLIENT_ID` | Windows Store | Microsoft Entra ID application client ID |
| `MS_STORE_CLIENT_SECRET` | Windows Store | Microsoft Entra ID client secret |

---

## 2. Supabase Production Database & Force RLS Setup

1. Open your production Supabase project -> **SQL Editor**.
2. Execute [001_zero_trust_quota_billing.sql](../supabase/migrations/001_zero_trust_quota_billing.sql).
3. In **Authentication -> Providers -> Email**, enable **Confirm email** so unverified signups cannot activate the 1-hour free tier.
4. Verify Force RLS against unauthorized client mutations:
   ```bash
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon_key> pnpm run verify:rls
   ```
   Expected result: `anon`/`authenticated` `UPDATE` attempts on `user_quotas` and direct RPC calls to `deduct_usage_seconds` / `credit_billing_purchase` are 100% blocked.

---

## 3. Deploy Cloud Gateway over TLS (`https://` & `wss://`)

### Option A: Railway (Recommended for fast zero-ops deploys)
1. Create a Railway project linked to this repository (Railway automatically reads `railway.toml` and builds `server/Dockerfile`).
2. Add all secrets from Section 1 in **Railway -> Variables**.
3. Attach your custom domain (`api.dualai.app`) for automatic TLS (`https://` and `wss://`).
4. Verify live health probe:
   ```bash
   curl -fsS https://api.dualai.app/v1/health
   ```

### Option B: Fly.io (`fly.toml`)
```bash
fly launch --no-deploy --copy-config
fly secrets set \
  ALLOWED_ORIGINS="app://dualai,file://,https://app.dualai.app" \
  SONIOX_API_KEY="..." \
  SUPABASE_URL="https://<ref>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  BILLING_WEBHOOK_SECRET="..."
fly deploy
curl -fsS https://dualai-cloud-gateway.fly.dev/v1/health
```

---

## 4. Packaging the Electron Desktop App for Production

Before building installers (`pnpm run build:win` / `pnpm run build:mac`), set the public non-secret client build variables:

```bash
export VITE_GATEWAY_URL="https://api.dualai.app"
export VITE_SUPABASE_URL="https://<ref>.supabase.co"
export VITE_SUPABASE_ANON_KEY="<public_supabase_anon_key>"
pnpm run build && pnpm run security:gate
```

`pnpm run security:gate` guarantees zero server secrets or upstream provider URLs exist in `out/` or the git index before release.
