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

### 5. Platform subscription — the 2,000 MXN/month Price

This is the fee **restaurants pay Tavli** for using the product (ADR 008,
`convex/billing.ts`). It has nothing to do with the 12% service fee diners pay
on an order — different payer, different money path, different Stripe objects.
Do not model it as a Connect fee and do not touch the connected accounts for it.

**Create the Price in each account separately.** Dev and production are separate
Stripe accounts (see the account-prefix check above), so this is done twice and
the two ids differ. There is no "copy to live" for this object.

1. Dashboard → **Product catalog** → **+ Add product**
   - Name: `Tavli platform subscription`
   - Pricing model: **Recurring**, **Standard pricing**
   - Amount: **2,000.00 MXN**, billing period **Monthly**
2. Save, then copy the **Price** id (`price_…`, _not_ the product `prod_…`).

The amount lives in Stripe, not in the code. `PLATFORM_MONTHLY_FEE_MXN_CENTS`
(`convex/constants.ts`) is display copy for the settings screen; changing it
changes what the UI says, never what Stripe charges. To reprice, create a new
Price and point the env var at it.

**Set the env var per deployment** (Convex deployment env, like the other Stripe
values — not Infisical):

```bash
npx convex env set STRIPE_PLATFORM_FEE_PRICE_ID price_...            # dev
npx convex env set STRIPE_PLATFORM_FEE_PRICE_ID price_... --prod     # production
```

Unset, `billing.createSubscriptionCheckout` fails closed with the stable code
`ERROR_BILLING_PRICE_NOT_CONFIGURED` rather than charging anything.

| Value                          | Lives in                  | Applied                                              |
| ------------------------------ | ------------------------- | ---------------------------------------------------- |
| `STRIPE_PLATFORM_FEE_PRICE_ID` | **Convex deployment env** | Read at call time by `getStripePlatformFeePriceId()` |

#### Extra events on the PAYMENTS destination

The subscription lifecycle is made of **platform-account v1 snapshot events**,
so they go on the existing payments destination (`/stripe/webhook`) next to
`payment_intent.*`. Add these six to that destination's event list:

```text
checkout.session.completed          customer.subscription.created
customer.subscription.updated       customer.subscription.deleted
invoice.paid                        invoice.payment_failed
```

Notes that will save an afternoon:

- **Do not touch the Connect destination's event list.** It is v2 thin
  `v2.core.account*` only; a subscription event subscribed there would never
  fire, because it does not belong to a connected account.
