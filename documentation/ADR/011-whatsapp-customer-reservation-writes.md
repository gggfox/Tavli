# ADR-011: Phone-Number Identity for Customer Reservation Writes over WhatsApp

## Metadata

| Field             | Value         |
| ----------------- | ------------- |
| **Status**        | Accepted      |
| **Date**          | 2026-07-25    |
| **Author(s)**     | Jorge Almazan |
| **Supersedes**    | —             |
| **Superseded by** | —             |

## Context

[ADR-010](./010-whatsapp-assistant.md) shipped the WhatsApp assistant as a **read-only** first responder, and said so explicitly: _"it cannot book, order, or take payment, so a prompt-injection at worst produces a wrong-but-harmless reply."_ Every other safety property of that feature was a corollary of that one sentence — which is why the code had no inbound sanitization, no per-phone write limiting, and no adversarial tests.

Customers ask to book. Telling them to call, or handing them a web link, throws away the channel they chose. So the assistant needs to write — and the read-only argument has to be replaced rather than quietly dropped.

The hard part is that **a WhatsApp customer has no account.** The closest precedent in the codebase, `_util/dinerSession.ts`, proves ownership by checking that a Clerk subject is a member of a session (`requireOwnedActiveSession`), and deliberately collapses 403 into 404 "to avoid ID enumeration". None of that transfers: there is no Clerk subject to check.

What we do have is Twilio's signature-verified `From` field. That makes `reservations.contact.phone` — already required, already indexed as `by_phone: (restaurantId, contact.phone)` — the only available identity.

The threat that shapes everything below: **the author of a message is not always the phone's owner.** A customer forwards a flyer someone sent them. A dish description, produced by an LLM parsing an uploaded PDF in `menuImport.ts`, reaches every customer's context. An injection stored in `whatsappMessages` is replayed for the next twelve turns. In each case a third party's text arrives under a verified phone. So "scoped to the sender's phone" alone does not make a write self-harm — it can be a third party mutating the victim's booking, which is exactly the risk we care about.

## Decision

Customer-initiated reservation writes are authorized by the **signature-verified sender phone number**, under five rules.

**1. Identity comes from the transport, never from the model.** `runBotTurn` takes a frozen per-turn `BotActor { restaurantId, customerPhone, conversationId, messageSid }`, built in `processing.ts` from the webhook fields. Tools read it from the closure. No tool has a parameter that can influence it.

The tool object must stay inside `runBotTurn`. Convex reuses Node isolates across action invocations, so hoisting it to module scope — where `openrouter` and `getModel` legitimately live — would capture the first request's actor and silently authorize every later turn in that isolate as that customer. A concurrency test pins this.

**2. No tool accepts a `reservationId`.** Targets resolve server-side through `findUpcomingByPhone`, an index equality on `(restaurantId, contact.phone)`. There is no id to forge and no id oracle to probe. This also neutralizes a pre-existing leak: `idempotencyKey` is scoped only `(restaurantId, key)`, so a guessed key on the create route returns another customer's `reservationId`.

**3. Destructive actions need an out-of-band code.** `request_cancel` and `request_reschedule` mutate nothing. It stores a `whatsappPendingActions` row with a CSPRNG code and a 10-minute TTL, and returns the code. The cancellation happens only when a **later inbound message** carries that code, matched by string comparison in `processing.ts` _before_ the model runs.

This is the rule that answers the threat above. Forwarded content, poisoned menu text, and stored injections are each a single-shot influence over one turn's tool calls; none can produce a second inbound message containing an unguessable value. A "reply YES" step would be theater — injected text can simply contain "YES".

**4. Creation is a request, not an acquisition.** Bookings land `pending` with `tableIds: []`; staff `confirm` and assign tables. The assistant can ask for a table, never take one. (Cancelling and moving _do_ release a confirmed table, which is why those two carry the code and booking does not.)

