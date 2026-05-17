# Tavli

Tavli is a single-context restaurant operations product covering menus, online
ordering, payments, reservations, attendance, and the per-restaurant staff
schedule. This file is the project's glossary — what each domain term means,
how the terms relate, and which alternative phrasings to avoid.

`CONTEXT.md` is intentionally devoid of implementation details; it is not a
spec or scratch pad. For architectural decisions see
[`documentation/ADR/`](./documentation/ADR/).

## Language

### Restaurant & menu

**Restaurant**:
A single physical location operated under one organization, identified by a
public slug.
_Avoid_: store, location, branch.

**Menu**:
A named, ordered collection of `MenuCategories` displayed to diners.
_Avoid_: catalog.

**Menu category**:
Diner-facing organizational grouping inside a `Menu` (e.g. Appetizers,
Mains, Drinks). Carries no information about how items are prepared.
_Avoid_: section, kind.

**Menu item**:
A single sellable thing inside a `MenuCategory`, with a base price, optional
options, an availability flag, and a `PrepStation`.
_Avoid_: dish (too narrow — items can be drinks), product, SKU.

**Prep station**:
Where a `MenuItem` is physically prepared. Two values: `kitchen` and `bar`.
Aligned with `SHIFT_ROLE.KITCHEN` and `SHIFT_ROLE.BARTENDER` so the staff
working a shift map onto the same vocabulary that drives the orders-tab
filter. Lives on `MenuItem`, not on `MenuCategory` — see ADR 005.
_Avoid_: type, kind, beverage category, meal category.

### Ordering

**Session**:
An open service period at a `Table`. Many `Orders` may be added to a
single session before it closes.

**Order**:
The unit a diner pays for. Holds a `status` (`draft → submitted →
preparing → ready → served`, or `cancelled`), a single `paymentState`,
and per-station completion timestamps (`kitchenReadyAt`, `barReadyAt`).
_Avoid_: ticket, check, transaction.

**Order item**:
A single line on an `Order`, denormalized at submission time with the
`MenuItem`'s name, unit price, and chosen options. The item's
`prepStation` is intentionally **not** snapshotted — it is read live
from the source `MenuItem` at query time. See ADR 005.

**Mark station ready**:
The action a station's staff take to confirm their portion of an
`Order` is done, stamping `kitchenReadyAt` or `barReadyAt`. When every
applicable station has been stamped, the `Order`'s overall `status`
flips to `ready`.
_Avoid_: bump, complete.

### Staffing

**Restaurant member**:
A `User`'s membership in a single `Restaurant`, with the per-restaurant
role `manager` or `employee`. Org-level roles (`owner`, `admin`) live
on `userRoles` instead.

**Shift**:
A scheduled work block for a `RestaurantMember`, carrying a
`ShiftRole` (`server | bartender | host | kitchen | manager`).

**Shift role**:
The role a `RestaurantMember` is working *for that shift*. Distinct
from their `RestaurantMember.role` (which is a permission tier). The
two prep stations (`kitchen`, `bar`) deliberately reuse the
`SHIFT_ROLE` vocabulary.

**Section**:
A floor zone (e.g. patio, main room) `Tables` belong to. `Servers` are
assigned to sections for the duration of (a sub-window of) a `Shift`.

## Relationships

- A **Restaurant** has many **Menus**, each with many **MenuCategories**,
  each with many **MenuItems**.
- Every **MenuItem** has exactly one **PrepStation**.
- A **Session** has many **Orders**; an **Order** has many **OrderItems**;
  an **OrderItem** references one **MenuItem** by id (live lookup for
  `prepStation`, snapshot for everything else).
- An **Order** is "ready" when every **PrepStation** that has at least one
  **OrderItem** in that order has its `*ReadyAt` timestamp set.
- A **RestaurantMember** works **Shifts**; each **Shift** has one
  **ShiftRole**. Two of those roles (`bartender`, `kitchen`) share their
  literal value with the two **PrepStations**.

## Example dialogue

> **Manager:** "If I rename a **Menu category** from 'Drinks' to 'Beverages',
> does the orders tab still know which tickets go to the bar?"
>
> **Domain expert:** "Yes — the **PrepStation** lives on the **MenuItem**,
> not the **MenuCategory**. Renaming the category only affects how diners
> see the menu. To re-route items, you change each item's prep station, or
> use the bulk action on the category."
>
> **Manager:** "And if I just changed an item from kitchen to bar
> mid-service?"
>
> **Domain expert:** "Already-submitted **OrderItems** for that
> **MenuItem** also re-route — we read the station live from the
> **MenuItem**, we don't snapshot it onto the **OrderItem**. So avoid
> editing **PrepStation** while orders are open. See ADR 005."

## Flagged ambiguities

- "Beverage category" and "meal category" came up during the prep-station
  design discussion. Resolved: we do **not** model the food/beverage axis.
  The orthogonal concept is **PrepStation**, which lives on **MenuItem**.
  See ADR 005.
- "kitchen" is used both as a **PrepStation** value and as the
  `SHIFT_ROLE.KITCHEN` value. This is intentional — the words refer to
  the same physical place — but the two literals belong to two different
  enum types and are not interchangeable in code.
- "category" sometimes shows up in old chat about orders meaning
  "**PrepStation**". In the current language, **MenuCategory** is purely
  diner-facing organization; routing is **PrepStation**.