- `checkout.session.completed` used to be explicitly excluded here ("Tavli uses
  an embedded PaymentElement, never hosted Checkout"). That is still true of the
  **diner** money path. The platform subscription is the one exception: it uses
  Stripe-hosted Checkout in `mode: "subscription"`, and the handler ignores every
  session whose mode is not `subscription`, so the diner path is unaffected.
- `invoice.paid` (not `invoice.payment_succeeded`) is the one Tavli listens for.
- Dedup is shared with the payment events via `stripeWebhookEvents`, so
  redeliveries are no-ops.

Local forwarding picks them up with the same command, extended:

```bash
stripe listen --forward-to http://localhost:3210/stripe/webhook \
  --events payment_intent.succeeded,payment_intent.payment_failed,charge.refunded,\
checkout.session.completed,customer.subscription.created,customer.subscription.updated,\
customer.subscription.deleted,invoice.paid,invoice.payment_failed
```

Test-mode `trigger` shortcuts for a smoke test:

```bash
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger invoice.paid
```

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

- Removing one paid line refunds `lineTotal + round(lineTotal × 12%)`, clamped
  to the payment's remaining balance, keyed
  `refund:<orderPaymentId>:<orderItemId>`.
- Removing the order's **last live line** refunds the payment's **entire
  remaining balance**, so however the per-line `round()`s fell, the refunds of
  an order emptied line by line sum to exactly `payment.amount` — zero residue
  by construction.
- A whole-order cancel refunds the same payment's entire remaining balance under
  the distinct key `refund:<orderPaymentId>:<orderId>`, so a whole-order cancel
  after a failed per-line attempt is not replayed at Stripe as a no-op.

Every refund on a post-pivot order concerns exactly **one** charge: an order has
one pay-at-submit payment, and a dish that turns out to be unavailable is
refunded, never re-charged at a different price (ADR 013).

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
- A `payment_intent.succeeded` whose collected amount disagrees with the payment
  row settles **nothing**: the payment is marked `failed` with failure code
  `amount_mismatch` (so a tab unlocks and the order stays payable) and a severe
  `payment_amount_mismatch` operator alert is raised, naming both amounts
  (TAVLI-69). Resolve it by refunding the charge in Stripe — the money is still
  there, and the diner pays again; no mutation can settle a mismatched payment.
  That refund records itself on the payment row but deliberately does **not**
  flip the order to refunded, because the order was never paid. Watch for
  `PAYMENT AMOUNT MISMATCH` in the Convex logs. The stuck-tab reconciliation
  cron logs the same line and fails the row, but deliberately does **not**
  re-raise the alert, so an acknowledged one staying quiet is correct rather
  than a missed event.
- A `payment_intent.*` event is matched to its payment row by
  `stripePaymentIntentId` **and**, failing that, by `metadata.paymentId`
  (TAVLI-105). The fallback is what makes the one-tap tip safe: `createTipCharge`
  charges the saved card with `off_session: true, confirm: true`, so the money
  moves before the row can be told the intent id, and the success event can beat
  that patch. On a fallback match the intent id is patched onto the row and
  settlement proceeds normally. An event that neither route can place is still
  recorded as processed — a redelivery would ask the same two questions — so the
  alert is the only thing carrying it to a human.
- **Which unplaceable events alert, and which are only logged.** Every intent
  Tavli creates also stamps `metadata.deployment` with this deployment's slug
  (from `CONVEX_CLOUD_URL`), because the two dev deployments and staging all
  charge the **same** Stripe test account and all of them stamp
  `metadata.paymentId` too. A severe `charge_unmatched` alert emails every
  platform admin, so exactly two situations raise one:
  - the marker is **ours** and the row the intent names is **missing**; or
  - the row **exists here** and already names a **different** intent — marked,
    unmarked, does not matter, because a row in our own database is
    unambiguously ours.

  Both are keyed `charge_unmatched:<pi_…>` and logged as `CHARGE UNMATCHED` with
  a `reason`. Everything else is logged as `FOREIGN PAYMENT INTENT IGNORED` with
  no alert: no `paymentId` at all, a marker naming another deployment (whose
  `paymentId` is not even looked up), or an unmarked intent whose row is missing —
  unattributable rather than unaccounted-for. An unmarked intent whose row _is_
  found still settles normally, so a tip charge in flight across the deploy is not
  lost. If neither `CONVEX_CLOUD_URL` nor `CONVEX_SITE_URL` resolves, the webhook
  logs `DEPLOYMENT MARKER UNAVAILABLE` and raises no unmatched-charge alerts at
  all — matching still works, only the attribution is blind.

- **A superseded PaymentIntent is cancelled at Stripe before its row is retired**
  (TAVLI-104). Editing an order, moving the tip slider or re-opening the tab
  creates a replacement intent; the previous one is stood down first, through the
  one shared helper `standDownPaymentIntent` (retrieve → `succeeded`? leave it
  for the webhook; `canceled`? nothing to do; otherwise cancel). Order, tab and
  tip all go through it, and so does "Back to menu" on the checkout page. If the
  stand-down cannot be completed, **no new intent is created**: the diner sees
  `ERROR_PAYMENT_CANCEL_FAILED` ("try again") when Stripe was unreachable, or
  `ERROR_PAYMENT_ALREADY_PAID` when the old intent had already succeeded — the
  webhook settles that one moments later. A second tap landing while the first
  attempt's `paymentIntents.create` is still running (row `pending`, no intent
  id, younger than `PAYMENT_CREATE_IN_FLIGHT_WINDOW_MS`, which derives to 195s —
  see the derivation below) gets
  `ERROR_PAYMENT_IN_PROGRESS` rather than superseding a charge that is moving
  money right now. That window is **derived**, not picked:
  `(STRIPE_MAX_NETWORK_RETRIES + 1) × STRIPE_REQUEST_TIMEOUT_MS + margin` = 195s,
  from the same two constants `getStripeClient` is built with, because the worst
  case is every retry timing out. Changing the client's timeout or retry count
  moves the window with it — that is the point; do not re-hardcode either.
  The guard is asked **twice**: once in the action (against a snapshot) and again
  inside the inserting transaction (`stripeHelpers.createPayment`, or
  `sessions.beginTabPayment` for a tab), where Convex's OCC serialises two taps
  that both got past the snapshot. `createPayment` moves the order's
  `activePaymentId` in that same transaction so the two taps collide on one
  document; a tab caller passes `supersededPaymentId` and the mutation refuses to
  retire anything else.
  If a create returns _after_ its row was retired,
  `stripeHelpers.attachIntentToPayment` (and its tab mirror
  `sessions.markTabPaymentProcessing`) refuses to write the intent id onto the
  retired row (logged `INTENT ARRIVED FOR A RETIRED ROW`) and stands that intent
  down at Stripe instead. It returns `{ attached: false }`, and the create path
  then returns **no client secret** and does not re-point the order or the
  session — it fails with `ERROR_PAYMENT_IN_PROGRESS` (logged
  `INTENT CREATED FOR A ROW THAT NO LONGER OWNS IT`), because another attempt
  owns that payment now and handing out a secret for an intent nothing is
  watching is how a diner confirms a charge no row will ever settle. If that orphan had already charged, a severe
  `charge_needs_review` alert is raised (`charge_on_retired_attempt:<paymentId>`).
  **A retired row is never settled by the webhook either**: the metadata fallback
  (TAVLI-105) exists to repair a row that lost a race, not to hand a settlement
  target to one that was replaced, so it does **not** attach to a
  SUPERSEDED/CANCELLED row (logged `CHARGE FOR A RETIRED PAYMENT ROW`).
  `handlePaymentIntentSuccess` then decides what that money deserves: a **tip** is
  refunded automatically via `payments.refundRetiredTipCharge`, which records the
  ids and `refundStatus: requested`, keeps the row SUPERSEDED so it can never
  enter the tip pool, raises the same `charge_on_retired_attempt:<paymentId>`
  alert and schedules `stripe.refundStrandedCharge` — a tip has no "food already
  eaten" argument, since the tip the member meant to leave was charged by the
  attempt that replaced this one (logged
  `REFUNDING A TIP CHARGED ON A RETIRED ATTEMPT`). An **order** row falls through
  to `confirmPayment` and is accepted or refunded like any other unplaceable
  charge. `payments.confirmTipPayment` carries the same guard directly (logged
  `REFUSING TO SETTLE A RETIRED TIP ROW`), because the sweep can reach it too.
  A cancel whose intent slips through — Stripe answers
  `payment_intent_unexpected_state` because a stale tab confirmed it mid-cancel —
  is re-read once and reported as `ERROR_PAYMENT_ALREADY_PAID`, not "try again". The tab path cancels inside `createTabPaymentIntent`, ahead of
  `sessions.beginTabPayment`, because a mutation cannot call Stripe and a
  scheduled cancel could land after the replacement intent exists.
