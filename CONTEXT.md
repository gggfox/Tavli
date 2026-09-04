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

**Public profile**:
The diner-visible contact details a `Restaurant` publishes: its **Contact
email**, one phone number (optionally reachable on WhatsApp), a street address,
and up to five **Social links**. Rendered in exactly two places — a contact bar
pinned below the order bar on the customer menu page, and the footer of the
receipt email. The bar is capped at two rows; the restaurant's name is not part
of it, because the sticky header above already carries the name.
Every part is optional; a restaurant that has published nothing renders nothing
rather than an empty shell.
_Avoid_: about page, listing, storefront, contact card, "the public page".

**Contact email**:
The address a `Restaurant` publishes to diners. One address doing four jobs:
shown to diners, `reply_to` on receipt emails, destination for dashboard error
reports, and recipient of platform-fee billing receipts. There is no separate
internal support address. Stored as `restaurants.supportEmail`, a name kept for
continuity — the concept is Contact email.
_Avoid_: support email (its old, narrower ops-only meaning), reply-to, ops inbox.

**Social link**:
One of five fixed optional slots — Instagram, Facebook, TikTok, X, YouTube —
each holding a full canonical `https` profile URL, validated on write against
that platform's own domain and rewritten to a param-free canonical form.
`twitter.com` is stored as `x.com`. Shortlinks (`fb.me`, `youtu.be`) are
rejected rather than resolved, because they are opaque redirect namespaces and
only the canonical form is kept.
_Avoid_: handle, username, socials array, profile.

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
`submitted`, or — where the restaurant releases cash orders immediately
— advances straight out of it like a submitted round) and per-station
completion timestamps (`kitchenReadyAt`, `barReadyAt`). `served` stays
terminal — a served order cannot be cancelled.
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
An `Order` committed by the diner for in-person payment. By default,
visible only to staff — never on the kitchen rail — until staff mark it
paid and release it. A restaurant can flip
`releaseCashOrdersImmediately` (ADR 008 addendum, TAVLI-81, default
off), after which such a round advances exactly like a submitted one,
appears on the rail, and carries a persistent **to collect** badge
through every status until staff collect. It still owes money either
way: the debt is `awaitingPaymentAt` with no `paidAt`, and it blocks
visit close-out until settled.
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
One station's portion of an `Order`, as shown on that station's
dashboard when exactly one station is selected: only that station's
live items, and only the actions it can take on them. A projection
rendered at read time — there is no such document, and the `Order`
remains the unit of payment, cancellation, and history. See ADR 007.
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
The orders dashboard consumes that assignment: its "My section" scope
shows only the `Orders` seated at tables in the sections the caller
covers right now.
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
rendered on the **Timeline**, and bounds which start times are **bookable**:
a reservation must start at or after `openTime` and _end_ at or before
`closeTime`. Because the whole reservation must fit, a 90-minute turn against
a `23:00` close makes `21:30` the last bookable slot. Staff creates may book
outside these hours (private events); customer and **WhatsApp assistant**
creates may not. A close at or before the open (e.g. `18:00`–`02:00`) is an
overnight window, and an after-midnight booking belongs to the previous
service day. Falls back to `10:00`–`23:00` when unset.
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
A terminal reservation status (with an optional reason) that frees the table
for availability checks. Reachable two ways: by **staff** from the **Timeline**
or the detail drawer, from any non-terminal status; or by the booking's own
**Contact phone**, through the **WhatsApp assistant**, limited to `pending` and
`confirmed` bookings that have not yet started — a `seated` guest is at the
table and cannot cancel from their phone. The same customer may **move** a
booking (`reservations.rescheduledByCustomer`), which patches the existing row
in place rather than cancelling and re-creating it; both actions need the
customer to echo back a confirmation code. The staff path records
`reservations.cancelled`; the customer path records
`reservations.cancelledByCustomer` and a fixed reason, so the two are
distinguishable when a cancellation is disputed.

**Reopen**:
A staff action that moves a terminal reservation (`cancelled` or `no_show`)
back into the active lifecycle — usually as `confirmed`, or directly as
`seated` when the guest has arrived. Distinct from **Reschedule** on bookings
that are already active.

