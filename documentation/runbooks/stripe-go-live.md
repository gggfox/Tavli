# Stripe Go-Live Runbook

## Purpose

Production configuration and verification for Tavli's Stripe integration:

- Stripe Connect (V2 accounts) onboarding for restaurants
- `PaymentElement` tab checkout for diners
- Standard (snapshot) payment webhooks
- Connect (thin) account-lifecycle webhooks
- Connected-account (snapshot) payout webhooks
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

| Value                                                 | Lives in                                            | Applied                                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `VITE_STRIPE_PUBLISHABLE_KEY` (`pk_live_…`)           | **Infisical**, per-env (`dev` / `staging` / `prod`) | **Build time** — inlined into the JS bundle by `deploy.yml`. Changing it requires a **rebuild**, not a restart. |
| `STRIPE_SECRET_KEY` (`sk_live_…`)                     | **Convex deployment env**                           | Read at call time by `getStripeClient()`                                                                        |
| `STRIPE_WEBHOOK_SECRET` (`whsec_…`)                   | **Convex deployment env**                           | Read by `stripe.fulfillPayment`                                                                                 |
| `STRIPE_CONNECT_WEBHOOK_SECRET` (`whsec_…`)           | **Convex deployment env**                           | Read by `stripe.handleThinEvent`                                                                                |
| `STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET` (`whsec_…`) | **Convex deployment env**                           | Read by `stripe.handleConnectedAccountEvent`                                                                    |

See [`deployment-and-secrets.md`](../internal-guides/deployment-and-secrets.md)
for the full model. The Convex-side values are **not** in Infisical.

```bash
npx convex env set STRIPE_SECRET_KEY sk_live_... --prod
npx convex env set STRIPE_WEBHOOK_SECRET whsec_... --prod
npx convex env set STRIPE_CONNECT_WEBHOOK_SECRET whsec_... --prod
npx convex env set STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET whsec_... --prod
```

The three secrets are **not interchangeable**. Each destination mints its own,
and a delivery signed by one fails verification against another. The names are
declared together in `convex/_util/env.ts` so the set is countable in one place.

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

### 2. Three webhook destinations — structural, not a preference

Two axes decide the split, and neither is a preference. **Payload style**: v1
snapshot events carry a full `data.object`, v2 thin events carry only a
reference, and the two need different parsers. **Scope**: Stripe delivers
events on _your_ account and events on _connected_ accounts to separate
destinations. Three of the four cells are occupied.

|                      | Payments                                    | Connect                                             | Connected accounts                                    |
| -------------------- | ------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| Name                 | `tavli-prod-payments`                       | `tavli-prod-connect-accounts`                       | `tavli-prod-connected-payouts`                        |
| URL                  | `https://<slug>.convex.site/stripe/webhook` | `https://<slug>.convex.site/stripe/connect-webhook` | `https://<slug>.convex.site/stripe/connected-webhook` |
| Scope ("Eventos de") | **Tu cuenta**                               | **Tu cuenta**                                       | **Cuentas conectadas**                                |
| Payload style        | **Resumen** (snapshot)                      | **Breve** (thin)                                    | **Resumen** (snapshot)                                |
| Secret               | `STRIPE_WEBHOOK_SECRET`                     | `STRIPE_CONNECT_WEBHOOK_SECRET`                     | `STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET`             |
| Parser               | `webhooks.constructEvent`                   | `parseEventNotification`                            | `webhooks.constructEvent`                             |
| Handler              | `stripe.fulfillPayment`                     | `stripe.handleThinEvent`                            | `stripe.handleConnectedAccountEvent`                  |

> [!IMPORTANT]
> Use the **`.convex.site`** host, never `.convex.cloud`. Convex serves HTTP
> actions from `*.convex.site`; `*.convex.cloud` only serves the WebSocket RPC
> API and returns 404 for these routes. The slug is the subdomain of
> `VITE_CONVEX_URL` (production: `polite-antelope-545`).

Selecting a mix of v1 and v2 events in Stripe's "Crea un destino de evento"
wizard makes it **auto-split into two destinations** and walk you through both
("1 de 2", "2 de 2"). You do not create them separately.

**Scope is "Tu cuenta" for the first two.** V2 accounts created directly by the
platform deliver their lifecycle events to _Tu cuenta_. A consequence: the v1
`account.updated` handler is effectively **dead** for our V2 accounts, which is
why it is absent from the list below.

**The third is "Cuentas conectadas", and that is the whole reason it exists.**
A payout from a restaurant's connected account to its own bank belongs to that
account, so it never appears on _Tu cuenta_ — which is why, before TAVLI-103,
`payout.*` reached no handler anywhere and a failed payout was invisible to
Tavli and to the restaurant alike.

#### Payments destination events (9)

```text
payment_intent.succeeded            payment_intent.payment_failed
payment_intent.canceled             charge.refunded
charge.dispute.created              charge.dispute.closed
charge.dispute.updated              charge.dispute.funds_reinstated
radar.early_fraud_warning.created
```

All four `charge.dispute.*` types are handled as of TAVLI-102 — `created`,
`updated`, `closed` and `funds_reinstated` all reach
`disputes.recordDisputeEventInternal`. `radar.early_fraud_warning.created` is
still unhandled; it is subscribed deliberately so the live destination never
needs editing again, and unhandled types fall through the switch and are
recorded for dedup only.