- **A `payment_intent.succeeded` that matches no active payment is accepted or
  refunded, never dropped** (TAVLI-104). `orders.confirmPayment` used to warn and
  return on three conditions — the payment is not the order's `activePaymentId`,
  the order's `updatedAt` moved past the payment's snapshot, or the total drifted
  — leaving Stripe holding the diner's money and the order unreleased. It now
  recomputes what the order costs right now (same helper `createPaymentIntent`
  uses: subtotal + 12% fee + the gratuity on the row) and either:
  - **accepts** — settles the order with that payment, re-points
    `activePaymentId` at it, retires any newer attempt and cancels that attempt's
    intent through `stripe.standDownSupersededIntent`; logged as
    `adopting payment …`; or
  - **refunds in full** — the row goes `succeeded` with
    `refundStatus: requested`, the order goes back to **unpaid and still owed**
    (not "refunded" — it was never paid), a severe `charge_mismatched_refunded`
    alert is raised carrying both amounts, and `stripe.refundStrandedCharge`
    issues the refund on a `runAfter(0)` hop with idempotency key
    `stranded-charge-refund:<paymentId>`. Logged as
    `REFUNDING A CHARGE THAT MATCHES NO ORDER TOTAL`.
    An order that **cannot be released by this charge at all** no longer just logs
    and returns (it used to leave the row PROCESSING forever with money at Stripe):
  - `cancelled` → the same full refund and `charge_mismatched_refunded` alert.
    Nobody is cooking it, so the money goes back automatically.
    `orders.updateStatus → cancelled` also lets go of a still-in-flight payment
    in the same transaction that voids the ticket — row → CANCELLED, order
    pointer and `paymentState` cleared — and stands the intent down at Stripe on
    a scheduler hop. That closes the window rather than cleaning up after it, and
    staff never see a cancelled order still "processing" a card. A payment that
    already SUCCEEDED is left alone: that cancel is a refund, which
    `cancelOrderAndRefund` owns.
  - `served` (or `preparing` / `ready`) → the food has moved, so only the money
    is open, and it is decidable. **Unpaid and the amount matches** → the money
    settles (`paymentState: paid`, `activePaymentId`, `settledBy: "stripe"`,
    `paidAt`) while the kitchen status is left alone — putting a finished round
    back on the rail would be worse than the bug. This is the
    `releaseCashOrdersImmediately` case (TAVLI-81): a round is served with its
    cash uncollected and the diner pays by card from another tab, and leaving the
    row SUCCEEDED beside an unpaid order is how staff then collect the cash too.
    Logged `settling money on order … without touching the kitchen status`.
    **Already paid** (by another card payment, or in cash — `settledBy: "staff"`
    leaves no payment row at all, which is why `paymentState` is the test) **or
    the amount does not match** → full refund, exactly like the repriced branch.
