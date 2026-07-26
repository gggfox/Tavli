# ADR-007: WhatsApp Assistant as a Twilio-Backed LLM First Responder

## Metadata

| Field             | Value         |
| ----------------- | ------------- |
| **Status**        | Accepted      |
| **Date**          | 2026-07-25    |
| **Author(s)**     | Jorge Almazan |
| **Supersedes**    | —             |
| **Superseded by** | —             |

## Context

Restaurants field the same questions over WhatsApp all day — what's on the menu, what a dish costs, what it looks like, whether there's a table. Answering them consumes staff attention during service, and slow replies lose bookings.

WhatsApp is the dominant messaging channel in the target market (Mexico), so the channel choice was not in question. What needed deciding was how a message becomes an answer, and under what safety envelope.

Three constraints shaped the design:

1. **Twilio's webhook timeout is ~15 seconds.** An LLM turn with tool calls routinely exceeds that.
2. **Convex splits its runtime.** The `twilio` SDK needs Node's `crypto`, and the Vercel AI SDK provider needs `"use node"` — but an HTTP router cannot live in a Node module.
3. **Every inbound message is attacker-controlled text reaching a language model.** The product has no prior art for an untrusted-input LLM surface other than menu import (`convex/menuImport.ts`).

This ADR was referenced by `convex/http.ts`, `convex/constants.ts`, and `convex/schema.ts` before it existed; those citations pointed at a decision that was never written down.

## Decision

The assistant is a **read-only first responder**: it answers menu questions grounded in tool output and captures nothing else. It is built as a signature-verified webhook that fast-acks and defers work to a scheduled action.

**Request path.** `POST /whatsapp/inbound` (`convex/http.ts`) verifies `X-Twilio-Signature`, rejects a forged request with 403, schedules `internal.whatsapp.processing.handleInboundMessage` via `scheduler.runAfter(0, …)`, and returns empty TwiML immediately. The reply is sent out-of-band through Twilio's REST API rather than in the webhook response.

**Runtime split.** The router stays in Convex's default runtime. Signature verification is a separate `"use node"` action (`whatsapp/twilioValidation.ts`) that the router awaits, so a forged request still gets a synchronous 403 while the slow LLM turn stays off the request path. Database reads/writes (`whatsapp/data.ts`, `whatsapp/menu.ts`) and the outbound send (`whatsapp/outbound.ts`, plain `fetch`) also stay in the default runtime; only `llm.ts` and its caller `processing.ts` are Node.

**Domain objects.** A `whatsappChannels` row maps one WhatsApp sender number to one `Restaurant`, which is how an inbound message is routed. A `Conversation` is the thread between one customer phone and one channel. `whatsappMessages` is an append-only log deduped on Twilio's `MessageSid`.

**"Conversation", deliberately not "Session".** `Session` already means an open ordering tab at a table (see `CONTEXT.md`). Reusing it would collide two unrelated lifecycles in the glossary and in code.

**Model access.** The Vercel AI SDK against OpenRouter, sharing `OPENROUTER_API_KEY` with `convex/menuImport.ts`. Model is `WHATSAPP_MODEL`, defaulting to a cheap slug so per-message cost stays low. The tool loop is capped at `WHATSAPP_MAX_LLM_STEPS` and context at `WHATSAPP_CONTEXT_MESSAGE_LIMIT` recent messages.

**Safety envelope.** The model is given only read-only tools and told to ground every answer in their output. It cannot book, order, or take payment — so a prompt injection produces at worst a wrong-but-harmless reply. This is the load-bearing assumption behind every other safety property of the feature.

**Output formatting.** WhatsApp is not Markdown: bold is `*one asterisk*`, there are no headings, and unsupported syntax reaches the customer as raw characters. `whatsapp/format.ts` converts model output deterministically, because prompt instructions alone do not hold.

## Consequences

### Positive

- Customers get an instant answer; staff attention is not consumed during service.
- The fast-ack split means an LLM turn can take as long as it needs without Twilio retrying.
- Grounding answers in tool output means prices and dish names come from the database, not the model's memory.
- The read-only envelope makes the whole feature cheap to reason about: nothing it does is destructive.

