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

**Platform subscription**:
The 2,000 MXN/month fee a `Restaurant` pays Tavli for using the product,
enabled per restaurant.
_Avoid_: commission (that is the per-order **Tavli service fee**).

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
An open service period at a `Table`, doubling as the group's shared
visit. Members join by a short **join code**; each member pays for
their own `Orders` as they place them, and each member is prompted for
their own tip at **Visit close-out**. A session closes at Visit
close-out, or the hourly stale sweep auto-closes it once nothing is
owed; staff resolve cash walkouts by collecting or 86'ing
**Awaiting payment** orders on the Orders dashboard.
_Avoid_: check, bill; tab (pre-pivot language for the session as a
settlement unit — see ADR 008).

**Order**:
A round of items added to a `Session` — **the unit a diner pays for**.
An order is paid at submit, before the kitchen sees it, or handed to
staff as **Awaiting payment** for in-person collection. Holds a
`status` (`draft → submitted → preparing → ready → served`, or
`cancelled`; the in-person path inserts `awaiting_payment` before
`submitted`) and per-station completion timestamps (`kitchenReadyAt`,
`barReadyAt`). `served` stays terminal — a served order cannot be
cancelled.
_Avoid_: ticket, check, transaction.

**Access code**:
The diner-facing name ("Access code" / "Código de acceso") for the
geofence bypass code staff hand out when a device's location check
fails. Staff-facing settings call it by its technical name, **Geofence
bypass code** / _Código de anulación de geocerca_ — same value,
`restaurants.geofenceBypassCode`. It is a soft UX gate, not a security
control: browser geolocation is spoofable. Distinct from the session's
**join code**, which admits a friend to the visit.
_Avoid_: table code / código de mesa (old name), join code (different
thing).

**Awaiting payment**:
An `Order` committed by the diner for in-person payment. Visible only
to staff — never on the kitchen rail — until staff mark it paid and
release it.
_Avoid_: pending (that is the diner-facing label for submitted), unpaid
order on the tab.

**Substitution**:
A kitchen-proposed replacement for a paid line that can't be made —
equal or higher cost, and the diner approves on their own device. Any
price difference plus its service-fee share is charged on approval;
declining means the line is **86**'d and refunded.
_Avoid_: swap-out silently, edit the order.

**Tavli service fee**:
The 12% commission on an `Order`'s subtotal, paid by the diner on top
and itemized on receipts. The restaurant nets the full subtotal. Never
applied to tips.
_Avoid_: platform fee carve-out, restaurant commission.

**Visit close-out**:
The per-member end-of-visit moment: each `Session` member who paid for
rounds is prompted to tip on their own spend. Skipping is allowed.
_Avoid_: checkout (that is paying for an order), settle (legacy tab
language).

**Order item**:
A single line on an `Order`, denormalized at submission time with the
`MenuItem`'s name, unit price, and chosen options. The item's
`prepStation` is intentionally **not** snapshotted — it is read live
from the source `MenuItem` at query time. See ADR 005.

**Mark station ready**:
The action a station's staff take to confirm their portion of an
`Order` has left the station — those items go to the table immediately,
without waiting for the other station. Stamps `kitchenReadyAt` or
`barReadyAt`; when every applicable station has been stamped, the
`Order`'s overall `status` flips to `ready`. On that station's own
dashboard the `Station ticket` then bumps, with a short undo window.
_Avoid_: complete. Say "mark bar ready" for the action — _bumping_ is
what happens to the ticket afterwards, not another name for this.

**Station ticket**:
One station's portion of an `Order`: only that station's live items,
and only the actions it can take on them. A projection rendered at read
time — there is no such document, and the `Order` remains the unit of
payment, cancellation, and history. See ADR 007.

Reached by choosing the dashboard's **ticket view**, which needs one
station selected and a status that still has station work
(`submitted` / `preparing`). Selecting a station on its own is only a
_filter_ and never opens the rail: conflating the two meant filtering to
Kitchen on a closed status blanked the board, since a rail has nothing
to show for `ready` / `served` / `cancelled`.
_Avoid_: sub-order, chit, split order.

**Bump**:
What a `Station ticket` does when its station marks ready: it leaves
that station's rail so the rail shows only work still to do. A short
undo window can put it back.
_Avoid_: clear, close (those suggest the `Order` itself ended).

**86**:
Staff cancelling a single `OrderItem` because it can't be made — the
kitchen is out of an ingredient, the bar is out of a bottle. Stamps
`cancelledAt` / `cancelledBy`; the line stays visible but leaves the
`Order`'s `totalAmount`. On a paid order, the 86'd line's price and its
share of the **Tavli service fee** are automatically refunded; on an
unpaid (**Awaiting payment**) round it remains a free subtraction. When
every line is 86'd, the `Order` becomes `cancelled`.
_Avoid_: void, remove, delete (the line is kept, not erased).

### Employee management

**User**:
A Clerk-authenticated principal (subject string). Owners, admins, and
managers are Users. `EmployeeAccounts` are **not** Users — they have no
Clerk identity.
_Avoid_: account (overloaded — use User for Clerk identities,
EmployeeAccount for managed profiles).

**Employee account**:
A manager-managed staff profile bound to one `Restaurant`, with
structured name (`firstName`, `paternalLastname`, `maternalLastname`),
optional photo, and a hashed `PersonalPIN`. Has **no Clerk identity**.
A shadow `RestaurantMember` row (with `role: employee`) is created
alongside it so that attendance, tips, and audit references always
point at a `RestaurantMember`. See ADR 006.
_Avoid_: staff record, employee profile, worker.