- **A fully refunded payment row is not revenue.** `paymentMoneyHelpers` excludes
  `refundStatus: "succeeded"` rows from restaurant revenue and tips, because an
  automatically refunded stranded charge would otherwise be counted alongside the
  payment the diner makes on their second attempt — the same sale twice. Partial
  refunds are unchanged (still counted gross).
- **A refunded card attempt never un-pays a cash settlement.** The stranded
  refund clears the order's `activePaymentId` / `stripePaymentIntentId` whenever
  they name the refunded payment, but only resets `paymentState` to `unpaid`
  when the order is not already PAID. A cash-settled order keeps `settledBy:
"staff"` and its `paidAt` — the restaurant has that money. To stop the race
  reaching that point at all, `orders.markOrderPaidInPerson` now refuses with
  `ERROR_ORDER_PAYMENT_IN_FLIGHT` while a PENDING/PROCESSING card attempt is
  active, exactly as `requestPayInPerson` already does from the diner's side.
  Staff clear it by having the diner tap "Pay in person" or leave the checkout
  (both cancel the intent); the next attempt supersedes it, and the
  stuck-payment sweep catches a `processing` row that stopped moving.
- **The refund's own `charge.refunded` does not restate the order.**
  `recordChargeRefund` flips an order to REFUNDED only when the refunded row is
  the order's `activePaymentId` AND the order is PAID or REFUND_REQUESTED. A
  stranded charge is SUCCEEDED but never settled its order, so the order stays
  unpaid and owed.