### Negative

- Two runtimes and an extra action hop make the request path harder to follow than a single handler.
- A model still narrates the answer, so wording is not fully controlled even when the facts are.
- Conversation context is body text only, with no record of which tools ran, so the model cannot reliably reason about what it previously did.
- Context has no staleness bound: a message from weeks ago is still "recent", so the assistant can refer to a prior visit as though it just happened.

### Neutral

- WhatsApp's 24-hour freeform-reply window is tracked (`lastInboundAt`) but not yet used; business-initiated messages would need approved Content Templates.
- The Twilio Sandbox's shared number means per-restaurant routing is unexercised outside tests until real senders are registered.

## Alternatives Considered

### Option 1: Reply synchronously inside the webhook with TwiML

Generate the answer during the webhook request and return it as TwiML.

**Pros:**

- One handler, no scheduler, no outbound REST call.

**Cons:**

- An LLM turn with tool calls exceeds Twilio's ~15s timeout, which triggers a retry — and a retry means a duplicate turn.
- Ties reply latency to model latency with no room for tool round trips.

**Why not chosen:** the timeout makes it unworkable for anything but a canned reply.

### Option 2: Keyword/menu-tree bot with no model

A deterministic decision tree ("reply 1 for menu, 2 for hours").

**Pros:**

- No model cost, fully predictable output, no injection surface at all.

**Cons:**

- Cannot answer "what's good for someone who doesn't eat pork?" — the actual questions customers ask.
- Bilingual support becomes a hand-maintained string matrix.

**Why not chosen:** the value is in handling unanticipated phrasing, which is exactly what a tree cannot do.

### Option 3: Booking deep-link instead of in-chat answers

Reply with a link to `/r/$slug/reserve` and let the web form do the work.

**Pros:**

- Zero new trust surface; reuses the existing customer reservation form.

**Cons:**

- Abandons the conversational channel the customer chose.
- Still needs a model for menu questions, so it does not avoid the LLM surface.

**Why not chosen:** kept as a complement, not a replacement — the link remains useful for anything the assistant cannot do.

## Implementation

```
Twilio ──POST──▶ /whatsapp/inbound ──verify (node action)──▶ 200 <Response></Response>
                        │
                        └─ scheduler.runAfter(0) ──▶ handleInboundMessage  (node action)
                              │
   dedupe(MessageSid) ▶ route(To→channel) ▶ ingest ▶ resolve locale
                              ▶ context(12 msgs) ▶ runBotTurn ▶ toWhatsappText
                              ▶ sendWhatsappMessage ▶ recordOutbound
```

Files: `convex/http.ts` (route), `convex/whatsapp/{processing,llm,menu,data,outbound,twilioValidation,phone,format,copy}.ts`, tables in `convex/schema.ts`, constants in `convex/constants.ts`.

Environment (Convex deployment vars): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, `OPENROUTER_API_KEY`, optional `WHATSAPP_MODEL` and `TWILIO_WEBHOOK_URL`.

Any failure between routing and delivery sends a fixed, localized apology from `copy.ts` rather than failing silently — never a live model call, since the model may be what failed.

## References

- [ADR-003: Convex as Backend-as-a-Service](./003-convex-backend.md)
- [ADR-008: Phone-Number Identity for Customer Reservation Writes](./008-whatsapp-customer-reservation-writes.md) — supersedes the read-only scope
- `CONTEXT.md` — Reservations & timeline glossary
- [Twilio WhatsApp Sandbox](https://www.twilio.com/docs/whatsapp/sandbox)

---

## Change Log

| Date       | Author        | Description                                                                                                                                                                |
| ---------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-25 | Jorge Almazan | Initial version, written retroactively to repay dangling in-code citations.                                                                                                |
| 2026-07-25 | Jorge Almazan | Read-only scope superseded by ADR-008: the assistant can now request and cancel reservations. The runtime split, domain objects and formatting decisions here still stand. |