**Contact phone**:
The phone number on a `Reservation`'s `contact`, in E.164. For a customer
reaching the **WhatsApp assistant** there is no `User` and no account, so this
number — taken from Twilio's signature-verified sender — is their entire
identity, and the only scope for which bookings they may see or cancel. Stored
canonically (E.164, via `_util/phone.ts`) on every write path, because it is
matched by exact index lookup: `811 490 6208` typed by staff and
`+5218114906208` delivered by WhatsApp are one customer, not three. It is
therefore an authorization input, not just contact data: an assistant tool never
receives a reservation id, and a booking is always resolved server-side from
`(Restaurant, contact phone)`. _Avoid_: customer id, guest id.

### WhatsApp assistant

**WhatsApp assistant**:
The LLM first responder on **Tavli's** WhatsApp number. Answers menu questions,
checks availability, and requests or cancels bookings on behalf of the customer
messaging it. Tavli is the sender for every restaurant (ADR 012), so the diner
sees one contact — "Tavli" — however many restaurants they talk to. An inbound
message passes a fixed **gate order** before the model is ever called: Twilio
signature → **Opt-out** state and keywords → **Confirmation code** → routing →
restaurant status (deleted/inactive) → subscription standing → **Daily message
cap** / **Platform ceiling** → the model. _Avoid_: chatbot, agent. ("bot"
survives as a code-internal synonym — `runBotTurn`, `RESERVATIONS_BOT_TOKEN`.)

**Channel**:
The record that a `Restaurant` is **enabled** for the **WhatsApp assistant**,
carrying its **Restaurant code** and its default reply locale. It is **no
longer** a phone number mapped to a restaurant: there is one shared Tavli
number, so the number a message arrives at identifies nobody (ADR 012).
Enabling is platform-admin only. _Avoid_: number, line, integration.

**Restaurant code**:
The six-character reference — `VRN-8F3` — that routes an inbound WhatsApp
message to one `Restaurant`. It rides in the `wa.me` deep link's prefilled
text, which WhatsApp shows the diner in their message box, so it reads like a
booking reference rather than a URL fragment (which is why it is deliberately
not the **slug**). It is a **router, not a secret**: guessing one reaches a
restaurant's public assistant, the same thing the QR on its tables offers.
_Avoid_: token, key, ID.

**Conversation**:
The message thread between one customer phone and one `Restaurant`.
Deliberately **not** "Session" — that word means an open ordering tab at a
table. The diner experiences one continuous chat with Tavli; underneath, each
restaurant gets its own **Conversation**, so no restaurant ever sees another's
messages and no turn replays two restaurants' menus to the model.

**Cold start**:
An inbound WhatsApp message carrying no **Restaurant code**. It binds to the
one enabled `Restaurant` this phone has messaged in the last 30 days; failing
that, to the `Restaurant` that minted a still-live **Confirmation code** the
message carries; failing that, it gets fixed bilingual copy pointing back at
the deep link, with no model call. Tavli deliberately never matches a
restaurant _name_ the diner typed: that is an enumeration and spoofing surface
(ADR 012).

**Confirmation code**:
A short server-generated number the **WhatsApp assistant** sends when a
customer asks to cancel. The cancellation happens only when the customer
replies with the code, and that match is made before the model is consulted —
so a destructive action always requires a fresh act from the phone's owner.
Single-use, expires in 10 minutes. Because the assistant asks for it as six
bare digits, it also routes its own reply on a **Cold start** — but only back
to the phone Tavli minted it for, which is why it is not the **Restaurant
code**'s job. Not to be confused with the **Restaurant code**, which routes and
never authorizes anything. _Avoid_: OTP, PIN (that is the employee credential),
token.

**Daily message cap**:
The number of messages the **WhatsApp assistant** will handle for one phone in
24 hours — 25 inbound, 75 outbound — counted per phone across every
**Channel** it reaches, because the phone is what costs money. Past it the
assistant sends one notice and then goes quiet. A **Confirmation code** is
exempt: it is matched before the model runs, costs nothing, and refusing one
would leave a booking silently un-cancelled. Separate from the hourly write
budget, which guards reservation data rather than spend. _Avoid_: quota,
throttle, rate limit (that is the mechanism, not the rule).