**Nothing needs enabling for TAVLI-102**: the four dispute types were already on
this destination before the ticket. If you are setting up a new deployment, the
`stripe webhook_endpoints create` command further down already lists them.

Do **not** subscribe `checkout.session.*` — Tavli uses an embedded
`PaymentElement`, never hosted Checkout. Three such subscriptions were pruned
from the dev destination as dead weight.

#### Connect destination events

All 15 `v2.core.account*` types are subscribed. **Four** change Tavli's state:

```text
v2.core.account[requirements].updated
v2.core.account[configuration.recipient].capability_status_updated
v2.core.account[configuration.merchant].capability_status_updated
v2.core.account.closed
```

The other 11 are recorded for replay dedup and logged at info level
(`ignored thin event type: …`). `handleThinEvent` names each one with the reason
it is ignored — read the switch there before promoting one. A type outside all
15 logs `unhandled thin event type: …` as a **warning**, which is the line to
grep for after Stripe adds an event.

Beware the near-miss pairs: you want
`[configuration.recipient].capability_status_updated` and
`[configuration.merchant].capability_status_updated`, **not** the
`[configuration.recipient].updated` / `[configuration.merchant].updated` pair.

**Why the merchant capability matters.** Every order, tip and tab
PaymentIntent is a destination charge created `on_behalf_of` the restaurant's
connected account, which makes that account the settlement merchant. Stripe
refuses the charge unless the account's `card_payments` capability (merchant
configuration) is active — `stripe_transfers` being active is not enough. So a
restaurant only reads as ready when **both** capabilities are active
(`inferV2AccountStatus`), and a `card_payments` restriction mid-service must
flip it to `restricted` through this event. Until 2026-09 the merchant event was
ignored on the (wrong) grounds that the connected account is never the merchant
of record.

> [!IMPORTANT]
> **Manual step owed — merchant capability event.** Open the existing Connect
> (thin) destination and confirm
> `v2.core.account[configuration.merchant].capability_status_updated` is in its
> event list; add it if it is not. Do this on **every** Connect destination:
>
> - the Stripe **test** account — both the **dev** and the **staging**
>   destinations (they share the account but not the destination);
> - the **production** account (`acct_1TGR3uAUMbq2vVG5`,
>   `tavli-prod-connect-accounts`).
>
> Without it the code still works on **Refresh** — `getAccountStatus` reads
> both capabilities every time the Payment Setup panel is opened — but a
> `card_payments` restriction that lands mid-service is only noticed when
> somebody opens that screen. Until then checkout keeps building intents that
> Stripe declines. No new secret is involved: it is the same destination and the
> same `STRIPE_CONNECT_WEBHOOK_SECRET`.

> A thin payload carries **no `data.object`** — only
> `{id, object: "v2.core.event", type, created, related_object: {id, type, url}}`.
> That is why `handleThinEvent` re-fetches the account through
> `inferV2AccountStatus` instead of reading the event body. The destination
> showing **"Sin versión"** for API version is expected: there is no embedded
> object to version.

#### Connected-accounts destination events (5)

```text
payout.created    payout.updated    payout.paid
payout.failed     payout.canceled
```

All five are handled. `payout.failed` is the one that does anything visible:
see §4c. Anything else delivered here logs
`unhandled connected-account event type: …` at info level and is recorded for
dedup only — subscribe nothing else unless a ticket asks for it.

