# Stripe Go-Live Runbook

## Purpose

Production configuration and verification for Tavli's Stripe integration:

- Stripe Connect (V2 accounts) onboarding for restaurants
- `PaymentElement` tab checkout for diners
- Standard (snapshot) payment webhooks
- Connect (thin) account-lifecycle webhooks
- Refunds, including partial refunds of a single order out of a paid tab

> [!IMPORTANT]
> **Production and dev are two separate Stripe accounts**, both named "Tavli".
> This is unusual — normally one account has a test and a live mode sharing one
> account id. Here they are genuinely distinct:
>
> |            | Account                 |
> | ---------- | ----------------------- |
> | Production | `acct_1TGR3uAUMbq2vVG5` |
> | Dev / test | `acct_1TGR41AdCrGPY0BG` |
>
> Nothing verified in dev's test mode is verified on the production account.
> `pk_live`, `sk_live`, and **both** webhook signing secrets must all come from
> the production account. Mixing one in from dev is the Stripe equivalent of a
> Clerk `jwk-kid` mismatch — every live charge fails.

## Where each value lives

| Value                                       | Lives in                                            | Applied                                                                                                         |
| ------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `VITE_STRIPE_PUBLISHABLE_KEY` (`pk_live_…`) | **Infisical**, per-env (`dev` / `staging` / `prod`) | **Build time** — inlined into the JS bundle by `deploy.yml`. Changing it requires a **rebuild**, not a restart. |
| `STRIPE_SECRET_KEY` (`sk_live_…`)           | **Convex deployment env**                           | Read at call time by `getStripeClient()`                                                                        |
| `STRIPE_WEBHOOK_SECRET` (`whsec_…`)         | **Convex deployment env**                           | Read by `stripe.fulfillPayment`                                                                                 |
| `STRIPE_CONNECT_WEBHOOK_SECRET` (`whsec_…`) | **Convex deployment env**                           | Read by `stripe.handleThinEvent`                                                                                |

See [`deployment-and-secrets.md`](../internal-guides/deployment-and-secrets.md)
for the full model. The Convex-side values are **not** in Infisical.

```bash
npx convex env set STRIPE_SECRET_KEY sk_live_... --prod
npx convex env set STRIPE_WEBHOOK_SECRET whsec_... --prod
npx convex env set STRIPE_CONNECT_WEBHOOK_SECRET whsec_... --prod
```

**Verify a key belongs to the right account without exposing it.** Every Stripe
key embeds its account id after the `_51` prefix, and that portion is public —
it appears in the dashboard URL:

```bash
npx convex env get STRIPE_SECRET_KEY --prod | cut -c1-22
# sk_live_51TGR3uAUMbq2v  → production ✅
# sk_live_51TGR41AdCrGPY  → dev ❌ wrong account
```

## Stripe dashboard configuration

### 1. Account activation

Confirm on the **live** account (`acct_1TGR3uAUMbq2vVG5`):

- `charges_enabled: true` and `payouts_enabled: true`
- `default_currency: mxn` — all amounts are MXN minor units; a USD-default
  account fails every `paymentIntents.create` on currency mismatch
- `requirements.currently_due` is empty
- Capabilities `card_payments`, `link_payments`, `transfers` are **active**

> [!NOTE]
> The dashboard's "Guía de configuración" checklist is a **UI onboarding
> tracker, not account state**. It can still list "Verifica tu empresa" and
> "Pasar a modo activo" as pending on a fully activated account. Trust
> `GET /v1/account` over the checklist.

**Link matters.** Several test-mode charges went through Link rather than raw
card. If Link is disabled on the live payment-method configuration, returning
customers silently lose a method they had in test.

### 2. Two webhook destinations — structural, not a preference

v1 snapshot events and v2 thin events use **different Convex routes, different
signing secrets, and different parsers**. They can never share one destination.

|                      | Payments                                    | Connect                                             |
| -------------------- | ------------------------------------------- | --------------------------------------------------- |
| Name                 | `tavli-prod-payments`                       | `tavli-prod-connect-accounts`                       |
| URL                  | `https://<slug>.convex.site/stripe/webhook` | `https://<slug>.convex.site/stripe/connect-webhook` |
| Scope ("Eventos de") | **Tu cuenta**                               | **Tu cuenta**                                       |
| Payload style        | **Resumen** (snapshot)                      | **Breve** (thin)                                    |
| Secret               | `STRIPE_WEBHOOK_SECRET`                     | `STRIPE_CONNECT_WEBHOOK_SECRET`                     |
| Parser               | `webhooks.constructEvent`                   | `parseEventNotification`                            |
| Handler              | `stripe.fulfillPayment`                     | `stripe.handleThinEvent`                            |

