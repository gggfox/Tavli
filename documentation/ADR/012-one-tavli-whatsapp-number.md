# ADR-012: One Tavli WhatsApp Number, with Per-Restaurant Sending Later

## Metadata

| Field             | Value      |
| ----------------- | ---------- |
| **Status**        | Accepted   |
| **Date**          | 2026-08-23 |
| **Author(s)**     | Tavli team |
| **Supersedes**    | —          |
| **Superseded by** | —          |

## Context

[ADR-010](./010-whatsapp-assistant.md) shipped the assistant on the assumption that each restaurant would eventually own a WhatsApp sender, and routed on it: an inbound message's Twilio `To` number looked up a `whatsappChannels` row, which named one `Restaurant`. It even said so in its own Neutral section — _"the Twilio Sandbox's shared number means per-restaurant routing is unexercised outside tests until real senders are registered."_ Those senders were never registered, and the reasons are not ours to fix on a product timeline.

**Meta retired the On-Behalf-Of (OBO) model for WhatsApp Business Accounts on 29 September 2025.** Under OBO, a solution provider could create and hold a WABA on a client's behalf, and onboard a restaurant without that restaurant ever touching Meta Business Manager. That path is gone. What replaced it — Embedded Signup — requires the client to have their own Meta business portfolio, complete business verification, and grant access. For a taquería with no Business Manager account and no interest in acquiring one, that is not a signup flow; it is a project.

**A WABA belongs to exactly one business portfolio.** It is not a container that can be partitioned per client. Giving fifty restaurants their own sender identity means fifty WABAs in fifty portfolios, each verified separately, each with its own phone number to buy and register — not fifty rows in a table.

**There is no per-conversation branding primitive.** WhatsApp shows the sender's display name and profile photo, both properties of the phone number, both reviewed by Meta. Nothing in the API lets one number present itself as "Vernáculo" in one thread and "El Sol" in the next. If Tavli sends, the diner sees Tavli.

So the choice is: block the feature on an onboarding flow restaurants will not complete, or send as Tavli. This ADR takes the second, and records what that costs.

The moment Tavli is the sender, **the `To` number identifies nobody** — every restaurant's diners arrive at the same number — and the routing decision that ADR-010 made has no input left.

## Decision

**Tavli is the sender.** One WhatsApp number, Tavli's own display name, for every restaurant. Per-restaurant senders are a later migration for restaurants that want one and can complete Embedded Signup, not a prerequisite for shipping.

**A restaurant is identified by a short code carried in a deep link.** Each enabled restaurant gets a six-character code — an abbreviation of its name plus a random tail, `VRN-8F3` — generated once and stored. The entry point is `wa.me/<tavli-number>?text=…`, where the prefilled text reads:

> Hola, quiero información sobre Vernáculo · VRN-8F3

WhatsApp drops that text into the diner's message box, **visible and editable**, before they send it. That single fact drives the format:

- It has to read like a sentence a person would send. A bare identifier looks like a scam and gets deleted.
- It is deliberately **not the slug**. `vernaculo-centro` in a chat message reads like a URL fragment someone pasted by mistake.
- Every code carries a digit. Without that rule the 3+3 shape matches "quiero" and "cuenta", and every inbound message in Spanish becomes a router lookup.

The code is stripped from the stored message body and from what the model is shown, but only once it has actually resolved — a token that merely looked like a code stays in the diner's own words.

**The code is a router, not a secret.** Guessing one reaches a restaurant's public assistant, which is exactly what the QR taped to its tables offers to anyone who walks in. There is therefore no entropy budget, no hashing, no rate limit around the code itself, and a report that codes are guessable is not a vulnerability report. Treating it as a credential would be theatre that buys nothing and costs readability, which is the one property that matters when a diner is retyping it off a printed card.

**A `Conversation` is per (customer phone, restaurant).** The diner sees one continuous thread with Tavli. Underneath, each restaurant has its own conversation, its own history, its own staff view. A single interleaved thread was never an option: it would show one restaurant another restaurant's messages, and it would replay two restaurants' menus into the model's context for one turn.

**Cold start — a message with no code — has exactly two outcomes.** If this phone has messaged exactly one enabled restaurant in the last 30 days, bind to it; that is the normal case from the second message onwards. Otherwise send a fixed bilingual reply, with **no model call**:

> Soy el asistente de Tavli. Para ayudarte, abre el enlace de WhatsApp del restaurante o escanea su código QR.

Bilingual because an unroutable message has no restaurant, therefore no `defaultLocale` and no `defaultLanguage` — every input that would normally pick a language is precisely the input that is missing.

