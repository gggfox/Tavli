# ADR-008: Customer-borne commission and pay-at-submit orders

## Metadata

| Field             | Value                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------- |
| **Status**        | Accepted                                                                                 |
| **Date**          | 2026-08-07                                                                               |
| **Author(s)**     | Tavli team                                                                               |
| **Supersedes**    | TAVLI-6 end-of-visit tab settlement (shipped by ticket + commit `a1d27dd`; no prior ADR) |
| **Superseded by** | —                                                                                        |

## Context

TAVLI-6 made the Session (tab) the primary settlement unit: orders accumulated
unpaid across a visit and one payment at the end settled the whole tab,
subtotal plus tip, with the 12% platform fee carved **out of** the restaurant's
proceeds. That decision was never recorded as an ADR — it shipped by ticket and
commit `a1d27dd` — which is part of why reversing it deserves one.

Living with the tab model surfaced three structural costs:

**The restaurant carries all the risk.** The kitchen cooks on credit. Every
open tab is an unsecured loan to a table of strangers, softened only by a
spoofable geofence and a staff chase-down path (`flaggedStaleAt`, the stale-tab
sweep). Walkouts are the restaurant's loss, and the product's answer was
process, not structure.

**The fee carve-out compresses restaurant margins.** Levying the 12% commission
out of the subtotal means the restaurant nets 88% of its own menu prices. In a
low-margin business that is the difference between the product paying for
itself and the product being a cost.

**Partial refunds don't apportion cleanly.** Cancelling one order out of a paid
tab refunds against a charge whose fee was levied on subtotal-only but whose
Stripe apportionment runs on the charge total (subtotal + tip). The platform
retains a measured ~1.09%-of-refund residue
(`documentation/runbooks/stripe-go-live.md:284-298`) — accepted for v1, but a
standing accounting wart.

Meanwhile the substitution problem had no home at all: 86'ing a line on a
_paid_ order was unsupported (ADR 007 scoped 86 to unpaid rounds), leaving
whole-order cancel-and-refund as the only tool when the kitchen runs out of one
ingredient.

## Decision

### The Order is the unit of payment; the kitchen only sees paid orders

A diner pays for each Order at submit. The charge is confirmed by the Stripe
webhook **before** the order reaches the kitchen — `submitted` now implies
paid. The Session stops being a settlement unit: no accumulating balance, no
tab lock, no end-of-visit checkout for post-cutover sessions.

### The 12% commission is customer-borne, on top

The diner pays `subtotal + 12%`; `application_fee_amount` is set to exactly
that fee, so the restaurant nets its **full subtotal**. This reverses the
TAVLI-6 carve-out. The fee is itemized on receipts as the Tavli service fee. It
applies to order subtotals and substitution deltas, never to tips.
`payments` rows record the split explicitly: `amount === subtotalAmount +
feeAmount`.

### The Session is the visit grouping and the tip vehicle

The Session keeps its join-code membership and staff close. At visit close-out,
each member who paid for orders is prompted to tip on their own spend — a
separate `kind: "tip"` payment against the card saved at first charge
(`setup_future_usage: "off_session"`, attached to a platform-level Stripe
Customer per Clerk user). No commission is taken on tips.

### Cash stays possible via `awaiting_payment`

A diner who wants to pay in person commits the order as `awaiting_payment`: a
new order status visible **only to staff** — it never appears on the kitchen
rail. Staff collect and tap "mark paid in person", which stamps
`settledBy: "staff"` (no Stripe row) and releases the order to `submitted`.
Awaiting-payment orders are excluded from every Stripe path, including the
legacy tab payable set.

### Substitutions replace "sorry, refund" for out-of-stock on paid orders

When the kitchen can't make a paid line, staff propose a substitution: an
equal-or-higher-priced alternative (`deltaAmount >= 0`, enforced in app code),
snapshotted in a `substitutionProposals` row. The diner approves on their own
device; any price difference plus 12% on the difference is charged to the saved
card. Declining 86's the line and refunds it — line price plus its
proportional share of the service fee. When the refunded line is the order's
last live line, the **entire remaining balance** of the payment is refunded,
which structurally retires the fee-apportionment residue documented in
`documentation/runbooks/stripe-go-live.md:284-298`: per-line refund math is now
computed in-house on a fee-inclusive charge, not left to Stripe's
proportional flags.