> [!IMPORTANT]
> Use the **`.convex.site`** host, never `.convex.cloud`. Convex serves HTTP
> actions from `*.convex.site`; `*.convex.cloud` only serves the WebSocket RPC
> API and returns 404 for these routes. The slug is the subdomain of
> `VITE_CONVEX_URL` (production: `polite-antelope-545`).

Selecting a mix of v1 and v2 events in Stripe's "Crea un destino de evento"
wizard makes it **auto-split into two destinations** and walk you through both
("1 de 2", "2 de 2"). You do not create them separately.

**Scope is "Tu cuenta" for both.** V2 accounts created directly by the platform
deliver to _Tu cuenta_; only events belonging to a connected account's own
customers deliver to _Cuentas conectadas_. A consequence: the v1
`account.updated` handler is effectively **dead** for our V2 accounts, which is
why it is absent from the list below.

#### Payments destination events (9)

```text
payment_intent.succeeded            payment_intent.payment_failed
payment_intent.canceled             charge.refunded
charge.dispute.created              charge.dispute.closed
charge.dispute.updated              charge.dispute.funds_reinstated
radar.early_fraud_warning.created
```

The last four have **no handler yet** (tracked on TAVLI-65). They are
subscribed deliberately so the live destination never needs editing again;
unhandled types fall through the switch and are recorded for dedup only.

Do **not** subscribe `checkout.session.*` — Tavli uses an embedded
`PaymentElement`, never hosted Checkout. Three such subscriptions were pruned
from the dev destination as dead weight.

#### Connect destination events

All 15 `v2.core.account*` types are subscribed. Only two are handled today:

```text
v2.core.account[requirements].updated
v2.core.account[configuration.recipient].capability_status_updated
```

Beware the near-miss pair: you want
`[configuration.recipient].capability_status_updated`, **not**
`[configuration.recipient].updated`.

> A thin payload carries **no `data.object`** — only
> `{id, object: "v2.core.event", type, created, related_object: {id, type, url}}`.
> That is why `handleThinEvent` re-fetches the account through
> `inferV2AccountStatus` instead of reading the event body. The destination
> showing **"Sin versión"** for API version is expected: there is no embedded
> object to version.

### 3. Verifying a live signing secret

There is **no "send test event" in live mode**, and the live dashboard Shell is
read-only. The only way to prove a secret before real traffic is to generate a
real event of a subscribed type that moves no money — create a PaymentIntent and
cancel it before confirmation:

```bash
export STRIPE_LIVE_KEY=sk_live_...
PI=$(curl -s https://api.stripe.com/v1/payment_intents -u "$STRIPE_LIVE_KEY:" -d amount=5000 -d currency=mxn -d "payment_method_types[]=card" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -s -X POST "https://api.stripe.com/v1/payment_intents/$PI/cancel" -u "$STRIPE_LIVE_KEY:" >/dev/null
unset STRIPE_LIVE_KEY
```

Nothing is charged or captured — no payment method is ever attached. Then check
the Convex deployment logs for the delivery:

```text
Q  getProcessedStripeWebhookEventInternal   success
M  recordStripeWebhookEvent                 success
A  stripe:fulfillPayment                    success
H  POST /stripe/webhook                     200
```

A `400` on the POST means signature verification failed — the secret is wrong.

> [!WARNING]
> Do **not** use "the table looks empty" as evidence. Convex's `inferredSchema`
> **lags behind actual writes** and will report a table as empty for a minute or
> more after a row is inserted. Read the deployment logs instead. Two wrong
> conclusions during the cutover traced to exactly this.

The **Connect** secret needs a different trick, since no thin event fires
without a connected account. You do not have to wait for a real restaurant:

1. Sign in as an admin and click **Iniciar configuración para cobrar pagos** on
   any restaurant. That calls `createConnectAccount`, which creates a live V2
   connected account and fires several `v2.core.account*` events at the Connect
   destination.
2. Watch the Convex logs for `POST /stripe/connect-webhook → 200` and
   `stripe:handleThinEvent success`. Lines reading
   `Unhandled thin event type: …` are fine — reaching the handler at all proves
   `parseEventNotification` accepted the signature.
