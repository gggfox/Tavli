# Stripe Go-Live Runbook

## Purpose
This runbook covers the production configuration and verification steps for Tavli's Stripe integration:

- Stripe Connect onboarding for restaurants
- `PaymentElement` checkout for restaurant orders
- Standard payment webhooks
- Connect thin-event webhooks

## Required Environment Variables

### Frontend
- `VITE_STRIPE_PUBLISHABLE_KEY`

### Convex
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CONNECT_WEBHOOK_SECRET`

### Auth / existing app config
- `CLERK_JWT_ISSUER_DOMAIN`
- Any existing Clerk/TanStack/Convex variables already required by the app

## Stripe Dashboard Configuration

### 1. API Keys
- Confirm the platform account is using the intended live secret key.
- Confirm the frontend publishable key is the matching live publishable key.

### 2. Standard Payment Webhook
Create a webhook endpoint pointing at:

```text
https://<deployment-slug>.convex.site/stripe/webhook
```

> [!IMPORTANT]
> Use the `.convex.site` host, **not** `.convex.cloud`.
> Convex serves HTTP actions (the `/stripe/webhook` route) from `*.convex.site`;
> `*.convex.cloud` only serves the WebSocket client RPC API and will return 404
> for HTTP routes. You can find the deployment slug in `.env.local` as the
> subdomain of `VITE_CONVEX_URL` (e.g. `blessed-weasel-428` →
> `https://blessed-weasel-428.convex.site/stripe/webhook`).

Subscribe to:
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `account.updated` (legacy compatibility only)

Save the signing secret as `STRIPE_WEBHOOK_SECRET` in the Convex deployment
environment (`pnpm exec convex env set STRIPE_WEBHOOK_SECRET whsec_...`).

### 3. Connect Thin-Event Webhook
Create a separate webhook destination pointing at:

```text
https://<deployment-slug>.convex.site/stripe/connect-webhook
```

Same `.convex.site` rule as above.

Configuration:
- Events from: connected accounts
- Payload style: thin

Subscribe to:
- `v2.core.account[requirements].updated`
- `v2.core.account[configuration.recipient].capability_status_updated`

Save the signing secret as `STRIPE_CONNECT_WEBHOOK_SECRET`.

### 4. Connected Account Readiness
Before enabling real payments for a restaurant:
- Confirm the restaurant's connected account exists
- Confirm onboarding is complete
- Confirm `stripe_transfers` capability is active
- Confirm the restaurant is active in Tavli

## Local Development Checklist

### 1. Frontend + Convex
Run the app normally:

```bash
pnpm dev
```

This boots both Vite and `convex dev`. The Convex functions sync to your cloud
dev deployment (see `.env.local`'s `CONVEX_DEPLOYMENT` / `VITE_CONVEX_URL`),
so the HTTP endpoints below live on your cloud host — not on localhost.

### 2. Standard Payment Webhook (choose one)

**Option A — Persistent endpoint (recommended, matches production).**
Register a long-lived endpoint in the Stripe Dashboard (or via CLI) pointing
at your cloud dev deployment's `.convex.site` URL. The signing secret is
stable across restarts and no daemon needs to stay alive.

```bash
stripe webhook_endpoints create \
  --url https://<deployment-slug>.convex.site/stripe/webhook \
  --enabled-events payment_intent.succeeded \
  --enabled-events payment_intent.payment_failed \
  --enabled-events account.updated
# Copy the "secret" field from the response
pnpm exec convex env set STRIPE_WEBHOOK_SECRET whsec_...
```

**Option B — `stripe listen` (best for debugging raw payloads).**
Keep the CLI running in a separate terminal; it proxies events to your
cloud deployment:

```bash
stripe listen --forward-to https://<deployment-slug>.convex.site/stripe/webhook
```

Copy the emitted signing secret into `STRIPE_WEBHOOK_SECRET`. The secret
rotates per `stripe listen` session, so re-copy it each time.

### 3. Connect Thin-Event Webhook
Use the same two-option pattern. For `stripe listen`:

```bash
stripe listen --thin-events \
  "v2.core.account[requirements].updated,v2.core.account[configuration.recipient].capability_status_updated" \
  --forward-thin-to https://<deployment-slug>.convex.site/stripe/connect-webhook
```

Copy the emitted signing secret into `STRIPE_CONNECT_WEBHOOK_SECRET`.

### 4. Smoke-Test the Webhook Pipe
Before trusting the setup, verify the route responds:

```bash
curl -i -X POST https://<deployment-slug>.convex.site/stripe/webhook
# Expect HTTP 400 ("Missing stripe-signature header"). A 404 means you are
# on the wrong host (likely .convex.cloud instead of .convex.site).
```

After any test payment, confirm the event was recorded:

```bash
pnpm exec convex data stripeWebhookEvents --order desc --limit 5
```

## Pre-Launch Smoke Checks

### Restaurant onboarding
- Open the Stripe setup UI for an owner-admin-managed restaurant
- Start onboarding and return to Tavli
- Verify the UI refreshes and clears `stripe_return` / `accountId` params
- Verify the restaurant is marked ready only when requirements and transfers are active

### Restaurant order checkout
- Create a draft order with menu items and option selections
- Open checkout and confirm a PaymentIntent is created
- Refresh the checkout page and verify the active attempt is reused
- Edit the draft order and verify a new payment attempt supersedes the old one
- Complete payment and confirm the order transitions to `submitted`

### Refunds
- Cancel a paid order from the restaurant workflow
- Confirm Tavli creates one refund attempt
- Confirm the refund request uses `reverse_transfer=true`
- Confirm the refund request uses `refund_application_fee=true`
- Confirm the order/payment state becomes `refunded` or `refund_failed`

### Webhook safety
- Replay a standard webhook event and confirm Tavli records it only once
- Replay a Connect thin event and confirm restaurant status remains consistent
- Send an invalid webhook signature and confirm Tavli rejects it without mutating state

## Post-Launch Monitoring
- Watch Convex logs for webhook signature failures
- Watch Convex logs for payment confirmation skips caused by stale or superseded attempts
- Confirm `stripeWebhookEvents` records are being created for processed events
- Confirm no restaurants appear in admin payment flows unless they are active and payout-ready
- Confirm payment and refund states match Stripe Dashboard records for spot-checked orders

## Known Non-Goals
- Automated dispute handling
- Seller clawback automation beyond transfer reversal on refunds
- Accounting exports beyond app-level reporting consistency
