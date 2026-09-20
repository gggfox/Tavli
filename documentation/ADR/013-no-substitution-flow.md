# ADR-013: No Substitution Flow — Out-of-Stock on a Paid Order Is Refunded, Not Renegotiated

## Metadata

| Field             | Value      |
| ----------------- | ---------- |
| **Status**        | Accepted   |
| **Date**          | 2026-09-20 |
| **Author(s)**     | Tavli team |
| **Supersedes**    | —          |
| **Superseded by** | —          |

## Context

[ADR-008](./008-customer-borne-commission-and-pay-at-submit.md) introduced a
substitution flow for the case it named as having "no home at all": the kitchen
cannot make a line the diner has already paid for. Staff proposed an
equal-or-higher-priced replacement, the diner answered on their own device, and
the money followed — a supplemental PaymentIntent for the price difference plus
the service fee on it when they accepted, a per-line refund when they declined.

Shipping it cost far more than the event it modelled:

- **A second money path.** Each accepted proposal charged its own
  PaymentIntent, so a `payments` row gained a `kind: "substitution"` vintage,
  a `substitutionProposalId`, and its own place in the webhook kind dispatch.
- **Every refund became a two-payment refund.** Removing a substituted line had
  to split its value between the order payment and each delta charge, with
  distinct idempotency keys per leg, a half-failure retry path that reconstructed
  the line's combined refund from both payments' records, and a whole-order
  cancel that swept every accepted delta separately or left the diner out of
  pocket.
- **Every money aggregate had to fold it back in.** The payments ledger read
  each order's delta charges to avoid reporting full food value against a
  submit-time fee that no longer covered it.
- **An out-of-band conversation modelled in software.** A server standing at the
  table saying "we're out of the horchata, want the jamaica instead?" settles
  this in seconds. The flow replaced that with a modal on the diner's phone, a
  card charge for the difference, and a 3DS fallback when the bank challenged it.

No restaurant has used it in production — there are no real users yet — so
nothing is owed to existing data.

## Decision

**The substitution proposal flow is removed outright.** When a dish is
unavailable after payment, staff **remove the line from the order** and the
diner's money comes back automatically. Anything the restaurant wants to offer
instead — another dish, a drink on the house — is settled with the diner **in
person**, the way it already is for everything else that happens at a table.

The two plain refunds stay exactly as they were:

- **Whole-order cancel** (`stripe.cancelOrderAndRefund`) — the order payment's
  entire remaining balance, fee included.
- **Line removal** (`orders.cancelOrderItem` → `stripe.refundOrderItem`) — the
  line's price plus its share of the Tavli service fee, clamped to the payment's
  remaining balance; when the removed line is the order's **last live line**, the
  payment's whole remainder, which keeps a fully-emptied order's refunds summing
  to exactly the charge.

Removal is total: `convex/substitutions.ts`, the `substitutionProposals` table,
`PAYMENT_KIND.substitution`, the delta PaymentIntent action and its webhook
branches, the kitchen propose/withdraw affordances, and the diner prompt are all
deleted. There is **no migration and no dormant compatibility layer** — a
dormant second money path is the cost this ADR exists to stop paying.

On the diner's own order view, a removed line does **not** vanish: it stays
listed, struck through, marked unavailable **and** refunded, and the paid-order
breakdown carries the refund as its own line beneath the amount charged. The
diner paid for that dish; they get to see what became of it and that the money
came back, without having to reconcile a total that silently shrank.

## Consequences

### Positive

- One money path per order again: a `payments` row is a pay-at-submit charge or
  a tip, and a refund concerns exactly one charge.
- Refund arithmetic collapses to `computeLineRefundAmount` and
  `computeOrderRefundAmount` — no cross-payment split, no per-leg idempotency
  keys, no partial-failure reconstruction.
- Money aggregates read the order payment and stop: the payments ledger,
  analytics, and exports no longer fold delta charges back in.
- One fewer surface that can take a diner's money: there is no post-payment
  upcharge in the product at all.

### Negative

- A restaurant that would have upsold a pricier replacement now cannot collect
  the difference through Tavli. It collects it at the table or absorbs it.