3. **Stop at the Stripe Express onboarding screen — do not complete it.** It
   collects real KYC (government ID, tax ID, bank account). Completing it for a
   test restaurant would create a live merchant account under false pretenses.
4. Clean up with **Restablecer configuración de Stripe** in the same section.
   `resetStripeConnection` calls `v2.core.accounts.close` with
   `applied_configurations: ["merchant", "recipient"]` and then clears the
   Convex link, so it closes the Stripe account too — you do not need to close
   it by hand.

> [!NOTE]
> The close is **best-effort**. If Stripe rejects it, the Convex link is cleared
> anyway and the action returns `closedStripeAccount: false`. Check the app's
> confirmation message names the account id, and look for
> `[stripe.resetStripeConnection]` with `operation: "closeAccount"` in the logs
> if it did not.
>
> A closed account **still appears** in Connect → Cuentas conectadas. Stripe
> retains closed connected accounts for history; the row remaining is not a
> failed cleanup.

### 3b. Activating Connect — and why the errors mislead

Connect platform activation is a **separate gate** from account activation.
`GET /v1/account` can report `charges_enabled: true`, `payouts_enabled: true`,
`details_submitted: true` and no outstanding requirements while
`v2.core.accounts.create` still fails. The Connect settings and overview pages
also render normally with no activation prompt, so the dashboard is not evidence
either.

> [!TIP]
> **When V2 is opaque, probe V1.** `v2.core.accounts.create` returns the same
> unhelpful sentence for every underlying cause:
>
> ```
> Your account must be activated in order to create accounts.
> ```
>
> `POST /v1/accounts` names the actual gate and gives the exact URL:
>
> ```bash
> curl -s https://api.stripe.com/v1/accounts -u "$STRIPE_LIVE_KEY:" \
>   -d type=express -d country=MX | head -c 300
> ```
>
> During the cutover this surfaced three sequential gates, each behind a
> different URL and none discoverable by navigation:
>
> | V1 error                                                   | Where to fix                                                         |
> | ---------------------------------------------------------- | -------------------------------------------------------------------- |
> | "review the responsibilities of managing losses"           | `/settings/connect/platform-profile` — confirm both acknowledgements |
> | "complete your platform profile… answer the questionnaire" | `/connect/accounts/overview` — questionnaire + identity documents    |
> | (none — V1 succeeds)                                       | Connect is active; retry V2                                          |
>
> Delete anything V1 creates: `DELETE /v1/accounts/acct_...`.

Loss responsibility must be declared as **platform-managed** in the platform
profile. `createConnectAccount` sets `losses_collector: "application"` on every
account; if the profile says otherwise, account creation fails.

### 4. Connected-account readiness

Before enabling payments for a restaurant:

- The connected account exists and onboarding is complete
- `stripe_transfers` capability is active
- The restaurant is active in Tavli

Test-mode connected-account ids are **invalid in live mode**, and ids created
under the dev Stripe account are unreachable with the production `sk_live`
entirely. Any restaurant onboarded in test must be onboarded again in live.

## Money-path behaviour worth knowing

### The platform is `losses_collector`

Disputes and chargebacks settle against the **platform** balance
(`convex/stripe.ts`). Tavli absorbs them, not the restaurant.

### Commission is 12%, and excludes tips

`PLATFORM_APPLICATION_FEE_RATE = 0.12` is applied to the **tab subtotal only**
(`createTabPaymentIntent`). A 1000.00 subtotal with a 100.00 tip produces
`application_fee_amount: 12000`, not `13200`. Verified against live API
responses.

### `charge.refunded` does not contain the refund

Stripe omits the `refunds` list from the charge delivered with `charge.refunded`
— its own dashboard copy says _"Listen to `refund.created` for information about
the refund."_ `handleChargeRefunded` therefore looks the refund up explicitly
via `refunds.list({ payment_intent, limit: 1 })`. Without that fallback,
`stripeRefundId` is silently never written and `refundedAt` falls back to
webhook-processing time.

### Partial refunds apportion on the charge total (LEGACY tab payments only)

**Legacy tab payments (pre-ADR-008):** cancelling one order out of a paid tab
refunds that order's `totalAmount` with **no tip share**. Stripe apportions
`reverse_transfer` and `refund_application_fee` proportionally — but on the
**charge total** (subtotal + tip), whereas our fee was levied on **subtotal
only**. The platform therefore retains a small residue.