**Moving is one operation, not cancel-then-rebook.** A customer asking to change a time must never end up with no table: cancel-then-rebook is not atomic across two WhatsApp messages, and the new slot may be gone by the time the old one is released. `request_reschedule` stores the requested `newStartsAt` on the pending row, so the code authorizes the exact move the customer was quoted, and the slot is re-validated again at redemption — a code stays live for ten minutes and the floor can fill in that time. The booking is patched in place, keeping its identity and its `pending` status, and records `reservations.rescheduledByCustomer`.

**5. Tool arguments and results are both narrowed.** Results are allowlisted projections carrying local `YYYY-MM-DD`/`HH:MM` strings, never `Doc`s, ids, or epoch ms — the reasoning of `toDinerVisiblePayment`. On the input side the model may not supply `contact.email` at all: the attempt limiter keys partly on email and is shared across sources, so a model-supplied address could burn a stranger's budget and lock them out of the public web form. `cancelReason` is a server-set constant.

Supporting controls: a per-turn write budget claimed **synchronously**, before the tool's first `await` (`stepCountIs` bounds steps, and one step can carry many parallel tool calls — decrementing after the round trip is a check-then-act race that hands out as many writes as are asked for); a per-phone hourly write limit, since cancellation had none; `idempotencyKey` derived from `messageSid` **plus the request shape**; server-composed confirmation lines appended to every reply; and `sanitizePromptValue` over `restaurantName` and menu text.

## Consequences

### Positive

- A customer can book and cancel in the channel they already use, with no account.
- The authorization decision for the destructive action is a string comparison, not a language-understanding problem — it does not degrade when the model does.
- Because a booking is only a request, the worst outcome of a successful injection on the create path is a junk `pending` row a human declines.
- The properties are enforced by tests that fail on regression (empty tool schema, exact projection key sets, cross-actor concurrency) rather than by review discipline.

### Negative

- Cancelling and moving each take two messages. Some customers will not send the code and will assume the change happened.
- Phase 1 only lets customers cancel `source: "whatsapp"` bookings, so a booking made on the web cannot be cancelled by the same person over WhatsApp. Deliberate: see the alternatives.
- A per-turn budget of one write means "book Friday and Saturday" needs two messages.
- More moving parts: a new table, a cron, and a pre-LLM branch in `processing.ts`.

### Neutral

- The read-only claims in `llm.ts`, `constants.ts`, `schema.ts` and `processing.ts` were specifications, not stale prose, and were rewritten as part of this change.
- `normalizePhone` strips the `whatsapp:` prefix and trims; it does not canonicalize to E.164. Twilio's inbound `From` is already canonical, so the bot side is exact, but a staff-typed `600 111 222` will not match. That fails **closed** — a UX gap, not a hole.
- `/whatsapp/inbound` now rejects a `From` without the `whatsapp:` prefix, so a spoofed SMS caller ID cannot normalize to the same identity string.

## Alternatives Considered

### Option 1: Pass a `reservationId` to the tool and validate ownership server-side

Let the model name the booking; check `contact.phone` matches after loading it.

**Pros:**

- Simpler tool ergonomics; the model can disambiguate directly.

**Cons:**

- Makes id enumeration part of the attack surface, and ids already leak via `idempotencyKey` probing.
- The safety property becomes a single `if` that a future refactor can drop without any test noticing.

**Why not chosen:** an argument that cannot exist cannot be misused. Removing the parameter is a structural guarantee; a validation check is a convention.

### Option 2: OTP or magic-link step-up before any write

Send a one-time code (or a signed link) before booking as well as cancelling.

**Pros:**

- Strongest possible proof of phone control on every write.

**Cons:**

- Disproportionate for a `pending` row that staff confirm anyway.
- Roughly halves booking completion for the sake of an action that is already reversible.

**Why not chosen:** applied only where it pays for itself — cancellation, which is destructive and releases a real table.

### Option 3: Allow cancelling any reservation matching the phone, regardless of source

Widen phase 1 beyond `source: "whatsapp"`.

**Pros:**

- A customer can manage bookings made through any channel from one place.

**Cons:**

