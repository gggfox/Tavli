# ADR-007: Station tickets and item-level cancellation

## Metadata

| Field             | Value      |
| ----------------- | ---------- |
| **Status**        | Accepted   |
| **Date**          | 2026-08-02 |
| **Author(s)**     | Tavli team |
| **Supersedes**    | —          |
| **Superseded by** | —          |

## Context

ADR 005 gave the orders dashboard a prep-station filter, but the filter is
_presence-based_: an order containing at least one item for the selected
station renders as a whole card, with matching items tinted and the other
station's items dimmed. A bartender filtering to "bar" still reads past the
kitchen's food on every mixed round.

Two things changed since then.

**Tabs changed what an Order is.** A `Session` (tab) now accumulates one
`Order` per round the diner sends, and settlement happens at the session
level (`payments.sessionId`); per-order payment is the legacy path. ADR 005's
Option 4 ("full per-item status") was rejected partly because the Order was
the unit of payment and refund — that argument is materially weaker now.

**Service is per-station, not per-order.** Whichever station finishes first
sends its items to the table immediately; drinks do not wait at the pass for
the kitchen. So "mark bar ready" does not mean "ready and waiting" — it means
"my portion has left the station." A dashboard that keeps a stamped round on
the bar's screen is showing work that is already on the table.

That reframing exposed a second gap. The only cancellation the product had
was whole-order: cancelling a round because the kitchen ran out of one
ingredient also voids the bar's drinks, and (for a paid order) refunds
everything. Staff had no way to strike a single line — `removeItem` is
draft-only and diner-facing.

## Decision

### Station tickets are a projection, not sub-orders

When **exactly one** station is selected on the orders dashboard, each round
renders as a **station ticket**: only that station's live items, with only the
actions that station can take. With no filter, or with both stations selected,
the dashboard renders the existing whole-order card unchanged — that is where
money, payment state, cross-station progress, and whole-order cancellation
live.

Station tickets are derived client-side by `deriveStationTickets`. There is
**no station-ticket document**, no new table, and no schema change for this
half of the work. Even though tabs weakened the payment-unit argument against
splitting, a projection buys the entire user-visible outcome without dragging
`orders.paymentState`, `confirmPayment`, per-order cancel/refund, or
`dailyOrderNumber` into a per-station world.

### The ready stamp means "left the station", so the ticket bumps

`markStationReady` is unchanged on the backend, but the dashboard now treats
the stamp as completion of that station's work: the ticket leaves that
station's rail, so the rail shows only work still to do.

Because the stamp was previously irreversible (`VALID_TRANSITIONS` is
forward-only and nothing cleared a `*ReadyAt`), a mistap would make a round
vanish from a station's view — and, if the other station had already stamped,
flip the whole order to `ready` while food was still cooking. A new
`unmarkStationReady` mutation is the escape hatch, surfaced as a ~10 s undo
strip on the dashboard. It clears the station's stamp and, when that stamp had
been the one to complete the order, walks `status` back from `ready` to
`preparing`.

`VALID_TRANSITIONS` stays forward-only. The backwards step is encapsulated
inside `unmarkStationReady`, exactly as the forward flip is encapsulated inside
`markStationReady`.

Station tickets never offer "Mark Served". Serving physically happened at the
stamp; `served` is the bookkeeping close, done from the overview.

### Item-level cancellation ("86")

Staff can cancel a single `OrderItem` via `cancelOrderItem`. Two optional
fields carry it:

```ts
cancelledAt: v.optional(v.number());
cancelledBy: v.optional(v.string());
```

A cancelled line stays on the order — the diner ordered it and may ask about
it — but leaves `Order.totalAmount`, station applicability, and analytics.
When every line on an order is cancelled, the order itself flips to
`cancelled` with the usual `ORDER_STATUS_CHANGED` audit event.