Measured on a real test-mode refund: charge 110000 (subtotal 100000 + tip
10000), fee 12000, refund 100000 → fee refunded **10909**, platform retains
**1091** = **1.09% of the refunded amount**. The error is
`refundAmount × feeRate × tip/(subtotal + tip)` and shrinks with the tip.
Accepted for the legacy tail; exact accounting would require explicit
fee-refund and transfer-reversal calls, which are a one-way door — Stripe
disallows the proportional flags on that charge afterwards.

**New-model payments (ADR 008, pay-at-submit) retire this residue
structurally.** The charge is fee-inclusive (`amount = subtotal + 12%`, no tip
on it), and refund math is computed in-house, per line
(`computeLineRefundAmount`):

- 86'ing one paid line refunds `lineTotal + round(lineTotal × 12%)`, clamped to
  the payment's remaining balance.
- 86'ing the order's **last live line** refunds the payment's **entire
  remaining balance**, so however the per-line `round()`s fell, a fully-86'd
  order's refunds sum to exactly `payment.amount` — zero residue by
  construction.
- **Substituted lines span two payments** (TAVLI-71 Phase 3A): the accepted
  substitution's delta (+ 12% fee on the delta) lives on its own
  `kind: "substitution"` payment. 86'ing that line issues **two refunds** —
  the substitution payment's full remaining balance (idempotency key
  `refund:<subPaymentId>:<orderItemId>`), plus the original line share
  (`lineTotal - delta` + its fee share) from the order payment
  (`refund:<orderPaymentId>:<orderItemId>`). Cumulative refunds never exceed
  either payment's captured amount, and the last-live-line sweep clears each
  payment's remainder independently.

> [!CAUTION]
> **A refund issued from the Stripe Dashboard does NOT reverse the transfer.**
>
> Tavli uses destination charges. A dashboard refund returns the full amount to
> the cardholder **out of the platform balance** while the connected account
> keeps its payout — the platform silently absorbs the restaurant's share.
> Verified on a real test refund: `transfer_reversal: null`, the charge's
> `transfer` left intact.
>
> The in-app path is correct — `createRefund` passes `reverse_transfer: true`
> and `refund_application_fee: true`. **If you must refund from the dashboard,
> tick both "Reverse the transfer" and "Refund the application fee."**
>
> Prefer the in-app path (cancel the order in the orders tab), which handles
> this automatically and records the refund against the payment.

## Local development

`pnpm dev` boots Vite and `convex dev` under `infisical run --env=dev`, which
injects `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and
`VITE_STRIPE_PUBLISHABLE_KEY`. Convex functions sync to the **cloud** dev
deployment, so the HTTP endpoints live on `*.convex.site`, not localhost.

> [!WARNING]
> Do not start the dev server with a bare `vite dev`. Without a Clerk
> publishable key, Clerk falls back to a throwaway "keyless" instance: sign-in
> _appears_ to work but issues tokens from a different issuer than
> `CLERK_JWT_ISSUER_DOMAIN`, so Convex never authenticates and every signed-in
> page renders as signed out. Keyless is disabled in `vite.config.ts` so this
> fails loudly instead.

Register a persistent endpoint against the dev deployment (preferred — the
secret is stable across restarts):

```bash
stripe webhook_endpoints create \
  --url https://<dev-slug>.convex.site/stripe/webhook \
  --enabled-events payment_intent.succeeded \
  --enabled-events payment_intent.payment_failed \
  --enabled-events charge.refunded \
  --enabled-events charge.dispute.created \
  --enabled-events charge.dispute.closed
npx convex env set STRIPE_WEBHOOK_SECRET whsec_...
```

Or `stripe listen --forward-to https://<dev-slug>.convex.site/stripe/webhook`
for raw-payload debugging; its secret rotates per session.

### Smoke-test the pipe

```bash
curl -i -X POST https://<slug>.convex.site/stripe/webhook
# Expect 400 "Missing stripe-signature header".
# A 404 means the wrong host (.convex.cloud instead of .convex.site).
```

### Exercising the money paths in test mode

The dev dashboard Shell is writable, unlike live. Useful test payment methods:

| Token                   | Effect                                     |
| ----------------------- | ------------------------------------------ |
| `pm_card_visa`          | succeeds                                   |
| `pm_card_createDispute` | succeeds, then immediately files a dispute |

A destination charge matching production shape:

