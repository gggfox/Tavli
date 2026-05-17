# ADR-005: Menu item prep station and per-station ready timestamps

## Metadata

| Field | Value |
| ------- | ------- |
| **Status** | Accepted |
| **Date** | 2026-05-15 |
| **Author(s)** | Tavli team |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

The orders dashboard previously rendered every active order as a single
card, filterable only by `Order.status`. Restaurants with both a kitchen
and a bar asked for a way to filter the dashboard so the bartender sees
"the bar's queue" without scrolling past food tickets, and so a station
can independently confirm its portion of an order is ready (today the
bartender has to wait for the kitchen to finish before clicking "Mark
Ready").

We considered framing the new concept as "beverage vs meal" categories,
but real menus have categories that mix stations (Specials, Brunch,
Charcuterie). The existing schedule grid already labels staff with
`SHIFT_ROLE` values (`server | bartender | host | kitchen | manager`),
so the staff already think of themselves as "bar" or "kitchen" rather
than "drinks" or "food." Aligning the new field with that vocabulary
keeps both the orders dashboard filter and the schedule grid speaking
the same language.

Three coupled trade-offs needed resolution:

1. Whether to model the **food/beverage content axis** or the
   **kitchen/bar prep-station axis**.
2. Whether the field lives on `MenuCategory` or on `MenuItem`.
3. Whether `OrderItem` snapshots `prepStation` at order creation, or
   reads it live from `MenuItem` at query time.

We also had to decide what "filter by station" actually does to the
dashboard, and how a station can mark its portion of an order ready
without redesigning the order lifecycle (which touches payment, refund,
and cancellation paths). That sub-decision is captured in the
"Per-station completion" section below.

## Decision

We model the **prep station** axis (where an item is prepared) as a
single-value field on `MenuItem`:

```ts
prepStation: v.union(v.literal("kitchen"), v.literal("bar"))
```

Backfilled to `"kitchen"` for all pre-existing rows by
`convex/migrations/backfillPrepStation.ts`; new rows always set it via
`createMenuItem`. The two literals deliberately reuse
`SHIFT_ROLE.KITCHEN` and `SHIFT_ROLE.BARTENDER` vocabulary.

`MenuCategory` is **untouched** — it remains a pure diner-facing
organizational grouping and carries no station information. Mixed
categories (Specials, Brunch) are supported because each item carries
its own station independently of the category it appears in.

`OrderItem` does **not** snapshot `prepStation`. The orders dashboard
query resolves it by joining each `OrderItem.menuItemId` to the current
`MenuItem.prepStation` at read time. Items whose source `MenuItem` has
been deleted fall back to `DEFAULT_PREP_STATION` so they never
disappear from a station's filtered queue.

### Per-station completion

Two optional timestamps on `Order` track per-station readiness:

```ts
kitchenReadyAt: v.optional(v.number())
barReadyAt: v.optional(v.number())
```

A new `markStationReady` mutation stamps the appropriate timestamp.
When *every applicable* station (= the distinct `prepStation` values
across the order's items) has been stamped, the same patch flips
`Order.status` to `"ready"`. `Order.status` therefore remains the single
source of truth for whole-order completion; the per-station timestamps
are an additive layer that grants station autonomy without redesigning
the order lifecycle.

### Dashboard UX

The orders dashboard adds a second row of filter chips for prep
stations. Persisted per user via
`userSettings.orderDashboardPrepStationFilters`; default = empty array
= "no station filter applied" (= show all stations). No authorization
coupling — any user with restaurant staff access can see any station;
the filter is a UI convenience.

When a station filter is active, the dashboard still renders one card
per order (presence-based filter — a card is shown if it has at least
one matching item). Inside the card, items matching the filter get a
station-tinted background plus a station-color left border; items
outside the filter get muted via reduced opacity. When exactly one
station is selected and the next transition would be `"ready"`, the
"Mark Ready" button is replaced with the station-scoped
"Mark Bar Ready" / "Mark Kitchen Ready" action that calls
`markStationReady`.

## Consequences

### Positive

- Diner-facing menu organization (`MenuCategory`) and staff-facing
  routing (`prepStation`) are orthogonal — re-organizing the menu does
  not re-route tickets, and re-tagging items does not re-organize the
  menu.
- The orders-tab filter aligns with the schedule grid vocabulary so a
  bartender-on-shift sees a coherent picture: same word ("bar") in the
  schedule and in the orders dashboard.
- Mixed categories (Specials, Brunch, Charcuterie) work without forcing
  managers to split categories purely for routing purposes.
- Per-station ready timestamps give bar/kitchen autonomy ("my part is
  done") without touching `Order.status`, payment, refund, or
  cancellation flows.
- Live lookup of `prepStation` keeps the source of truth in one place;
  no risk of `OrderItem.prepStation` drifting away from
  `MenuItem.prepStation` over time.

### Negative

- Editing `MenuItem.prepStation` mid-service silently re-routes already-
  active tickets. We accept this trade-off and document it; the
  expectation is that managers configure stations during setup, not
  during a busy service.
- Every menu item must be tagged. Migration is "kitchen by default" plus
  a per-category bulk-tag action; small operational cost on first
  rollout.
- A bartender with 4 cocktails on a single order cannot mark only 2
  ready — `markStationReady` stamps the whole station. For
  fast-pace cocktail bars where drinks need to leave individually, full
  per-item status is the next step.

### Neutral

- `prepStation` is a strict 2-value union now. Adding a third station
  (e.g. `"barista"`, `"expo"`) is a deliberate schema change rather
  than a string-typed extension point. This matches the codebase style
  for similar enums (`SHIFT_ROLE`, `ORDER_PAYMENT_STATE`).

## Alternatives Considered

### Option 1: Model `category.kind: "food" | "beverage"`

Add a `kind` discriminator to `MenuCategory` and filter the orders tab
on it.

**Pros:**

- Matches a manager's intuition that "drinks are different from food."
- Smaller schema (no new field on `menuItems`).

**Cons:**

- Doesn't actually answer "what does the bartender need to make?" — a
  non-alcoholic juice is a beverage but is often made at the kitchen.
- Categories like Specials / Brunch mix kinds; admins would have to
  split them, breaking diner navigation.
- Vocabulary diverges from the existing `SHIFT_ROLE` taxonomy.

**Why not chosen:** It models the wrong axis. The dashboard filter is
about *routing*, not *content*.

### Option 2: Put `prepStation` on `MenuCategory` instead of `MenuItem`

Keep the field name but apply it at the category level.

**Pros:**

- Cheaper admin experience — set the station once per category instead
  of per item.

**Cons:**

- Forces single-station categories. Specials / Brunch can't co-exist as
  a single diner-facing category.
- Migration is harder to reverse: if we later need item-level overrides,
  admins will have already split categories to work around the
  category-level limitation.

**Why not chosen:** One-way door. Item-level is the safer default; the
bulk-tag action makes per-item assignment cheap in practice.

### Option 3: Snapshot `OrderItem.prepStation` at submission time

Mirror the existing snapshot pattern for `menuItemName`, `unitPrice`,
and `selectedOptions`.

**Pros:**

- Resilient to mid-shift menu edits — a manager re-tagging "Espresso"
  from kitchen → bar at 8pm doesn't suddenly re-route already-active
  tickets.
- Single-pass dashboard query (no join through `menuItems`).
- Soft-deleted menu items keep their station info.

**Cons:**

- Slightly more storage (one extra string per order line).
- `OrderItem.prepStation` can drift away from `MenuItem.prepStation`
  over time, which adds reasoning overhead.

**Why not chosen:** Live lookup keeps the source of truth in one place
and makes the schema smaller. The "mid-shift menu edit re-routes a
ticket" failure mode is documented as a known constraint and we expect
managers to configure stations outside of service hours.

### Option 4: Full per-item status (`OrderItem.status`)

Give each `OrderItem` its own state machine and derive `Order.status`
as `min(items.status)`.

**Pros:**

- Maximum granularity — a bartender can mark individual cocktails
  ready.
- Item-level cancellation falls out for free.

**Cons:**

- Multi-week refactor that touches payment confirmation, refund flows,
  cancellation, and the dashboard's "next action" UI.
- The whole-order `paymentState`, `paidAt`, and refund lifecycle would
  need to grow per-item awareness.

**Why not chosen:** Out of scope for v1. Per-station timestamps deliver
80% of the workflow value for ~5% of the implementation cost; we can
promote to per-item status later if a fast-pace cocktail bar surfaces
the need.

## Implementation

Schema changes in [`convex/schema.ts`](../../convex/schema.ts):

- `menuItems.prepStation` (optional during rollout; written on every
  insert; backfilled on existing rows).
- `orders.kitchenReadyAt`, `orders.barReadyAt`.
- `userSettings.orderDashboardPrepStationFilters`.

Backend mutations in [`convex/orders.ts`](../../convex/orders.ts):

- Extended `getActiveOrdersByRestaurant` with a `prepStations` arg and
  per-item `prepStation` enrichment via batched `menuItem` lookup.
- New `markStationReady` mutation that stamps the right timestamp,
  computes the order's applicable stations, and flips
  `Order.status = "ready"` when every applicable station is done.
- `getApplicableStations` and `resolvePrepStation` helpers in
  [`convex/orderHelpers.ts`](../../convex/orderHelpers.ts).

Backend mutations in [`convex/menuItems.ts`](../../convex/menuItems.ts):

- `create` and `update` accept `prepStation`.
- New `bulkSetPrepStation` mutation, mirroring `bulkSetAvailability`.

Migration in
[`convex/migrations/backfillPrepStation.ts`](../../convex/migrations/backfillPrepStation.ts):

- Idempotent backfill of every `menuItems` row to
  `DEFAULT_PREP_STATION` ("kitchen"). Run once per env after deploy.

Frontend:

- `OrderDashboard` adds a `StationFilterChips` row using
  `STATION_CONFIG` and persists selection via the new
  `updateOrderDashboardPrepStationFilters` user-settings mutation.
- `OrderItemRow` applies a station-tinted background + accent border to
  matching items, opacity to non-matching items, when a station filter
  is active.
- `OrderCard` renders per-station progress chips and swaps "Mark Ready"
  for "Mark Bar/Kitchen Ready" when exactly one station is selected.
- `AddItemForm` and `ItemEditForm` expose a `SegmentedControl` toggle
  for `prepStation`.
- `CategorySection` adds two bulk actions: "Set to Kitchen" / "Set to
  Bar".
- New CSS variables `--station-kitchen{,-light}` and
  `--station-bar{,-light}` in
  [`src/global/styles/theme.css`](../../src/global/styles/theme.css)
  (light + dark) ensure the station palette never collides with the
  existing status tones.

## References

- [`CONTEXT.md`](../../CONTEXT.md) — glossary entry for *Prep station*
  and the *flagged ambiguity* about beverage/meal categories.
- [`convex/constants.ts`](../../convex/constants.ts) —
  `PREP_STATION`, `DEFAULT_PREP_STATION`, and `SHIFT_ROLE` for the
  vocabulary alignment.

---

## Change Log

| Date       | Author     | Description     |
| ---------- | ---------- | --------------- |
| 2026-05-15 | Tavli team | Initial version |