- The diner learns their dish is unavailable from a member of staff rather than
  from a push on their phone. For a diner sitting in the restaurant this is
  arguably better; for one waiting on a long ticket it is a real loss of
  immediacy.
- Out-of-stock on a paid order is now visible only as a refund. There is no
  record of what was offered instead, because that conversation does not happen
  in the product.

### Neutral

- ADR-008's substitution section is superseded by this ADR; the rest of it —
  customer-borne commission, pay-at-submit, per-member tips, the per-line refund
  math — stands unchanged.
- The saved card that `setup_future_usage: "off_session"` persists remains, with
  the post-visit tip as its only one-tap consumer.
- Terminology: **remove a line from an order** is the term for staff taking one
  item off a placed order (see `CONTEXT.md`). The kitchen slang for it is not
  used in this codebase.

## Alternatives Considered

### Option 1: Keep the flow, make it optional per restaurant

A flag gating whether staff see the propose affordance.

**Pros:**

- Restaurants that want it keep it.

**Cons:**

- Every cost above is a cost of the code existing, not of it being used: the
  second payment vintage, the two-payment refunds, and the aggregate folding all
  stay, and now each has an on and an off path to test.

**Why not chosen:** A flag does not delete the branch — it doubles it.

### Option 2: Keep the table and mutations, hide the UI

Leave the backend dormant behind an unreachable frontend.

**Pros:**

- Reinstating it later is a UI change.

**Cons:**

- Dormant code is unexercised code. The refund paths it touches move real money,
  and a dormant branch in a money path is a latent production bug that nobody is
  reading tests for.

**Why not chosen:** There are no users to migrate, so there is nothing to be
careful about. Reinstating it later from git history costs less than carrying it.

### Option 3: Substitution as refund-and-reorder

Remove the line, refund it, and let the diner reorder the replacement through
the normal ordering flow.

**Pros:**

- No new money path: an ordinary refund plus an ordinary new order.

**Cons:**

- Two card round-trips and a re-navigation for what is one substitution.

**Why not chosen:** This is very nearly what now happens, minus the reorder
nudge — which is the part staff do better in person. ADR-008 rejected this
option on the grounds that the substitution _is_ the common kitchen event and
deserved first-class modelling; the correction here is that being common does not
make it software's job when a server is already standing at the table.

## Implementation

Deleted: `convex/substitutions.ts`, `convex/_tests/substitutions.test.ts`, the
`substitutionProposals` table and its indexes, `SUBSTITUTION_PROPOSAL_STATUS`,
the four `substitutions.*` audit events, `PAYMENT_KIND.substitution`,
`payments.substitutionProposalId`, `stripe.createSubstitutionPaymentIntent`,
`computeLineRefundPreview`, `computeSupplementalSweepAmount`, the
`supplementalRefunds` / `paymentAmountPortion` arguments on both refund-outcome
mutations, the `substitution-payment:` idempotency key,
`SubstitutionProposalDialog`, `SubstitutionPrompt`, and their i18n keys in both
locales.

Moved: `getSavedCardForSessionMemberInternal` from `convex/substitutions.ts` to
`convex/payments.ts` — the post-visit tip charge is its remaining caller.

Kept and still tested: `stripe.cancelOrderAndRefund`, `stripe.refundOrderItem`,
`orderItemCancellation.executeOrderItemCancellation`, `computeLineRefundAmount`,
`computeOrderRefundAmount`.

## References

- [ADR-008: Customer-borne commission and pay-at-submit orders](./008-customer-borne-commission-and-pay-at-submit.md) — the superseded substitution section
- [ADR-007: Station tickets and item-level cancellation](./007-station-tickets-and-item-cancellation.md) — line removal while the order is unpaid
- [`CONTEXT.md`](../../CONTEXT.md) — glossary: **Remove a line from an order**
- [`documentation/runbooks/stripe-go-live.md`](../runbooks/stripe-go-live.md) — per-line refund math and the residue it retires

---

## Change Log

| Date       | Author     | Description     |
| ---------- | ---------- | --------------- |
| 2026-09-20 | Tavli team | Initial version |