- The create path cannot undo a settlement, on either branch.
  `stripeHelpers.attachIntentToPayment` records the intent id but moves the status
  only `pending` → `processing`, and `stripeHelpers.failPaymentUnlessSettled`
  writes `failed` only from `pending` / `processing`. The second one matters
  because a thrown error out of `paymentIntents.create` does **not** prove the
  card was not charged: with `confirm: true` Stripe can take the money and lose
  the response (timeout on the call and on both `maxNetworkRetries` replays), the
  webhook settles the tip through the fallback, and the action's `catch` arrives
  afterwards. When it finds the row already `succeeded`, `createTipCharge` returns
  success instead of rethrowing — telling the diner to retry would be a second
  charge for the same tip — and logs
  `CHARGE SETTLED DESPITE A FAILED CREATE CALL`. Also watch for
  `INTENT ID CONFLICT`, a payment row asked to attach a second intent id.

## Post-launch monitoring

- Convex logs for webhook signature failures
- Convex logs for `REFUND ID UNRESOLVED` / `REFUND LOOKUP FAILED`
- Convex logs for `CHARGE DISPUTE` — disputes hit the platform balance
- Convex logs for `CHARGE UNMATCHED` — a charge this deployment cannot tie to a
  payment row; always paired with a severe `charge_unmatched` alert on
  `/admin/alerts`. `FOREIGN PAYMENT INTENT IGNORED` beside it is the benign
  counterpart (another deployment's charge on the shared test account): expected
  traffic in dev and staging, not a finding
- Convex logs for `REFUNDING A CHARGE THAT MATCHES NO ORDER TOTAL` — a charge
  Tavli sent back because it no longer matched its order; always paired with a
  severe `charge_mismatched_refunded` alert naming both amounts. Confirm the
  refund landed in Stripe, then acknowledge the alert
- Convex logs for `RETIRED INTENT ALREADY SUCCEEDED`,
  `CHARGE FOR A RETIRED PAYMENT ROW` or
  `REFUNDING A TIP CHARGED ON A RETIRED ATTEMPT` — a charge landed on a payment
  attempt Tavli had retired. The money is resolved automatically (tips refunded,
  order charges applied or refunded) and a severe `charge_needs_review` alert
  asks you to confirm the outcome landed in Stripe
- `stripeWebhookEvents` rows are being created for processed events
- Payment and refund states match the Stripe Dashboard for spot-checked orders
- The stuck-tab reconciliation cron (`stripe:reconcileStuckTabPayments`) runs
  every 5 minutes and settles or unlocks tabs locked longer than 10 minutes

Reading Convex logs is not monitoring, because nobody does it on a normal day.
Operator alerts (TAVLI-109) are the part that comes to you instead: money-path
code raises one through `raiseOperatorAlert`, it lands in `operatorAlerts`, and
a platform admin reads it on **`/admin/alerts`** — open alerts first, newest
first, each with an Acknowledge button that records who cleared it and when.
An alert carrying a `dedupeKey` is raised once while it is open, so a Stripe
event redelivered fifty times is one row, and acknowledging that row lets the
next occurrence through as a fresh alert.

**Any call site that can fire more than once for the same problem must pass a
`dedupeKey` naming that problem** — `payment_stuck:<paymentId>`,
`payout_failed:<payoutId>`, and so on. That covers every cron sweep (which sees
the same stuck payment on each run), every webhook handler (Stripe redelivers
for days until it gets a 2xx it believes) and every retried action. The reason
is capacity, not neatness: the page reads the OPEN group unbounded on purpose,
because an open alert is work somebody still owes and truncating would hide the
one that has been ignored longest. A keyless sweep therefore adds a row per run
and walks that read into Convex's 32,000-document limit within days — at which
point `/admin/alerts` stops loading for _every_ alert, including the one worth
reading. Only the acknowledged history is capped (newest 200).

A **severe** alert (an unmatched
charge, a failed payout, a closed connected account) additionally emails every
platform admin — users holding the org-level `admin` role, and nobody else.
Never the org-level `owner` role: that is the client proprietor of a restaurant
group, so mailing them would send Tavli's internal incident traffic about one
client to every other client. Delivery uses the existing
`RESEND_API_KEY` / `RESEND_FROM_ADDRESS` and `PUBLIC_APP_URL` — no new
environment variable, and no new place for the email to be configured. The
email is scheduled rather than awaited, so Resend being down never fails the
transaction that recorded the problem.

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