- Phone numbers on staff-entered rows are not an identity: walk-in placeholders, hotel and concierge numbers used for many guests, "booked under my partner's number". Phone equality would become a multi-tenant key.

**Why not chosen:** a deliberate false-negative bias. Some customers are told to call, which is the right trade against the failure mode of cancelling a stranger's table. Revisit once phones are stored canonically.

> **Status (2026-08-23):** that precondition is now met — every write path canonicalizes through `normalizeContactPhone` and existing rows are backfilled — so the scope restriction is the only thing still holding this closed. The objection above has not gone away, though: a canonical number makes staff-entered rows _matchable_, not _identity_. A concierge desk number or a walk-in placeholder now matches cleanly across every booking taken under it. Widening phase 1 is a product decision, not a follow-on of this change.

### Option 4: A signed opaque booking token minted in the tool result

Return a short-lived handle the model passes back on the cancel call.

**Pros:**

- Removes the model-supplied `startsAt` disambiguator.

**Cons:**

- Extra machinery that buys nothing over phone scoping plus the confirmation code, since the code already gates the mutation.

**Why not chosen:** the code is the capability. A second capability layer above it is redundant.

## Implementation

```
inbound ─▶ verify signature ─▶ ingest
             │
             ├─ body contains a 6-digit code?
             │     └─▶ internalConsumeCancelCode  ← authorization decision, NO model
             │             single-use · expiring · conversation+phone scoped
             │             re-derives ownership on the loaded doc
             │
             └─ otherwise ─▶ runBotTurn(frozen BotActor)
                    tools: lookup_menu · get_dish_photo · check_availability
                           list_my_reservations (no args)
                           book_reservation  ─▶ pending, staff confirm
                           request_cancel    ─▶ mints a code, mutates nothing
                    ─▶ reply = model prose + server-composed fact lines
```

Key files: `convex/whatsapp/{llm,processing,reservations,datetime,copy}.ts`, `convex/reservations.ts` (`internalCancelByPhone`), `convex/reservationHelpers.ts` (`findUpcomingByPhone`, `cancelReservationCore`), `whatsappPendingActions` in `convex/schema.ts`.

Audit: customer cancellations write `reservations.cancelledByCustomer` with `userId: AUDIT_ACTOR.WHATSAPP_CUSTOMER` — not `"system"`, which is the no-show cron, and not the phone number, since `allEvents` is append-only, indexed on `userId`, and has no purge path. Identifying details go in `payload` as `conversationId`/`messageSid` pointers into purgeable tables, so erasure still works.

## References

- [ADR-010: WhatsApp Assistant as a Twilio-Backed LLM First Responder](./010-whatsapp-assistant.md)
- [ADR-006: Managed employee accounts and shared session identity](./006-managed-employee-accounts.md) — the other place identity exists without a Clerk account
- `convex/_util/dinerSession.ts` — the IDOR patterns this adapts
- `convex/_tests/reservationCustomerCancel.test.ts`, `convex/_tests/whatsappReservationTools.test.ts`
- `CONTEXT.md` — **Contact phone**, **Cancellation**

---

## Change Log

| Date       | Author        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-25 | Jorge Almazan | Initial version                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-08-23 | Tavli team    | Contact phones are canonicalized on every reservation write path (staff, public form, bot API, assistant) via `_util/phone.ts`, and existing rows backfilled by `migrations/backfillContactPhone`. This is the precondition Option 3 was waiting on; the phase-1 source restriction is unchanged and still deliberate.                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-23 | Tavli team    | `request_reschedule` added under the same code-confirmed model, so changing a booking is one in-place move rather than a cancel followed by a rebook. Customer identity is now the canonical E.164 (`toCanonicalE164`), because WhatsApp's Mexican mobile `+521` form never matched the same person's bookings from any other channel. Per-turn write budget claimed before the first `await` — parallel tool calls in one step were bypassing it. Server-composed notice lines are stored apart from the model's prose (`whatsappMessages.modelBody`) and no longer replayed as context: shown its own past replies with the ✅ lines attached, the model imitated them and invented placeholders for a code it never sees. |