> These are **snapshot** payloads with an extra `account` property naming the
> connected account. `handleConnectedAccountEvent` resolves the Restaurant from
> it through `restaurants.by_stripe_account`; there is no re-fetch, because
> unlike a thin event the payout object is right there in the body.

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
Q  stripeHelpers:getProcessedStripeWebhookEventInternal      success
M  stripeHelpers:recordStripeWebhookEvent                    success
A  stripe:fulfillPayment                                     success
H  POST /stripe/webhook                                      200
```

A `400` on the POST means signature verification failed — the secret is wrong. A
`500` means `STRIPE_WEBHOOK_SECRET` (or `STRIPE_SECRET_KEY`) is not set at all; see the 400-vs-500 triage
table under step 4b, which applies to both destinations.

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
   `ignored thin event type: …` are fine — reaching the handler at all proves
   `parseEventNotification` accepted the signature. A line reading
   `unhandled thin event type: …` is not: that is a type outside the 15, and
   somebody has to decide about it (see step 4b).
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

That is still the liability model after TAVLI-102 — Stripe always takes a lost
dispute out of the **platform** balance — but the loss is no longer permanent.
It opens a row in `disputeRecoveries`, and the restaurant's subsequent ORDER
payments repay it a capped percentage at a time (never tips, never tabs). See
["Lost disputes are recovered"](#lost-disputes-are-recovered).

### 4. Connected-account readiness

Before enabling payments for a restaurant:

- The connected account exists and onboarding is complete
- `stripe_transfers` (recipient configuration) **and** `card_payments`
  (merchant configuration) capabilities are both active — charges are made
  `on_behalf_of` the account, so transfers alone cannot take a payment
- The restaurant is active in Tavli

Test-mode connected-account ids are **invalid in live mode**, and ids created
under the dev Stripe account are unreachable with the production `sk_live`
entirely. Any restaurant onboarded in test must be onboarded again in live.

### 4b. Connected-account lifecycle — and the secret that was never set

> [!CAUTION]
> **`STRIPE_CONNECT_WEBHOOK_SECRET` has never been set on any deployment.**
> Until it is, `handleThinEvent` throws before it reads the payload, the route
> answers **500 `Stripe not configured`**, and every `v2.core.account*`
> event Stripe delivers is lost. The whole connected-account lifecycle —
> including account closure — is **dormant**. It must be set on **each**
> deployment separately: dev, staging and production each have their own Convex
> env and their own webhook destination (see "Two webhook destinations"). Dev
> and staging share one Stripe **test** account, but not one destination, and
> therefore not one secret.

```bash
# One per deployment. Run each against the deployment it names.
npx convex env set STRIPE_CONNECT_WEBHOOK_SECRET whsec_...            # dev
npx convex env set STRIPE_CONNECT_WEBHOOK_SECRET whsec_... --prod     # production
# staging: run it with that deployment selected (CONVEX_DEPLOYMENT / --url),
# NOT with --prod, or you will overwrite production's secret with staging's.
```

#### What a closure does (TAVLI-65)

`v2.core.account.closed` is Stripe saying the connected account is finished —
closed by the restaurant, or rejected/terminated by Stripe. On that event Tavli:

1. patches the Restaurant to `stripeOnboardingComplete: false` and
   `stripeAccountStatus: "closed"`;
2. **keeps** `stripeAccountId`, so the dead account is still lookupable in the
   Stripe Dashboard (the admin Reset is the thing that unlinks);
3. refuses every new PaymentIntent on that restaurant with
   `ERROR_RESTAURANT_NOT_ACCEPTING_PAYMENTS`, which the diner's checkout renders
   as "this restaurant is not accepting card payments right now" in their own
   language — instead of the opaque Stripe failure they used to get several
   seconds later;
4. raises a **severe** `account_closed` operator alert (one per account id —
   `dedupeKey`), which emails every platform admin;
5. shows the admin Payment Setup panel a "closed" state with the Reset control,
   not the "not set up" onboarding pitch.

`closed` is terminal for that account id: a later `[requirements].updated`, or
an admin hitting **Refresh**, cannot promote it back to active. The two ways out
are **Restablecer configuración de Stripe** (unlinks, freeing the restaurant to
onboard a new account) and onboarding a new account outright.

A closure for an account id no restaurant in this deployment claims still raises
the alert, with no restaurant attached. Dev and staging share one Stripe test
account, so that is usually the other environment's account — but it can also be
a restaurant whose link was cleared while Stripe was still delivering, which is
the case that would otherwise be invisible.

#### Verifying the thin-event path in test mode

Do this once per deployment, after setting the secret, **in test mode only**.

There is no `stripe trigger` for this: `trigger` fires v1 snapshot events only
(`stripe trigger --help` lists them — no `v2.*` type appears). The way to
produce a real `v2.core.account.closed` is to actually close a connected
account, which Tavli's own admin Reset does for you.

**1. Prove the pipe answers at all.**

```bash
curl -i -X POST https://<slug>.convex.site/stripe/connect-webhook
# 400 "Missing stripe-signature header"  → route is live
# 404                                    → wrong host (.convex.cloud, not .convex.site)
```

**2. Drive a genuine closure.** Sign in as an admin on the deployment under
test and, on a **throwaway** restaurant:

1. Click **Iniciar configuración para cobrar pagos**. `createConnectAccount`
   creates a V2 connected account and several `v2.core.account*` events land on
   the destination immediately — enough on its own to prove the signature is
   accepted.
2. **Stop at the Stripe onboarding screen — do not complete it.** It collects
   real KYC even in test mode.
3. Click **Restablecer configuración de Stripe**. `resetStripeConnection` calls
   `v2.core.accounts.close`, which fires a genuine `v2.core.account.closed` at
   the destination.

**3. Read the deployment logs.** For the closure:

```text
H  POST /stripe/connect-webhook                             200
A  stripe:handleThinEvent                                   success
Q  stripeHelpers:getProcessedStripeWebhookEventInternal      success
M  stripeHelpers:markStripeAccountClosedByAccountId          success
M  operatorAlerts:raiseOperatorAlertInternal                 success
M  stripeHelpers:recordStripeWebhookEvent                    success
```

Reset clears the Convex link **before** the closure arrives, so no restaurant
claims the account id: the alert lands on `/admin/alerts` with no restaurant
attached. That is correct, and it is the unclaimed case described above.
Acknowledge it to clear it.

**4. Prove the replay dedup.** Workbench → **Events** → find the
`v2.core.account.closed` you just caused → **Resend** (available for events
under 15 days old). Resend re-delivers **the same event under the same event
id**, which is exactly what makes it a proof: the second POST finds that id
already in `stripeWebhookEvents` via `getProcessedStripeWebhookEventInternal`
and returns before the switch runs at all. So it must still answer **200** while
writing nothing: still one `stripeWebhookEvents` row, still one open alert. This
is what stops Stripe's redeliveries from emailing every platform admin
repeatedly.

#### Triage: 400 vs 500 on this route

The two failures are opposite diagnoses and the status code now says which:

| Response                                  | Means                                                                                | Fix                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| **500** `Stripe not configured`           | `STRIPE_CONNECT_WEBHOOK_SECRET` (or `STRIPE_SECRET_KEY`) is unset on this deployment | Set it (above). Nothing about the delivery is wrong.             |
| **400** `Webhook handler failed`          | The delivery failed verification                                                     | Wrong secret, or the **other** destination's secret. Re-copy it. |
| **400** `Missing stripe-signature header` | Not from Stripe                                                                      | Something else is POSTing at the route.                          |

Tell them apart from the Convex side by the **log line**, not the status alone:
a missing secret or API key logs `STRIPE_NOT_CONFIGURED` in the
`[http.stripe/connect-webhook]` entry, naming the exact variable, while a verification failure logs
`operation: "parseEventNotification"` from `[stripe.handleThinEvent]`. The same
distinction applies to `POST /stripe/webhook`.

#### Local development against thin events

```bash
stripe listen --thin-events 'v2.core.account*' \
  --forward-thin-to https://<dev-slug>.convex.site/stripe/connect-webhook