**Tavli deliberately does not match a restaurant name the diner types.** This is a hard rule, not an unimplemented nicety. Name matching across every restaurant on the platform is an enumeration oracle ("is X on Tavli?") and a spoofing surface (a near-match sends a diner's booking to a competitor). An unknown code and a disabled restaurant are answered with the same fixed copy, so neither reveals whether a restaurant exists.

**`whatsappChannels` changes meaning.** It is no longer "a phone number mapped to a restaurant"; it is "this restaurant is **enabled**, with this code and this default locale". `phoneNumber` is retired.

**Enabling is platform-admin only** — `getCurrentUserId` then `requireAdminRole`, the same gate as `convex/featureFlags.ts`. Not self-serve: every enabled restaurant is spend on Tavli's own Twilio and OpenRouter accounts, and the subscription gate that would make it the restaurant's own cost does not exist yet (TAVLI-95). Reading is wider — a manager sees the link, the code and the QR, because they are the person who prints it.

## Consequences

### Positive

- The feature ships. No restaurant has to create a Meta business portfolio or pass business verification to get an assistant.
- One number to buy, register, warm up and keep compliant, instead of one per restaurant.
- Onboarding a restaurant is one admin mutation, not a multi-day identity process.
- Per-restaurant conversations mean a restaurant's staff view and the model's replayed context are both scoped by construction, which is a property per-number routing gave for free and which we would otherwise have lost.
- The diner keeps one thread with one contact, however many Tavli restaurants they talk to.

### Negative

- **Quality rating and enforcement are shared, and this is accepted deliberately.** WhatsApp scores a phone number, not a tenant. One restaurant whose diners repeatedly block or report the assistant drags the rating down for every restaurant on the number, and Meta's escalation path — reduced messaging limits, then restriction of the number — applies WABA-wide. There is no per-restaurant blast radius until per-restaurant senders exist. We are taking this risk knowingly, on a small pilot, where the number of restaurants is small enough to watch by hand.
- The diner sees "Tavli", not the restaurant's name, in their chat list. The assistant says which restaurant it is answering for, but the contact is ours.
- A first contact that carries no code gets a fixed reply rather than an answer. Someone who saves the number and messages it cold next month is told to use the link again.
- The 30-day binding window is a heuristic. A diner who talked to two restaurants gets the fixed reply even when what they meant is obvious to a human reader.
- A code printed on a table can be photographed and used by someone who never visits. That is the same exposure as the QR itself, and is accepted.

### Neutral

- `shortCode` is `v.optional` in the schema **only** so rows written before this ADR still validate; `migrations/backfillWhatsappShortCodes` stamps them and clears the dead `phoneNumber`. Every write path sets it.
- Conversations need no backfill at all: they already carry a denormalized `restaurantId`, which is exactly what the new `by_restaurant_customer` index routes on. The stale `channelId` on an old row still points at the same (now differently-meaning) enablement row, and the next inbound message refreshes it. This was the deciding factor in keeping the old rows addressable rather than migrating them — there was nothing to migrate.
- The `To` number is still validated at the webhook (a signed Twilio request always carries one) but is no longer forwarded to the processing action, so nothing downstream can route on it by accident.
- WhatsApp's 24-hour freeform window is unchanged: the assistant only ever replies inside it.
- The unroutable reply is metered by the spend controls (TAVLI-91) like any other outbound message, and the budget is charged **before** routing rather than after it. On one shared number an unroutable message can come from anyone at all, so a fixed reply to every stranger would otherwise be an unmetered relay on Tavli's own Twilio account. Over budget, or past the platform ceiling, an unroutable sender gets silence rather than a notice: there is no conversation to record one against and no relationship to preserve.

## Alternatives Considered

### Option 1: Per-restaurant WhatsApp senders (what ADR-010 assumed)

Each restaurant registers its own number and WABA; routing stays on the Twilio `To`.

**Pros:**

- Diners see the restaurant's own name and photo — the strongest possible signal that this is really their taquería.
- Quality rating, messaging limits and enforcement are per restaurant. One bad actor cannot take the platform down.
- No routing problem at all: the number _is_ the identity.

**Cons:**

- Requires each restaurant to own a Meta business portfolio and pass business verification, since OBO was retired on 29 Sep 2025.
- A phone number per restaurant to procure, register and warm up.
- Onboarding becomes a multi-day process gated on a third party's review queue, for a restaurant whose actual goal is to answer "do you have tables tonight".

**Why not chosen:** not rejected — **deferred**. It is the better end state and remains the migration path for restaurants that want it. It is simply not something a pilot restaurant can complete this month, and blocking on it means shipping nothing.

### Option 2: Route on the restaurant name the diner types

Read the message, match it against every restaurant on the platform, pick the best.

**Pros:**

- Nothing to print, nothing to scan, no code to retype. The most forgiving possible entry.
- Handles a diner who saved the number months ago.

**Cons:**

- An enumeration oracle: anyone can probe the platform's whole customer list one message at a time.
- A spoofing surface: two restaurants with similar names, and a near-match quietly routes a booking to the competitor. The diner has no way to notice.
- Fuzzy matching over an untrusted string is exactly the kind of decision this feature has spent two ADRs moving _out_ of the model's hands.

**Why not chosen:** rejected outright, and pinned by a test. The convenience is real and does not come close to paying for the two holes.

### Option 3: One interleaved conversation per phone

Keep the diner's single thread as a single `Conversation` row, tagging each message with the restaurant it was for.

**Pros:**

- Matches what the diner actually sees.
- One row, one history, no routing on the storage side.

**Cons:**

- The restaurant's staff view would show them another restaurant's messages. That is a data-sharing bug, not a UI wrinkle.
- The model's replayed context would carry two restaurants' menus into one turn, which is how an assistant ends up quoting a competitor's price.
- Filtering at read time would put the correctness of both of those on every future caller remembering to filter.

**Why not chosen:** the thing the diner sees and the thing we store do not have to be the same shape, and here they must not be.

### Option 4: The restaurant slug as the routing token

`wa.me/<number>?text=vernaculo-centro`.

**Pros:**

- No new identifier, no generation, no collision handling. It already exists and is already unique.

**Cons:**

- Reads like a URL fragment in a chat message. A diner sees it in their message box before sending and it looks like something went wrong.
- Slugs are renameable; a rename would silently break every printed QR.
- Long slugs make the prefilled sentence awkward, and the sentence is the whole point.

**Why not chosen:** the code exists to be read by a human in a message box, which is a different job from the one a slug does in a URL.

## Implementation

```
wa.me/<tavli-number>?text=Hola, quiero información sobre Vernáculo · VRN-8F3
        │
        └─ Twilio ──▶ /whatsapp/inbound (To validated, NOT forwarded)
                          │
                          ▼
              handleInboundMessage ──▶ resolveRoute
                                          │
                    ┌─────────────────────┼──────────────────────┐
              short code in body     no code / unknown code       │
                    │                     │                      │
          getEnabledChannelByShortCode   getRecentRoutesForPhone (30d)
                    │                     │                      │
                    │            exactly one enabled ──┘         │
                    │                     │                 otherwise
                    ▼                     ▼                      ▼
              strip code from body   bind to that restaurant   fixed bilingual
                    └──────────┬──────────┘                    copy, NO model call
                               ▼
              ingestInbound → conversation for (phone, restaurant)
                               ▼
                        confirmation code? → LLM turn → reply
```

Key files: `convex/whatsapp/shortCode.ts` (generate, extract, strip, deep link), `convex/whatsapp/processing.ts` (`resolveRoute`), `convex/whatsapp/data.ts` (`getEnabledChannelByShortCode`, `getRecentRoutesForPhone`, `ingestInbound`), `convex/whatsappChannels.ts` (admin enablement, public link by slug), `convex/whatsapp/copy.ts` (`deepLinkPrefill`, `deepLinkWelcome`, `getUnroutableGuidance`), `convex/migrations/backfillWhatsappShortCodes.ts`, `whatsappChannels` / `whatsappConversations` in `convex/schema.ts`.

Distribution: `src/features/whatsapp/` renders the link, the code and a printable QR; mounted in restaurant Settings (`WhatsappAssistantSection`) and on the public menu page (`WhatsappAssistantLink`). QR encoding is `uqr` (MIT, zero runtime dependencies), wrapped in one `qrSvgMarkup` so the on-screen code and the printed sheet cannot drift.

Tests: `convex/_tests/whatsappShortCode.test.ts` (format, extraction, stripping, round trip), `convex/_tests/whatsappRouting.test.ts` (routing, per-restaurant isolation, cold start, the name-matching refusal, the admin gate).

## References

- [ADR-010: WhatsApp Assistant as a Twilio-Backed LLM First Responder](./010-whatsapp-assistant.md) — supersedes its `To`-number routing and its "one sender number per restaurant" domain model
- [ADR-011: Phone-Number Identity for Customer Reservation Writes over WhatsApp](./011-whatsapp-customer-reservation-writes.md) — unchanged: identity is still the signature-verified sender phone
- `CONTEXT.md` — **Channel**, **Restaurant code**, **Conversation**
- [WhatsApp Business Platform: Embedded Signup](https://developers.facebook.com/docs/whatsapp/embedded-signup)
- [WhatsApp Business Platform: quality rating and messaging limits](https://developers.facebook.com/docs/whatsapp/messaging-limits)

---

## Change Log

| Date       | Author     | Description                                                                                                                                                                                                                                                      |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-23 | Tavli team | Initial version. Tavli becomes the sender on one shared number; routing moves from the Twilio `To` to a per-restaurant short code in a `wa.me` deep link; conversations become per (phone, restaurant); the shared quality-rating risk is accepted deliberately. |