### Receipts and the platform subscription

Order receipts become restaurant-branded emails carrying the restaurant's tax
block (`rfc`, `razonSocial`, `fiscalAddress` — informational, not CFDI). A
2,000 MXN/month platform subscription, billed via Stripe Billing, is introduced
behind a per-restaurant flag (`platformSubscriptionEnabled`); the Stripe Price
object is authoritative for the amount, the constant is display-only.

### Rollout: hard cutover with a legacy tail, no feature flag

Post-cutover sessions are pay-at-submit, period. The only legacy behavior kept
is the settlement tail: a session opened before the cutover with tab subtotal
`> 0` still settles through the tab flow. There is **no feature flag** — the
gate is the data itself (does this session have a pre-pivot unpaid balance?).
The legacy tab machinery is deleted at T+30d, when every pre-pivot session has
either settled or been closed by staff.

## Consequences

### Positive

- Walkout risk shrinks to cash orders only — everything else is paid before
  the kitchen fires.
- The restaurant nets 100% of its menu prices; the commission is visible to
  the person who bears it.
- The fee-apportionment refund residue is structurally gone for post-pivot
  payments: refunds are computed in-house per line.
- Out-of-stock on a paid order has a first-class flow (substitution or
  per-line refund) instead of whole-order cancel-and-refund.
- No feature flag: one live code path per session vintage, and the legacy path
  has a scheduled deletion date.

### Negative

- Diners see a 12% line item on every order. Sticker-price honesty is a
  product bet; some restaurants will feel it as a competitiveness tax.
- Analytics revenue semantics change: the fee now lives **inside**
  `payments.amount` (`amount = subtotal + fee`), so every revenue aggregate
  must read `subtotalAmount`, not `amount`, or overstate restaurant revenue by
  12%. Legacy rows (no `kind`) have the old semantics — mixed-vintage queries
  must branch.
- Refund math moves in-house. Stripe's proportional apportionment is replaced
  by our own per-line arithmetic (line + fee share, remainder on last live
  line) — correctness is now our liability, including rounding.
- One-tap charges on the saved card (tips, substitution deltas) can be
  declined or challenged: off-session charges need a 3DS fallback path that
  brings the diner back to their device.
- Ordering gains a payment sheet mid-flow: submit is no longer instant, and a
  failed payment now blocks food where the tab model would have fired the
  kitchen anyway.

### Neutral

- The Session survives as visit grouping and tip vehicle; join codes and staff
  close are unchanged.
- `awaiting_payment` is a staff-trust path: nothing stops a table from
  ordering by cash intent and walking — which is exactly the pre-pivot risk,
  now scoped to explicitly cash orders.
- The legacy per-order payment fields (`orders.paymentState`, `paidAt`) stop
  being "legacy" — the new model rehabilitates them as the primary path.

## Alternatives Considered

### Option 1: Keep tab settlement, absorb the fee into menu prices

Keep TAVLI-6's model and tell restaurants to raise prices 12%.

**Pros:**

- No engineering work; no diner-visible fee line.

**Cons:**

- Does nothing about walkout risk or the refund residue.
- Restaurants price-match their own dine-in menus; hidden markups leak.

**Why not chosen:** It papers over the margin problem and ignores the risk
problem entirely.

### Option 2: Pay-at-submit with restaurant-borne fee (keep the carve-out)

Flip to per-order payment but keep taking 12% out of the restaurant's side.

**Pros:**

- Solves walkout risk; no diner-visible fee.

**Cons:**

- Keeps compressing restaurant margins — the strongest churn driver we can
  control.
- Keeps the mismatch between what the diner pays and what the restaurant
  nets on every receipt and export.

**Why not chosen:** The commission's incidence is a business decision made
deliberately here: the diner pays for the convenience, the restaurant keeps
its menu price.