```

The listen session mints **its own** signing secret and prints it; that is the
value `STRIPE_CONNECT_WEBHOOK_SECRET` must hold while the session runs, and it
rotates every session. A registered destination is preferable for anything but
a debugging session, precisely because its secret is stable.

### 4c. Payouts — and the money a restaurant cannot see (TAVLI-103)

> [!CAUTION]
> **`STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET` has never been set on any
> deployment, and the connected-accounts destination does not exist yet.**
> Until both exist, `handleConnectedAccountEvent` throws before it reads the
> payload, the route answers **500 `Stripe not configured`**, and every
> `payout.*` event is lost. The whole feature — the payouts page, the held
> total, the manager notification and email, the operator alert — is
> **dormant**. Set the secret on **each** deployment separately: dev, staging
> and production each have their own Convex env and their own destination. Dev
> and staging share one Stripe **test** account, but not one destination, and
> therefore not one secret.

```bash
# One per deployment. Run each against the deployment it names.
npx convex env set STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET whsec_...            # dev
npx convex env set STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET whsec_... --prod     # production
# staging: run it with that deployment selected (CONVEX_DEPLOYMENT / --url),
# NOT with --prod, or you will overwrite production's secret with staging's.
```

#### What a failed payout does

Stripe pays a connected account's balance to the restaurant's bank on a
schedule. A payout can fail — wrong CLABE, closed account, lapsed
verification, a restricted account — and Stripe then usually **pauses the
schedule**. The money is **not lost**: it stays in the connected account's
balance. On `payout.failed` Tavli:

1. upserts the row in `stripePayouts` (one per Stripe payout id);
2. adds the amount to that restaurant's **held total** (below);
3. writes one notification per manager-or-above (bell + `href` to
   `/admin/payouts`), `dedupeKey: payout_failed:<payoutId>`;
4. schedules one email per recipient with an address — the same set, so the
   bell and the inbox cannot drift;
5. raises a **severe** `payout_failed` operator alert (same `dedupeKey`), which
   emails every platform admin.

Routine payouts — created, in transit, arrived while nothing was stuck — write
the row and tell nobody. The side effects fire on the **transition into**
`failed`, not on the event, so a following `payout.updated` that still says
`failed` refreshes the failure detail without ringing anybody's bell twice.

#### The held total, and why it is not a running sum

**Stripe never retries a failed payout** — the schedule simply runs again. And
because Tavli never creates a manual payout, every automatic payout sweeps the
**whole available balance**, which already contains whatever bounced last time.
Both halves of the rule follow from that:

- A **later `failed`** payout supersedes an earlier one. A 1,000 that bounces on
  Monday is inside Tuesday's 1,200 sweep (the same 1,000 plus 200 of new sales),
  so the held total is 1,200 — not 2,200. Adding them up would report money as
  stuck twice.
- A **later `paid`** payout resolves every earlier failure, **whatever its
  amount**. An "at least as large" test looks safe and is not: a refund or a
  lost dispute can shrink the balance between the failure and the recovery, and
  Stripe can settle a balance across two smaller payouts. In both cases the
  money left — while the amount test would hold it on the page forever and,
  worse, never send the `payouts_resumed` notification that tells the restaurant
  it is over.
- A **`canceled`** payout supersedes nothing: it never attempted the bank, so
  the stuck money is exactly where it was. `pending` and `in_transit` say
  nothing yet.

So the held total is the newest failure, or zero. When a `paid` payout takes it
to zero the managers get a `payouts_resumed` notification and email.
`payouts_enabled` going true again is deliberately **not** the signal: Stripe
re-enables on verification, not on a successful transfer, so it would tell a
restaurant their money had moved when it had not.

A payout event for an account **no restaurant in this deployment claims** is
logged and recorded but raises nothing — dev and staging share one Stripe test
account, so that is routine noise. The exception is a `payout.failed`, which
raises a **warning**-level alert (not severe, which would email every platform
admin) carrying the _account_ id, because it can also be a restaurant whose link
was cleared while Stripe was still delivering.

#### Verifying the payout path in test mode

Do this once per deployment, after creating the destination and setting the
secret, **in test mode only**.

`stripe trigger` fires v1 snapshot events, so some of this family is reachable
from the CLI — but **`payout.failed` is not one of them.** The supported payout
triggers are exactly `payout.created` and `payout.updated` (confirm for your CLI
version with `stripe trigger --help`, or on
<https://docs.stripe.com/cli/trigger>). Producing a genuine failure means
producing a genuine payout that a bank refuses, which is step 3.

**1. Prove the pipe answers at all.**

```bash
curl -i -X POST https://<slug>.convex.site/stripe/connected-webhook
# 400 "Missing stripe-signature header"  → route is live
# 500 "Stripe not configured"            → the route is live but the secret is unset
# 404                                    → wrong host (.convex.cloud, not .convex.site)
```

(The 400 comes before any secret is read, so it is the answer even on a
deployment where the secret is missing. Send a body with a bogus signature to
see the 500.)

**2. Prove the scope, the signature and `event.account` — with a trigger.**
`--stripe-account` is a real flag on `trigger`; it sets the
`Stripe-Account` header, so the CLI creates the object **on that connected
account** and the resulting event carries `account: acct_…` and is delivered to
the connected-accounts destination. That is exactly what this step proves:

```bash
stripe trigger payout.updated --stripe-account acct_<a test restaurant's account>
```

Without `--stripe-account` the event fires on the platform account, lands on the
_payments_ destination, and proves nothing about this path. Expect a 200, a
`stripePayouts` row for that restaurant, and **no** notification and **no**
alert — `payout.updated` with a non-failed status is a routine payout.

**3. Produce a real `payout.failed`.** Attach one of Stripe's failing test bank
accounts to the test connected account, then create a payout on it. The test
account number decides the `failure_code`
(<https://docs.stripe.com/connect/testing>); for **MX**, CLABE-shaped account
numbers with no separate routing number:

| Test account number  | Result                 |
| -------------------- | ---------------------- |
| `000000001234567897` | payout succeeds        |
| `000000111111111117` | `no_account`           |
| `000000111111111133` | `account_closed`       |
| `000000222222222224` | `insufficient_funds`   |
| `000000333333333331` | `debit_not_authorized` |
| `000000444444444448` | `invalid_currency`     |

(The US equivalents are routing `110000000` with account `000111111113` →
`account_closed` and `000111111116` → `no_account`. Check the page above for
other countries, and for the codes Tavli maps that these fixtures do not
produce — those are exercised in `convex/payoutHelpers.test.ts`, not here.)

Two prerequisites, in this order — `stripe payouts create` on its own will not
fail the way you want, or will not succeed at all:

**(a) Add the failing CLABE and make it the default.** The connected account
pays out to its **default** external account for that currency, which after
onboarding is a _working_ one. Posting a new bank account without
`default_for_currency` only **adds a second one**, and `stripe payouts create`
would still pay to the old default — the payout succeeds and you learn nothing.
Set it in the test-mode Dashboard (connected account → payout details), or from
the CLI:

```bash
stripe post /v1/accounts/acct_<a test restaurant's account>/external_accounts \
  -d 'external_account[object]=bank_account' \
  -d 'external_account[country]=MX' \
  -d 'external_account[currency]=mxn' \
  -d 'external_account[account_number]=<a failing CLABE from the table above>' \
  -d default_for_currency=true