```bash
curl -s https://api.stripe.com/v1/payment_intents -u "$STRIPE_SECRET_KEY:" \
  -d amount=50000 -d currency=mxn -d "payment_method_types[]=card" \
  -d payment_method=pm_card_createDispute -d confirm=true \
  -d application_fee_amount=6000 \
  -d "transfer_data[destination]=acct_..."
```

Close a dispute to fire `charge.dispute.closed`:

```bash
curl -s -X POST "https://api.stripe.com/v1/disputes/du_.../close" -u "$STRIPE_SECRET_KEY:"
```

Confirming a PaymentIntent server-side needs `--return-url` when
`automatic_payment_methods.allow_redirects` is `always` — Link can redirect:

```bash
stripe payment_intents confirm pi_... --payment-method pm_card_visa \
  --return-url http://localhost:3000/r/<slug>/orders
```

## Pre-launch smoke checks

### Restaurant onboarding

- Start Connect onboarding from the restaurant's Stripe setup UI and return
- Verify the UI refreshes and clears `stripe_return` / `accountId` params
- Verify the restaurant is marked ready only when requirements and transfers are active
- **Watch the Convex logs for the thin-event delivery** — `POST
/stripe/connect-webhook → 200` plus `stripe:handleThinEvent success`.
  `updateOnboardingByAccountId` running means a _handled_ event type arrived and
  the status write-back worked, not just signature verification.

### Tab checkout

- Build a tab with several orders, open checkout, confirm a PaymentIntent is created
- Verify `application_fee_amount` is 12% of the **subtotal**, excluding the tip
- Verify `transfer_data.destination` is the restaurant's connected account
- Complete payment; confirm the session closes and each order flips to `paid`

### Refunds

- Cancel one paid order from the orders tab
- Confirm exactly one refund attempt, for that order's total with no tip share
- Confirm the request uses `reverse_transfer=true` and `refund_application_fee=true`
- Confirm `payments.refundStatus` settles at `partial` for a multi-order tab and
  does **not** flap to `succeeded` when `charge.refunded` arrives moments later
- Confirm the order's `paymentState` becomes `refunded`, and other orders on the
  tab are untouched

### Disputes

- Charge with `pm_card_createDispute`; confirm a `stripeDisputes` row is inserted
  with `openedAt`
- Close the dispute; confirm the **same row** is updated with `closedAt` and the
  new status — not a second row

### Webhook safety

- Replay an event; confirm it is recorded only once (`stripeWebhookEvents` dedup)
- Send an invalid signature; confirm rejection without state mutation

## Post-launch monitoring

- Convex logs for webhook signature failures
- Convex logs for `REFUND ID UNRESOLVED` / `REFUND LOOKUP FAILED`
- Convex logs for `CHARGE DISPUTE` — disputes hit the platform balance
- `stripeWebhookEvents` rows are being created for processed events
- Payment and refund states match the Stripe Dashboard for spot-checked orders
- The stuck-tab reconciliation cron (`stripe:reconcileStuckTabPayments`) runs
  every 5 minutes and settles or unlocks tabs locked longer than 10 minutes

## Common pitfalls

| Symptom                                         | Cause → fix                                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Webhook route returns 404                       | Using `.convex.cloud`. Use `.convex.site`.                                                                                 |
| Webhook returns 400 on real deliveries          | Signing-secret mismatch, or the two `whsec_` values swapped between destinations. Compare fingerprints.                    |
| Live charges succeed but never settle in the DB | Same as above — the customer is charged and the order stays unpaid. This is the failure §3's verification exists to catch. |
| "Development mode" badge on prod                | Bundle built with `pk_test`. Set `pk_live` in Infisical `prod` and **rebuild** — a restart is not enough.                  |
| Thin events never arrive                        | Destination scope set to _Cuentas conectadas_, or payload style _Resumen_ instead of _Breve_.                              |
| `stripeRefundId` never populated                | The `refunds.list` fallback was removed. `charge.refunded` carries no refunds list.                                        |
| Restaurant keeps its payout after a refund      | Refund issued from the dashboard without ticking "Reverse the transfer".                                                   |
| Everything looks configured but charges fail    | Keys mixed between the dev and production Stripe accounts. Check the `_51…` account fingerprint.                           |

## References

- [`deployment-and-secrets.md`](../internal-guides/deployment-and-secrets.md) — the env/secrets model
- `convex/stripe.ts` — actions, webhook handlers, refunds
- `convex/stripeHelpers.ts` — payment and dispute persistence
- `convex/stripeWebhookHelpers.ts` — pure event → state logic
- `convex/http.ts` — the two webhook routes