Guards: the order must be `submitted` or `preparing` (drafts belong to the
diner; a `ready` order is plated, which is a manager's whole-order call), it
must be effectively unpaid, and the tab must not be locked for payment. Each
rejection returns a stable code — `ERROR_ORDER_ITEM_NOT_CANCELLABLE`,
`ERROR_ORDER_ITEM_CANCEL_PAID`, `ERROR_ORDER_ITEM_CANCEL_TAB_LOCKED`.

**Scope is deliberately the tab flow, where nothing has been charged yet.**
Dropping a line simply bills the diner less at settle — no money moves. Once a
payment is in flight or settled, returning money needs a partial refund, so 86
refuses and the existing whole-order cancel-and-refund stays the tool.

There is **no uncancel mutation**. On an open tab the recovery path is to
re-order the item, so 86 is gated by an inline two-tap confirmation rather than
an after-the-fact undo.

### No station-level authorization exists, and we did not invent one

Nothing in the codebase binds a user to a station — ADR 005 made the station
filter a UI convenience with no auth coupling, and a `RestaurantMember`'s
`SHIFT_ROLE` describes scheduling, not permission. `cancelOrderItem` therefore
allows any restaurant staff to 86 any line; `cancelledBy` / `cancelledAt` is
the accountability trail, and the station ticket UI is what scopes it in
practice. Enforcing "your station only" would require a real user↔station
binding, which is a separate decision.

## Consequences

### Positive

- A station reads only its own work: the bar's rail holds drinks, not food.
- The rail shows work remaining, not work done — stamped rounds bump off.
- One station running out no longer voids the other station's items, and on a
  tab it costs the diner nothing but the missing line.
- Order-level `specialInstructions` (allergy notes) finally render on the
  dashboard — they previously appeared nowhere staff-facing.
- No schema change for tickets and no new table; the Order stays the unit of
  payment, refund, and history.

### Negative

- Two dashboard modes exist. A card in single-station mode and the same round
  in overview mode look and behave differently.
- 86 on a paid order is not supported; staff must fall back to whole-order
  cancel-and-refund, which returns more money than the missing line.
- Any staff member can 86 any line, including another station's.
- Cancelled lines still consume slots in the whole-order card's
  `MAX_VISIBLE_ITEMS` preview.

### Neutral

- The undo strip holds a single slot: a second bump replaces the pending undo.
- Quantity is all-or-nothing per line — 86'ing one of three tacos is not
  modelled.
- 86 is not pushed to the diner as a notification; the struck-through line and
  the falling total are the signal.

## Alternatives Considered

### Option 1: Real sub-order documents

Split a mixed round into one `Order`-like document per station, as the
originating ticket literally requested.

**Pros:**

- Per-station lifecycle for free: separate numbers, separate printing, separate
  cancellation.
- Matches how the request was phrased.

**Cons:**

- Every per-order concern (`paymentState`, `confirmPayment`, cancel/refund,
  `dailyOrderNumber`, audit aggregates, exports) needs a per-station answer.
- The legacy per-order payment path still exists and would need to work in a
  world where an order is not the thing that gets paid.

**Why not chosen:** It buys nothing the projection does not, at the cost of a
schema-level project touching payments.

### Option 2: Keep whole-order cards, improve the highlight

Sharpen the tint/dim treatment instead of scoping the card.

**Pros:**

- Smallest possible change; one dashboard mode.

**Cons:**

- The other station's items stay on screen, which is exactly the complaint.
- Leaves the per-station-delivery workflow unmodelled — the stamp still reads
  as "ready and waiting".

**Why not chosen:** It restates ADR 005 rather than advancing it.

### Option 3: Bump with no undo

Remove the ticket on stamp and accept irreversibility.

**Pros:**

- Zero backend change.

**Cons:**

- A mistap silently removes the round from the station's view, and can flip a
  half-cooked order to `ready` with no recovery path short of editing data.

**Why not chosen:** The mutation is small (one patch, no payment interaction)
and the failure it prevents is one a busy station will hit.

### Option 4: Per-station cancellation instead of per-item

Let a station void "its portion" of a round.

**Pros:**

- Matches the phrasing "stations decide on cancel".

**Cons:**

- The real event is "we are out of carnitas", which kills the tacos, not the
  quesadilla on the same ticket. Station-portion cancellation is either too
  blunt or just a loop over items.

**Why not chosen:** The item is the true primitive; "cancel my portion" is
selecting all of them.

## Implementation

Backend:

- `convex/schema.ts` — `orderItems.cancelledAt`, `orderItems.cancelledBy`
  (optional; no migration, following the `kitchenReadyAt` precedent).
- `convex/orderHelpers.ts` — `isCancelledOrderItem`; `getApplicableStations`
  and `recalculateTotal` skip cancelled lines.
- `convex/orders.ts` — new `unmarkStationReady` and `cancelOrderItem`;
  `getActiveOrdersByRestaurant`'s presence filter ignores cancelled lines;
  export `itemsSummary` annotates them `(cancelled)`.
- `convex/analytics/_shared.ts`, `convex/analytics/topMenuItems.ts` — cancelled
  lines excluded from quantity and revenue.

Frontend:

- `stationTickets.ts` — `deriveStationTickets`, the three projection rules.
- `StationTicketCard.tsx` — lean prep ticket; every item (no cap), order note,
  per-item 86 with inline confirmation, Accept / Mark-station-ready only.
- `OrderDashboard.tsx` — single-station mode switch, undo strip, ticket-mode
  empty state.
- `OrderItemRow.tsx` — struck-through treatment for cancelled lines (whole-order
  card and detail modal still receive them).
- `OrderCard.tsx` / `OrderDetailModal.tsx` — render order-level
  `specialInstructions`.
- `OrderStatus.tsx` — diner sees cancelled lines struck through as
  "Unavailable"; totals drop reactively.
- `OrderItemsTooltipTrigger.tsx` — payments tooltip lists only charged lines.

### Concurrency

- **86 racing `markStationReady`.** Convex mutations are serializable, so either
  order lands consistently: 86-first makes the stamp reject ("no items prepared
  at the …"), stamp-first is handled by the rescue below.
- **86 stranding a `preparing` order.** Cancelling the last line of the only
  station that had not stamped would leave nobody to complete the order.
  `cancelOrderItem` re-evaluates the applicable stations and flips to `ready`
  itself.
- **86 racing tab settlement.** After the lock, the tab-locked guard rejects.
  Before it, `beginTabPayment` re-checks the subtotal inside the transaction and
  the diner retries at the lower amount.
- **Undo racing "Mark Served".** Once served, `unmarkStationReady` rejects. The
  window is ~10 s, so this is rare and safe.

## References

- [ADR 005](./005-menu-item-prep-station.md) — prep station on `MenuItem`,
  per-station ready timestamps, and the presence-filter dashboard this extends.
- [`CONTEXT.md`](../../CONTEXT.md) — glossary entries for _Station ticket_ and
  _86_.
- [TAVLI-44](https://linear.app/gggfox-projects/issue/TAVLI-44/split-bar-and-kitchen-orders)

---

## Change Log

| Date       | Author     | Description     |
| ---------- | ---------- | --------------- |
| 2026-08-02 | Tavli team | Initial version |