```

The alternative, if you would rather not move the default: keep the response's
`ba_…` id and pass it to the payout as `--destination ba_…`.

**(b) Give the account a balance to pay out.** A fresh test connected account
has none, and a payout larger than the available balance is rejected outright
rather than failing at the bank.

Prefer a **test destination charge** through the diner flow: it is the more
faithful rehearsal, and it lands the money on the connected account the same way
real takings do. Funding it directly works too, but `stripe transfers create`
spends the **platform** test account's _available_ MXN balance, which is usually
empty — a card charge normally settles as _pending_ first:

```bash
# Test card 4000000000000077 bypasses the pending period, so the platform
# balance is available immediately and the transfer below can draw on it.
stripe transfers create --amount 1000 --currency mxn \
  --destination acct_<a test restaurant's account>
```

**Then create the payout:**

```bash
stripe payouts create --amount 1000 --currency mxn \
  --stripe-account acct_<a test restaurant's account>
```

Expect `payout.created` first and `payout.failed` shortly after creation. The
delay is not documented and is not worth guessing at — ask Stripe instead:

```bash
stripe payouts retrieve po_... --stripe-account acct_<a test restaurant's account>
# status: pending → failed, and `failure_code` once it is there
```

Two alternatives when the CLI is awkward: drive it through
`stripe listen --forward-connect-to` (below), or use the destination's own page
in the **Workbench → Send test event**, which lets you pick `payout.failed` and
edit the payload — good for proving the handler and the copy, though it does not
prove a real bank refusal.

**4. Read the deployment logs.** For a failure on a claimed account, with the
`module:function` prefix Convex prints:

```text
H  POST /stripe/connected-webhook                            200
A  stripe:handleConnectedAccountEvent                        success
Q  stripeHelpers:getProcessedStripeWebhookEventInternal      success
Q  stripeHelpers:getRestaurantByStripeAccountIdInternal      success
M  payouts:recordPayoutEventInternal                         success
M  stripeHelpers:recordStripeWebhookEvent                    success
A  payoutActions:sendPayoutEmail                             success
A  payoutActions:sendPayoutEmail                             success
```

One `payoutActions:sendPayoutEmail` per recipient, scheduled rather than awaited
— they appear after the action that caused them has already returned, and a
failing one logs `[payoutActions] Resend error` without failing anything else.
With `RESEND_API_KEY` unset they still run and log
`RESEND_API_KEY or RESEND_FROM_ADDRESS missing; skipping payout email.`

The outcome line worth reading is logged by the handler,
`[stripe.handleConnectedAccountEvent]`, from what
`payouts:recordPayoutEventInternal` returned:

```text
[stripe.handleConnectedAccountEvent] payout.failed {"stripePayoutId":"po_…","status":"failed",
 "action":"inserted","becameFailed":true,"supersededOnArrival":false,"payoutsResumed":false,
 "heldCents":123456,"notified":2,"emailsScheduled":2}