### Option 3: Feature-flag the cutover per restaurant

Run both models side by side behind `restaurants.*` flag.

**Pros:**

- Gradual rollout, per-restaurant opt-in.

**Cons:**

- Every payment-adjacent surface (kitchen rail, checkout, refunds, analytics,
  receipts) forks on the flag, indefinitely.
- The tab model's problems are structural; keeping it alive per-flag keeps
  its maintenance cost at 100%.

**Why not chosen:** A hard cutover with a data-gated settlement tail gives the
same safety for pre-pivot sessions at a fraction of the surface area, and the
legacy code gets a deletion date instead of a flag graveyard.

### Option 4: Substitution as "refund and reorder"

No proposal flow — 86 the line, refund it, let the diner order the
alternative themselves.

**Pros:**

- No new table, no off-session delta charge, no 3DS fallback.

**Cons:**

- The diner pays two fees on what is one dish, waits through a second
  payment flow, and the kitchen loses the ticket's continuity.
- Refund-then-charge round-trips money that mostly nets to a small delta.

**Why not chosen:** The substitution _is_ the common kitchen event; modelling
it as a delta charge matches what physically happens.

## Implementation

Phase 0 (this ADR's companion change) lands vocabulary, schema, and constants
only — all additive:

- `convex/constants.ts` — `ORDER_STATUS.AWAITING_PAYMENT`, `PAYMENT_KIND`,
  `SUBSTITUTION_PROPOSAL_STATUS`, `PLATFORM_MONTHLY_FEE_MXN_CENTS`, new
  `AUDIT_EVENT` names, tip presets `[10, 15, 20]`, legacy doc comments on the
  `TAB_*_ORDER_STATUSES` allowlists (values unchanged — `awaiting_payment` is
  deliberately not tab-payable).
- `convex/schema.ts` — `payments.{subtotalAmount, feeAmount, kind,
paidByUserId, stripePaymentMethodId, substitutionProposalId}`;
  `orders.{status += awaiting_payment, paidByUserId, awaitingPaymentAt,
settledBy}`; `restaurants.{rfc, razonSocial, fiscalAddress,
platformSubscriptionEnabled, stripeBillingCustomerId, stripeSubscriptionId,
billingStatus, billingCurrentPeriodEnd}`; new tables `stripeCustomers` and
  `substitutionProposals`; `userSettings.orderDashboardStatusFilter`
  (single-select, includes `awaiting_payment`).
- `convex/restaurantPurge.ts` — `substitutionProposals` joins the hard-purge
  cascade (`stripeCustomers` is user-scoped and purge-exempt by construction:
  it carries no restaurant reference).
- `convex/migrations/backfillOrderDashboardStatusFilter.ts` — collapses the
  legacy multi-select dashboard filter into the new single-select value.

Later phases wire the Stripe flows (pay-at-submit intent + webhook release,
tip and delta off-session charges with 3DS fallback, Stripe Billing), the
substitution UX, receipts, and the frontend status surfaces; then delete the
legacy tab machinery at T+30d.

## References

- [`CONTEXT.md`](../../CONTEXT.md) — rewritten glossary entries: _Session_,
  _Order_, _86_, _Awaiting payment_, _Substitution_, _Visit close-out_, _Tavli
  service fee_, _Access code_, _Platform subscription_.
- [ADR 007](./007-station-tickets-and-item-cancellation.md) — station tickets;
  its "86 only while unpaid" scope is extended by the substitution flow here.
- [`documentation/runbooks/stripe-go-live.md`](../runbooks/stripe-go-live.md)
  — §"Partial refunds apportion on the charge total": the residue this ADR
  retires.
- Commit `a1d27dd` — the TAVLI-6 tab settlement this ADR supersedes.
- [TAVLI-71](https://linear.app/gggfox-projects/issue/TAVLI-71) — the
  settlement pivot epic.

---

## Change Log

| Date       | Author     | Description     |
| ---------- | ---------- | --------------- |
| 2026-08-07 | Tavli team | Initial version |
