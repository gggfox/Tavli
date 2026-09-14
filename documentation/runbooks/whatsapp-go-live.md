# WhatsApp Go-Live Runbook

## Purpose

Production configuration for the Tavli WhatsApp assistant: moving off the Twilio
Sandbox onto Tavli's own WhatsApp sender, and everything that has to be true for
an inbound message to reach a restaurant and come back as an answer.

Architecture is [ADR-010](../ADR/010-whatsapp-assistant.md) (the assistant),
[ADR-011](../ADR/011-whatsapp-customer-reservation-writes.md) (reservation
writes) and [ADR-012](../ADR/012-one-tavli-whatsapp-number.md) (one shared
number, short-code routing). This runbook is the operating procedure.

> [!IMPORTANT]
> **There are two Twilio accounts on this login**, and only one is right:
>
> |         | Account  | SID prefix  | State         |
> | ------- | -------- | ----------- | ------------- |
> | **Use** | `tavli`  | `ACbabb98…` | Pay-as-you-go |
> | Never   | `gggfox` | `ACcb0a5e…` | Trial         |
>
> This is the same trap as the two Stripe accounts (see
> [`stripe-go-live.md`](./stripe-go-live.md)). A credential from the wrong
> account fails at runtime, not at configuration time. Verify the prefix before
> trusting any value:
>
> ```bash
> npx convex env get TWILIO_ACCOUNT_SID --prod | cut -c1-8   # ACbabb98 ✅
> ```

## Where each value lives

| Value                    | Lives in                  | Read by                                       |
| ------------------------ | ------------------------- | --------------------------------------------- |
| `TWILIO_ACCOUNT_SID`     | **Convex deployment env** | `whatsapp/outbound.ts`                        |
| `TWILIO_AUTH_TOKEN`      | **Convex deployment env** | `whatsapp/outbound.ts`, `twilioValidation.ts` |
| `TWILIO_WHATSAPP_NUMBER` | **Convex deployment env** | `whatsapp/outbound.ts` (the `From`)           |
| `TWILIO_WEBHOOK_URL`     | **Convex deployment env** | `twilioValidation.ts`                         |
| `OPENROUTER_API_KEY`     | **Convex deployment env** | `whatsapp/llm.ts` (shared with menu import)   |

None of these are in Infisical — Infisical feeds the Dokploy container, and
Convex functions never see it. See
[`deployment-and-secrets.md`](../internal-guides/deployment-and-secrets.md).

```bash
npx convex env set TWILIO_ACCOUNT_SID     ACbabb98…                                            --prod
npx convex env set TWILIO_AUTH_TOKEN      <token>                                              --prod
npx convex env set TWILIO_WHATSAPP_NUMBER +14058777412                                         --prod
npx convex env set TWILIO_WEBHOOK_URL     https://polite-antelope-545.convex.site/whatsapp/inbound --prod
```

> [!WARNING]
> **`TWILIO_WEBHOOK_URL` is not optional**, despite being easy to miss.
> `twilioValidation.ts` prefers it over the request URL. Behind Traefik the
> reconstructed URL differs from the one Twilio signed, so without it every
> inbound message is rejected with 403. It must match the URL configured in the
> Twilio console **byte for byte** — a trailing slash or `http://` breaks it.

Deployments: prod `polite-antelope-545`, staging `aromatic-dog-762`. The webhook
uses `.convex.site` (httpRouter routes), never `.convex.cloud` (functions).

## Twilio configuration

1. **Account:** `tavli`, upgraded to Pay-as-you-go. The Sandbox is testing-only
   and a trial account cannot hold a production sender. **Enable auto-recharge** —
   at a zero balance Twilio suspends messaging, and nothing appears in the Convex
   logs to explain the silence.
2. **Sender:** `+1 405 877 7412`, display name **Tavli**.
   Console → Messaging → Senders → WhatsApp senders.
3. **Inbound webhook:** POST to
   `https://polite-antelope-545.convex.site/whatsapp/inbound`.
4. **Business profile:** _Profile about_ is the only required field (139 chars).
   Website, email and description are optional but shown to diners in-chat.

> [!CAUTION]
> The sender number's **SMS webhook must never point at `/whatsapp/inbound`**.
> Per the comment in `convex/http.ts`, a spoofed SMS caller ID would normalize to
> the same string and impersonate a WhatsApp customer. A WhatsApp account is a
> credential; inbound SMS caller ID is not.

### Why the sender is a US number

Twilio's [MX regulatory guidelines](https://www.twilio.com/en-us/guidelines/mx/regulatory)
require a Regulatory Bundle for Mexican **local** numbers — a Constancia de
Situación Fiscal plus local address, the same document that gates Meta business
verification. Mexican **mobile** numbers are unusable outright: _"Local carriers
do not permit A2P or automated messaging on this number type and such traffic
will be blocked immediately."_ A US number needs no bundle and, being
SMS-capable, verifies automatically.