**Personal PIN**:
A short numeric code stored hashed on an `EmployeeAccount`. Set by a
manager at creation, shown to the manager **once**, never retrievable
after that. Used by the employee to (1) read their own tips, attendance,
and schedule, (2) self clock-in/out from the `SharedEmployeeSession`.
Recovery = manager generates a new PIN, shown once. See ADR 006.
_Avoid_: password (implies full auth).

**Shared employee session**:
A per-restaurant Clerk identity bound via
`restaurants.sharedEmployeeClerkSubject`. Read-only by default; PIN
step-up unlocks the employee's own reads and self clock-in/out for that
single action. See ADR 006.
_Avoid_: kiosk login, device account.

### Staffing

**Restaurant member**:
A `Restaurant` membership, with per-restaurant role `manager` or
`employee`. Backed by **either** a `User` (`userId` set) **or** an
`EmployeeAccount` (`employeeAccountId` set) — never both, never
neither (XOR invariant, enforced at application layer). Attendance,
tips, and audit references always point at the `RestaurantMember` row,
regardless of which kind backs it. Org-level roles (`owner`, `admin`)
live on `userRoles` instead. See ADR 006.

**Shift**:
A scheduled work block for a `RestaurantMember`, carrying a
`ShiftRole` (`server | bartender | host | kitchen | manager`).

**Shift role**:
The role a `RestaurantMember` is working _for that shift_. Distinct
from their `RestaurantMember.role` (which is a permission tier). The
two prep stations (`kitchen`, `bar`) deliberately reuse the
`SHIFT_ROLE` vocabulary.

**Section**:
A floor zone (e.g. patio, main room) `Tables` belong to. `Servers` are
assigned to sections for the duration of (a sub-window of) a `Shift`.
_Avoid_: zone, area (use Section).

**Table**:
A physical seatable unit in a `Restaurant`, identified by a
`tableNumber`, with an optional `capacity` and optional membership in a
`Section`. An inactive table is unavailable for reservations and seating;
a hidden section still exists on the floor plan but is collapsed in the
admin layout.
_Avoid_: seat (too narrow — a table holds multiple seats).

### Reservations & timeline

**Timeline**:
A day-oriented visualization of reservations and table locks, with table
rows (grouped by section) on the vertical axis and hourly time slots on
the horizontal axis. Used by staff to see all reservations for each table
during a service day.
_Avoid_: calendar view, floor view, planner.

**Day navigator**:
The arrows-and-calendar control shown in **Timeline** mode for selecting
which service day to display. Distinct from the range selector used in
card/table views.
_Avoid_: date picker (that is the popover widget inside it), range
selector.

**Operating hours**:
The `openTime` / `closeTime` pair on a `Restaurant` (HH:MM strings),
expressed in the **Restaurant timezone**. Defines the visible time range
rendered on the **Timeline**. Falls back to `10:00`–`23:00` when unset.
_Avoid_: business hours, service window.

**Restaurant timezone**:
The IANA timezone on a `Restaurant` (default `America/Mexico_City`).
Defines the restaurant’s calendar day, **Operating hours**, **Timeline**
layout (now line, blocks, drag/create), **Schedule** week grid, and
order-day numbering. Distinct from the staff device’s local timezone.
_Avoid_: locale, UTC offset string.

**Reschedule**:
A staff action that changes a reservation’s `startsAt`, `endsAt`, and/or
`tableIds` from the **Timeline** (for example by dragging a block) or the
reservation detail drawer. Distinct from **confirm**, which is the initial
table assignment for a pending booking.

**No-show**:
A terminal reservation status applied when a booking is still `pending` or
`confirmed` after `startsAt + noShowGraceMinutes`. Frees the table for
availability checks. _Avoid_: autocancel.

**Cancellation**:
A terminal reservation status set by staff (with an optional reason). Frees
the table for availability checks.

**Reopen**:
A staff action that moves a terminal reservation (`cancelled` or `no_show`)
back into the active lifecycle — usually as `confirmed`, or directly as
`seated` when the guest has arrived. Distinct from **Reschedule** on bookings
that are already active.

## Relationships

- A **Restaurant** has many **Menus**, each with many **MenuCategories**,
  each with many **MenuItems**.
- Every **MenuItem** has exactly one **PrepStation**.
- A **Session** has many **Orders**; an **Order** has many **OrderItems**;
  an **OrderItem** references one **MenuItem** by id (live lookup for
  `prepStation`, snapshot for everything else).
- An **Order** is "ready" when every **PrepStation** that has at least one
  non-86'd **OrderItem** in that order has its `*ReadyAt` timestamp set.
- A **Payment** comes in kinds: an order payment settles one **Order**; a
  tip payment records one member's tip on a **Session**; a substitution
  payment covers one **Substitution**'s price difference; legacy tab
  payments settle a whole pre-pivot **Session**.
- An 86'd **OrderItem** contributes nothing to its **Order**'s
  `totalAmount`; on a paid **Order** its price and service-fee share are
  refunded.
- A **Station ticket** is derived from one **Order** and one
  **PrepStation** — it is never stored.
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

- "account" is overloaded. A **User** is a Clerk-authenticated principal;
  an **EmployeeAccount** is a managed profile with no Clerk identity.
  Code should never use a bare "account" — qualify with the specific
  term.
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
- "waiter" appears in product tickets and stakeholder language (e.g. the
  dashboard's "waiter performance"). The canonical term is **Server** — the
  `ShiftRole.SERVER` who is credited for sales via
  `orders.attributedMemberId`. Use **Server** in code and the English UI;
  "waiter" is an external synonym only.