```

`notified: 0` means the restaurant has nobody eligible — real, not an error; the
operator alert is what makes sure a human at Tavli still sees it.
`supersededOnArrival: true` means the failure was delivered _after_ the payout
that had already resolved it, so the row was recorded but nobody was told —
there was no longer any stuck money to tell them about. For an
unclaimed account the line is
`[stripe.handleConnectedAccountEvent] no restaurant claims this connected account`,
and the only mutation is `operatorAlerts:raiseOperatorAlertInternal`.

**5. See it in the app.** Sign in as that restaurant's owner: `/admin/payouts`
shows the held total above the list, and `/admin/payments` carries the banner.
`/admin/alerts` has one open `payout_failed` row. Acknowledge it to clear it.

**6. Prove the replay dedup, then supersession.** Workbench → **Events** → find
the `payout.failed` you just caused → **Resend**. The same event id must answer
**200** while writing nothing: still one `stripePayouts` row, still one open
alert, still two notifications.

Then cause a **second, different** failure on the same account. The held total
must become that newest failure's amount — **not the sum of the two**. The
second sweep took the whole available balance, which already contained the first
failure's money, so adding them up would report the same money as stuck twice.
That is supersession, and it is a different mechanism from event dedup: two
distinct events, both recorded, both announced, one held total.

#### Triage: 400 vs 500 on this route

Identical to §4b: **500** `Stripe not configured` means
`STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET` (or `STRIPE_SECRET_KEY`) is unset on
this deployment — nothing about the delivery is wrong. **400** `Webhook handler
failed` means the delivery failed verification, most often the _other_
destination's secret pasted here. Tell them apart from the Convex side by the
log line, not the status: a missing secret or API key logs
`STRIPE_NOT_CONFIGURED` in the `[http.stripe/connected-webhook]` entry, naming
the exact variable, while a verification failure logs
`operation: "constructEvent"` from `[stripe.handleConnectedAccountEvent]`.

#### Local development against payout events

```bash
stripe listen --forward-connect-to https://<dev-slug>.convex.site/stripe/connected-webhook
```

`--forward-connect-to` is the connected-account counterpart of `--forward-to`:
it forwards only events that carry an `account`. Use both flags in one session
to drive the payments and connected destinations at once. The session mints
**its own** signing secret and prints it; that is the value
`STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET` must hold while it runs, and it
rotates every session. A registered destination is preferable for anything but a
debugging session, precisely because its secret is stable.

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
(`convex/stripe.ts`). Stripe takes the money from Tavli, not from the
restaurant — and the restaurant keeps the transfer it already received.

### Lost disputes are recovered

Since TAVLI-102 that loss is written down rather than absorbed silently
(`convex/disputes.ts`, `convex/disputeRecoveryHelpers.ts`).

- A lost dispute opens **one** `disputeRecoveries` row for the **disputed amount
  only**. Stripe's dispute fee is not in it: Tavli absorbs the fee deliberately
  (a restaurant cannot influence it), and it is recorded on the `stripeDisputes`
  row plus the per-month `disputeFeesByMonth` aggregate instead.
- Every subsequent **order** payment for that restaurant adds the deduction to
  its `application_fee_amount` (`serviceFee + deduction`), so Stripe transfers
  `restaurantShare − deduction`. The deduction is
  `min(totalOutstanding, floor(foodSubtotal × disputeRecoveryPercent / 100))`.
  The intent never carries `transfer_data.amount`: Stripe treats it as an
  alternative to `application_fee_amount`, and sending both is rejected or
  takes the fee twice.
  Tips are outside the base, so the whole gratuity always reaches the
  restaurant. Tip charges and tab charges are never deducted from.
- **The diner's charge never changes**, and the order still reports full
  revenue. The recovery is its own line in the payments export
  (`dispute recovery withheld` / `settled to restaurant`), so a settlement
  figure that differs from a sales figure differs visibly.
- `restaurants.disputeRecoveryPercent` is **0 by default**, which means no
  deduction at all. A platform admin sets it in the Stripe block of the admin
  restaurants page; the mutation refuses anything but a whole 0–50.
- The ledger is drawn down when the payment **settles**, oldest loss first. A
  failed or superseded intent moved no money, so the debt stands.
- A dispute later won — or a `charge.dispute.funds_reinstated` — zeroes the row
  and returns anything already recovered to the connected account, with
  idempotency key `dispute-recovery-return:<disputeId>`.
- After **180 days** an outstanding row is written off by the daily
  `dispute recovery write-off sweep` cron: `status: "written_off"`, an audit
  event, and an **info** operator alert. The row keeps its `outstanding` figure
  so what was never recovered stays answerable; `status` is what stops it
  deducting.

Evidence submission is **out of scope** — Tavli does not upload dispute
evidence, and none of the manager-facing copy asks for any.

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
>
> **This is now detected (TAVLI-102).** `handleChargeRefunded` fetches the
> refund on every `charge.refunded` and, when it carries no `transfer_reversal`,
> raises a **severe** operator alert (`dashboard_refund`, deduped per refund id,
> carrying the payment and restaurant). No ledger entry is created: unlike a
> chargeback, this is an action a Tavli operator took, and the right response is
> a human looking at what they did rather than the next diner's order quietly
> paying for it.

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
  --enabled-events charge.dispute.updated \
  --enabled-events charge.dispute.closed \
  --enabled-events charge.dispute.funds_reinstated
npx convex env set STRIPE_WEBHOOK_SECRET whsec_...
```