The cost is cosmetic: `+1 405` reads as neither Mexican nor meaningful. Changing
it later means re-registering the WABA.

## Meta configuration

- **Portfolio:** `Tavli`, holding the WABA. 2FA is mandatory and must be
  delivered by **authenticator app** — Meta's SMS does not reliably reach MX
  mobiles.
- **Display name:** `Tavli`. **Locked** — changing it needs a Twilio support
  ticket.
- **Business verification** gates _scale_, not launch. Unverified, the sender
  works, capped at 250 business-initiated conversations per rolling 24h. The
  assistant only replies, and replies inside the 24h customer-service window do
  not count against that cap.

## Enabling a restaurant

**This is the step most likely to be forgotten, and its failure looks exactly
like a broken integration.** With every credential correct but no restaurant
enabled, every diner gets the cold-start reply:

> Soy el asistente de Tavli. Para ayudarte, abre el enlace de WhatsApp del
> restaurante o escanea su código QR.

That is correct behaviour for an unrouted message, not a bug.

Enable under **`/admin/restaurants`** → the restaurant → **settings** → the
**WhatsApp assistant** section (`WhatsappAssistantSection`). It is _not_ on
`/admin/whatsapp`, which only lists conversations, nor on
`/admin/whatsapp-allowlist`, which is spend controls.

The section is gated on `isAdmin`: staff see the link, the short code and the QR
— they are the ones who print it — but only a platform admin sees the enable,
pause and reissue controls. Seeing the code with no button is a role problem, not
a missing feature.

`whatsappChannels.setEnabled` is
**platform-admin only** (`getCurrentUserId` → `requireAdminRole`, the same gate
as `featureFlags.ts`) because every enabled restaurant spends Tavli's own Twilio
and OpenRouter money. Enabling is idempotent and keeps the existing short code —
rotating it would kill every QR already printed and taped to a table.

Since ADR-012, `whatsappChannels.phoneNumber` is **retired**. A row means "this
restaurant is enabled, with this short code and this locale", not a
number-to-restaurant map.

## Verification

```bash
# Route is live and demanding a signature (404 = not deployed)
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://polite-antelope-545.convex.site/whatsapp/inbound   # → 400
```

Then, from a phone, open the restaurant's deep link — **not** a bare "hola",
which is supposed to return the cold-start guidance:

```
wa.me/14058777412?text=Hola, quiero información sobre <Restaurante> · <CODE>
```

A reply proves signature validation passed, routing resolved, and the LLM turn ran.

## Troubleshooting

| Symptom                                         | Cause → fix                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `404` on the webhook URL                        | Assistant not deployed to that environment                         |
| `400 Missing X-Twilio-Signature`                | Correct for a bare `curl`; Twilio always sends the header          |
| `403 Invalid signature`                         | `TWILIO_WEBHOOK_URL` ≠ the URL configured in Twilio, byte for byte |
| `[whatsapp.validate] TWILIO_AUTH_TOKEN missing` | Convex prod env not set                                            |
| `[whatsapp.outbound] … missing`                 | SID / token / number not all set                                   |
| Every diner gets the bilingual cold-start reply | No restaurant enabled → `/admin/restaurants` → settings            |
| Replies silently never arrive                   | `OPENROUTER_API_KEY` unset on prod                                 |
| Messaging suspended with no log line            | Twilio balance hit zero → enable auto-recharge                     |

```bash
npx convex logs --prod
```

## Cost

Today: inbound free, in-window replies free, Twilio $0.005/msg. **From 1 Oct 2026
Meta bills service and in-window utility messages** (Mexico utility rate
$0.0085) → ~$0.0135 per outbound message all-in.

## Traps found during the first go-live (Aug 2026)

- **Do not provision a new Meta portfolio in one sitting.** Creating it and then
  adding 2FA, a phone, a WhatsApp number and a third-party OAuth grant within
  minutes reads as scripted automation. The first `Tavli` portfolio was
  restricted the day it was created. Submitting an **INE** through _Solicitar
  revisión_ lifted it within hours.
- **Create the WABA from Twilio**, never from Meta's own _Cuentas de WhatsApp →
  Agregar_. Twilio's Embedded Signup has to create or link it to receive
  credentials, and a number can only live on one WABA.
- **A Facebook Page is not required** for a WABA, registration, or the
  display-name review.
- **Portfolio names are validated.** `TavliAI` was rejected as not reflecting the
  business; plain `Tavli` passed.
- **`tavliai.com` has no MX records** — no address at that domain receives mail,
  so Meta's business contact email must stay a deliverable mailbox.
- **Meta's SMS one-time codes do not reliably reach MX mobiles.** Use an
  authenticator app; it is also why the sender is a Twilio number, whose OTP is
  readable in the Console.
- **The OTP for a Twilio sender number** never reaches a phone — read it under
  **Monitor → Logs → Messaging**, and choose text rather than voice.