**Platform ceiling**:
The messages the assistant will handle across all **Restaurants** in 24 hours
(5,000). Past it every customer gets fixed copy and the model is not called.
Ops are warned by email at 80%, once per ceiling window — the warning's budget
is anchored to that window, not to a day of its own, so a day that reaches 80%
sooner than the last one still reports.

**Spend allowlist**:
Phones exempt from the **Daily message cap** — the operator's own handset and
supervised testing numbers. Org-level and platform-admin-only: an entry waives
a control on Tavli's own bill, not on anything a **Restaurant** owns. It
exempts the caps and nothing else. The operator's own number adds itself on its
first inbound message, so no deployment starts with it capped; removing it
sticks. _Avoid_: whitelist, VIP list.

**Awaiting confirmation**:
A booking made by the **WhatsApp assistant** is `pending` with no `tableIds`
until staff **confirm** it and assign tables. The assistant must never tell a
customer a table is held. Note the guest name on such a booking is
best-effort — the name the customer stated, else their WhatsApp profile name,
else fixed copy — so staff should not treat it as verified.

**Opt-out**:
A phone's standing revocation of consent (WhatsApp Business Messaging Policy).
Sending STOP, BAJA, or ALTO as the whole message — a keyword buried in prose
is conversation, not consent — earns one confirmation saying how to return,
then permanent silence: an opted-out phone costs nothing and receives nothing,
which is why the check sits above every budget. Keyed to the canonical phone,
never per **Restaurant** — the diner opts out of the number (ADR 012). START
or ALTA reverses it. History is kept; only sending stops.

The revocation is recorded unconditionally — that is the policy duty — and so
is the confirmation that says how to return, because the phone most likely to
send STOP is the one already deep into its **Daily message cap**. That reply is
still a billed message: it stops at the **Platform ceiling** and at the phone's
outbound cap, and a transition still spends one inbound message. What it does
not do is wait for inbound headroom. Alternating STOP and START stays bounded
one step higher instead: a second opt-out confirmation needs an opt-in first,
and re-opting in is refused once the phone's inbound cap is spent — the one
consent step a budget may refuse, because leaving the phone opted out is the
silent direction. Past the cap a phone therefore buys at most one more
confirmation, not an unbounded stream of free replies and permanent audit rows.

The converse record, the **opt-in**, is the diner's own first message: each
**Conversation** stamps when it happened and whether a deep link or a **Cold
start** brought them. _Avoid_: unsubscribe, blacklist, block.

**Retention**:
WhatsApp message bodies live 90 days (`WHATSAPP_MESSAGE_RETENTION_MS`), then
an hourly batched sweep deletes them — LFPDPPP data minimization; the number
is a product/legal decision held in one place. Messages only: the
**Conversation** outlives its messages because it carries the opt-in consent
record and is the spine of the staff view. _Avoid_: archive, cleanup (this is
a legal lifetime, not tidying).

## Relationships

- A **Restaurant** has at most one **Channel** — its WhatsApp enablement —
  and many **Conversations**, one per customer phone. A **Conversation**
  relates to **Reservations** only through the shared **Contact phone**, never
  by a foreign key.
- A **Restaurant** has one **Public profile**. Every part of it is optional and
  independently omitted from the diner-facing surfaces when unset.
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
- "theme" means **only** the viewer's light/dark preference, and nothing else.
  Per-restaurant visual customization (colours, fonts, logo, header image) is a
  separate concept that will be called **Branding** when it lands — it composes
  with theme rather than replacing it, since a restaurant's colour has to work
  in both modes. Never say "restaurant theme".
- "address" is overloaded. The **Public profile**'s address is where diners
  walk in; `fiscalAddress` is the legal invoicing address printed on the
  receipt's tax block. They are often the same string and are never the same
  field.
- "waiter" appears in product tickets and stakeholder language (e.g. the
  dashboard's "waiter performance"). The canonical term is **Server** — the
  `ShiftRole.SERVER` who is credited for sales via
  `orders.attributedMemberId`. Use **Server** in code and the English UI;
  "waiter" is an external synonym only.