Or `stripe listen --forward-to https://<dev-slug>.convex.site/stripe/webhook`
for raw-payload debugging; its secret rotates per session.

### Smoke-test the pipe

```bash
curl -i -X POST https://<slug>.convex.site/stripe/webhook
curl -i -X POST https://<slug>.convex.site/stripe/connect-webhook
curl -i -X POST https://<slug>.convex.site/stripe/connected-webhook
# Expect 400 "Missing stripe-signature header" from each.
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

Decide a dispute by **submitting evidence** — that is what makes test mode
produce a real `won` or `lost`:

```bash
# WINS: closed (status won), then charge.dispute.funds_reinstated
curl -s -X POST "https://api.stripe.com/v1/disputes/du_.../" -u "$STRIPE_SECRET_KEY:" \
  -d "evidence[uncategorized_text]=winning_evidence" -d submit=true

# LOSES: closed (status lost) — the case the recovery ledger exists for
curl -s -X POST "https://api.stripe.com/v1/disputes/du_.../" -u "$STRIPE_SECRET_KEY:" \
  -d "evidence[uncategorized_text]=losing_evidence" -d submit=true
```

> [!WARNING]
> Do **not** use `POST /v1/disputes/du_.../close` to exercise the happy path. It
> means "give up", and Stripe closes the dispute as **lost** — so a test meant
> to prove the win path silently exercises the loss path and opens a recovery
> ledger row.
>
> `stripe trigger charge.dispute.created` is also not a substitute: its dispute
> belongs to no PaymentIntent of ours, so it only ever proves the **unlinked**
> path (the row is written, the operator alert is raised, and no ledger row or
> manager notification follows because no restaurant claims the charge). Use
> `pm_card_createDispute` for anything that has to touch the ledger.

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
  with `openedAt`, that the restaurant's managers get a bell notification **and**
  an email (`dispute_opened`), and that no ledger row exists yet
- Close the dispute; confirm the **same row** is updated with `closedAt` and the
  new status — not a second row
- On a **lost** close, confirm all four of: one `disputeRecoveries` row for the
  disputed amount (not the fee), a **severe** `dispute_lost` operator alert, a
  `dispute_lost` notification whose body matches whether the restaurant's
  `disputeRecoveryPercent` is 0, and the disputes card on `/admin/payments`
- Redeliver the same close from the Dashboard and confirm nothing doubles: one
  ledger row, one alert, one bell row per manager
- With `disputeRecoveryPercent` set, place a new order and confirm the
  PaymentIntent's `application_fee_amount` is the service fee **plus** the
  deduction (and it has no `transfer_data.amount`), so the transfer to the
  connected account is short by the deduction while `amount` is unchanged;
  then confirm the ledger only moves once the charge **settles**
- Reinstate the funds by submitting `winning_evidence` on a dispute that was
  lost in test mode (Stripe reopens it, closes it as won, and
  `charge.dispute.funds_reinstated` follows). Confirm the row goes to
  `reinstated` with `outstanding: 0`, and that exactly one `transfers.create`
  fires for whatever had been recovered. Do **not** use
  `POST /v1/disputes/du_.../close` — it means "give up" and closes as lost
- Confirm refunding a disputed charge returns `ERROR_PAYMENT_UNDER_DISPUTE`
  rather than Stripe's `charge_disputed`, and leaves the payment and the order
  untouched
- Write-off: the sweep is daily and the window is 180 days, so verify it by
  back-dating a row's `lostAt` in the Convex dashboard and running
  `disputes.sweepDisputeWriteOffs` — expect `status: "written_off"` and an
  **info** alert

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
- Convex logs for `CHARGE DISPUTE` — disputes hit the platform balance, and are
  then recovered from the restaurant's later orders (TAVLI-102)
- `/admin/alerts` for `dispute_lost` (severe) and `dashboard_refund` (severe);
  a written-off recovery shows up there as **info**
- `disputeRecoveries` rows stuck at `outstanding` on a restaurant whose
  `disputeRecoveryPercent` is 0 — expected, and they age out after 180 days
- Convex logs for `[stripe.handleConnectedAccountEvent]` — one line per
  `payout.*`, carrying the held total after the write
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
- The stuck-payment reconciliation cron (`stripe:reconcileStuckPayments`) runs
  every 5 minutes beside it and covers the other two kinds — **order** and
  **tip** payments — which until TAVLI-106 had no backstop at all: a dropped
  `payment_intent.succeeded` left a diner who really paid with a round nobody
  was cooking, or a tip charged and never credited, permanently. It reads
  `payments` rows left in `processing` and untouched for longer than their
  kind's minimum, pulls each PaymentIntent from Stripe and acts on what it
  finds:

  | Kind                                | Swept after | Alerts after |
  | ----------------------------------- | ----------- | ------------ |
  | `order` (and legacy pre-pivot rows) | 5 min       | 15 min       |
  | `tip`                               | 30 min      | 120 min      |

  Tips get far more rope on purpose: nobody is waiting at a table for one.
  "Untouched" is `updatedAt`, which every patch bumps, so the trigger is "this
  row stopped moving"; the alert thresholds use the row's true age from
  `createdAt`, so a late status-preserving write cannot buy a stuck payment
  another quarter of an hour of silence. Legacy tab rows (no `kind`, a
  `sessionId`) are excluded — the tab sweep above owns those, because settling
  one must also unlock the session.

  What each branch does:
  - **`succeeded`** → settles through `handlePaymentIntentSuccess`, the very
    same handler the webhook calls, amount assertion and accept-or-refund
    policies included. A mismatched amount therefore fails the row and raises
    `payment_amount_mismatch` exactly once — the sweep adds no alert of its own
    on top
  - **`canceled`** → terminally dead at Stripe. The row is retired at once
  - **`requires_payment_method` / `requires_action` / `requires_confirmation`**
    (waiting on the **customer**) → left alone until the kind's alert age, then
    treated as an abandoned checkout: the intent is cancelled at Stripe FIRST,
    then the row is retired. The wait matters — a row is `processing` from the
    moment its intent is created, so a diner still typing their card at minute
    six is not abandoned. The clear matters more: without it a served, cash-owed
    round is locked out of "mark paid in person" with
    `ERROR_ORDER_PAYMENT_IN_FLIGHT` and no staff-side release, and an abandoned
    3DS intent never expires at Stripe, so alerting instead would mean a
    permanent alert about a permanent row. A tip is simply failed, so the diner
    can tip again

    How the row is retired depends on where the order has got to. While it is
    still `draft` or `awaiting_payment` the attempt is **cancelled and the
    order's payment pointer cleared**, exactly as the diner's own "back to menu"
    does. Once the round has been released to the kitchen — the served,
    cash-owed case — the pointer is left where a real card decline would have
    left it and the row is simply **failed in place**, which is all
    "mark paid in person" needs: it refuses a PENDING or PROCESSING attempt, not
    a terminal one

  - **`processing` / `requires_capture`** (waiting on **Stripe**) → genuinely
    mid-flight, and not ours to cancel. Left alone until the kind's alert age,
    then escalated
  - **anything unrecognised** → escalated straight away; waiting does not
    resolve a status this code has never seen

  A diner whose attempt was retired under them sees "This payment session
  expired. Start the payment again — you have not been charged." if they come
  back to a stale sheet and confirm, rather than Stripe's English
  `payment_intent_unexpected_state` text.

- Stuck-payment alerts are `payment_stuck`, deduped per payment
  (`payment_stuck:<paymentId>`), so a payment wedged for a day is **one** alert,
  not 288 — and, uniquely so far, the dedupe spans **acknowledged** rows as well
  as open ones (`dedupeAcrossAcknowledged`). It has to: the sweep re-reads the
  same wedged row every five minutes, and with the ordinary open-only scope,
  acknowledging the alert would make the next run raise a fresh one and mail
  every platform admin again. Acknowledge it and it stays gone; the key names
  one payment, so there is no second, genuinely-new occurrence to lose. Severe
  (and therefore emailed to every platform admin) only for an **order** past its
  alert age — a diner is sitting at a table with a
  charge in limbo and a kitchen that was never released. Stuck tips and
  unrecognised statuses are warnings on `/admin/alerts`. Look for
  `[stripe.reconcileStuckPayments]` in the Convex logs for the same facts

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

| Symptom                                         | Cause → fix                                                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Webhook route returns 404                       | Using `.convex.cloud`. Use `.convex.site`.                                                                                               |
| Webhook returns 400 on real deliveries          | Signing-secret mismatch, or the two `whsec_` values swapped between destinations. Compare fingerprints.                                  |
| Live charges succeed but never settle in the DB | Same as above — the customer is charged and the order stays unpaid. This is the failure §3's verification exists to catch.               |
| "Development mode" badge on prod                | Bundle built with `pk_test`. Set `pk_live` in Infisical `prod` and **rebuild** — a restart is not enough.                                |
| Thin events never arrive                        | Destination scope set to _Cuentas conectadas_, or payload style _Resumen_ instead of _Breve_.                                            |
| `payout.*` events never arrive                  | Connected-accounts destination scoped to _Tu cuenta_ (a restaurant's payout is never a platform event), or not created.                  |
| Payouts page empty, restaurant says it is owed  | The destination or `STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET` is missing — the feature is dormant, not broken. See §4c.                   |
| A `payout_failed` alert with no restaurant      | Unclaimed connected account: usually the other environment's, occasionally a restaurant whose link was cleared. Warning-level by design. |
| `stripeRefundId` never populated                | The `refunds.list` fallback was removed. `charge.refunded` carries no refunds list.                                                      |
| Restaurant keeps its payout after a refund      | Refund issued from the dashboard without ticking "Reverse the transfer".                                                                 |
| Everything looks configured but charges fail    | Keys mixed between the dev and production Stripe accounts. Check the `_51…` account fingerprint.                                         |

## References

- [`deployment-and-secrets.md`](../internal-guides/deployment-and-secrets.md) — the env/secrets model
- `convex/stripe.ts` — actions, webhook handlers, refunds
- `convex/stripeHelpers.ts` — payment persistence
- `convex/disputes.ts` — dispute persistence, the recovery ledger, the
  notifications and the write-off sweep
- `convex/disputeRecoveryHelpers.ts` — the deduction and draw-down arithmetic
- `convex/disputeAggregates.ts` — per-month platform dispute fees, per-restaurant
  opened/lost/won/recovered
- `convex/stripeWebhookHelpers.ts` — pure event → state logic
- `convex/payouts.ts` / `convex/payoutHelpers.ts` — payout persistence, the held total, who gets told
- `convex/_util/env.ts` — the three webhook-secret env vars in one table
- `convex/http.ts` — the three webhook routes
