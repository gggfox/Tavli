# Email Deliverability Runbook

## Purpose

This runbook covers transactional email delivery for Tavli — currently used by the member invitation flow (`convex/inviteActions.ts` + `convex/emails/teamInviteEmail.tsx`), and any future transactional email (password resets, receipts, reservation confirmations, etc.).

Symptom this runbook addresses: **an email shows "Delivered" in the Resend dashboard but lands in the recipient's spam folder** (or worse, never reaches the inbox at all).

## Background

Email is sent through [Resend](https://resend.com) from a Tavli-owned domain. **`tavliai.com` is the only verified sending domain in the Resend account** (DKIM, SPF, and DMARC all green; re-confirmed 2026-07-25) and it is used for every environment, dev included — `gggfox.com` is _not_ a domain in that account, despite hosting some of our infra. Any `RESEND_FROM_ADDRESS` outside `tavliai.com` will be rejected. Resend reports "Delivered" when the recipient's mail server (e.g. Gmail's MX) accepts the message — that is _not_ the same as "landed in the inbox". Inbox vs. spam placement is decided by the recipient mail provider after acceptance, based on signals like:

- Sender domain reputation (history of sending from the domain)
- DNS authentication (SPF, DKIM, DMARC)
- Message content (HTML quality, link density, ratio of HTML/text)
- Engagement (whether previous recipients opened, replied, or reported)
- Required headers (`List-Unsubscribe`, `Message-ID`, etc.)

A brand-new sending domain with a sparse template will land in spam by default. This is normal.

## Where each value lives

Resend config is entirely **Convex-side** — unlike Clerk/Stripe there's no `VITE_*`
public key baked into the frontend bundle, so **Infisical holds none of it**. See
[`deployment-and-secrets.md`](../internal-guides/deployment-and-secrets.md) for the full
model (and the
[env-and-dokploy skill](../../.claude/skills/env-and-dokploy/SKILL.md) for the
operational playbook).

| Value                 | Where it's set                                 | Consumed                                                                                                   |
| --------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`      | **Convex deployment** env, set per environment | `convex/inviteActions.ts` — the Resend API call                                                            |
| `RESEND_FROM_ADDRESS` | **Convex deployment** env, set per environment | Sender header. Must be on `tavliai.com` — dev `blessed-weasel-428` uses `support@tavliai.com`              |
| `PUBLIC_APP_URL`      | **Convex deployment** env, set per environment | `convex/_util/env.ts` (`getAppUrl`) — builds the invite accept link; falls back to `VITE_APP_URL` if unset |

Each of the three Convex deployments needs its own values — dev `blessed-weasel-428`,
staging `aromatic-dog-762`, prod `polite-antelope-545` (see `deployment-and-secrets.md` →
Convex environments). `PUBLIC_APP_URL` is **required** once `CONVEX_ENV` is `staging` or
`production`: the send action throws `APP_URL_NOT_CONFIGURED` instead of silently
falling back to `localhost:3000` (TAVLI-57).

```bash
npx convex env set RESEND_API_KEY <key>          # local dev deployment
npx convex env set --prod RESEND_API_KEY <key>   # production deployment
```

Staging (`aromatic-dog-762`) has no CLI flag for this — set it via the Convex dashboard
(switch to the staging deployment), or point your local CLI at it directly. Verify with
`npx convex env list` (add `--prod` for production).

## Required DNS Records (in Hostinger / wherever DNS is hosted)

Resend's domain page provides the exact records. The minimum set is:

| Type  | Name                | Purpose                                                                         | Required?            |
| ----- | ------------------- | ------------------------------------------------------------------------------- | -------------------- |
| `TXT` | `resend._domainkey` | DKIM signing key                                                                | Yes                  |
| `TXT` | `send`              | SPF (`v=spf1 include:amazonses.com ~all`)                                       | Yes                  |
| `MX`  | `send`              | Bounce/feedback handling (`feedback-smtp.us-east-1.amazonses.com`, priority 10) | Yes                  |
| `TXT` | `_dmarc`            | `v=DMARC1; p=none; rua=mailto:postmaster@<domain>`                              | Strongly recommended |

After adding records in Hostinger:

1. Verify they're live: `dig +short TXT resend._domainkey.<domain>` and similar for the others.
2. Click **Verify DNS Records** in the Resend domain page.
3. Status should transition `Not Started` → `Pending` → `Verified` within ~5–15 min.

## Verifying End-to-End Send

1. Trigger a send (e.g. invite a member from the Miembros UI).
2. Check Convex logs:

   ```bash
   npx convex logs --history 50
   ```

   - ✅ `A(inviteActions:sendInviteEmail) Function executed in NNN ms` with no `[ERROR]` line → request accepted by Resend.
   - ❌ `[WARN] '[inviteActions] RESEND_API_KEY or RESEND_FROM_ADDRESS missing'` → env vars not set in Convex.
   - ❌ `[ERROR] '[inviteActions] Resend error:' 4xx` → Resend rejected the send. Body of the error explains why (unverified domain, sandbox-only recipient, etc.).

3. Check Resend dashboard → **Emails** → **Sending** → look for the message and its status (`Delivered`, `Bounced`, `Complained`).
4. Check the recipient inbox **and the spam folder**.

## Diagnosing Spam Placement

If Resend says **Delivered** but the message is in spam:

### 1. Confirm authentication is passing

Open the message in Gmail → **⋮** menu → **Show original**. Look at the headers:

```
SPF:     PASS
DKIM:    PASS
DMARC:   PASS  (or "BESTGUESSPASS" before DMARC is added)
```

If any of these say `FAIL` or `NEUTRAL`, fix the corresponding DNS record before doing anything else. Pass on all three is a hard requirement for inbox placement at most providers.

### 2. Check sender reputation

For meaningful sending volume, register the domain at [postmaster.google.com](https://postmaster.google.com). It shows Gmail's view of:

- Domain reputation (`High` / `Medium` / `Low` / `Bad`)
- Spam rate (% of recipients marking as spam)
- Authentication results (per-day breakdown)
- Encryption / TLS inbound

A **new domain has no reputation data**, which is its own signal — Gmail folders cautiously until reputation builds.

### 3. Audit the message itself

Open the email's HTML and check:

- Plain-text alternative present? (Resend supports `text:` alongside `html:` in the API call.)
- `List-Unsubscribe` header present? (Required by Gmail/Yahoo bulk-sender rules since Feb 2024 for high-volume senders, recommended even at low volume.)
- HTML body has real content (header, paragraph, CTA, footer with sender identity), not just `<p>two</p><p>tags</p>`?
- Link-to-text ratio reasonable? Emails that are mostly one big link score as suspicious.
- From-name and from-domain coherent? (`Tavli <invites@unrelated-brand.com>` is a yellow flag.)

The invitation template lives in `convex/emails/teamInviteEmail.tsx` (React Email). Preview wrappers are in `emails/` for local dev. It renders bilingual HTML and plain-text bodies (`en` / `es`, based on the invited restaurant's `defaultLanguage`) before send. Preview locally with:

```bash
pnpm email:dev
```

Then open `http://localhost:3001` and select `teamInviteEmail.tsx` (English) or `teamInviteEmailEs.tsx` (Spanish).

For deliverability, the send path includes both `html` and `text` in the Resend API payload. One-to-one transactional invites do not include `List-Unsubscribe` (not bulk marketing).

### 4. Check engagement signals

If recipients consistently open and reply to your messages, reputation builds. If they ignore or delete-without-opening, reputation suffers. For testing:

- Mark spam-foldered test messages as **Not spam** in Gmail. This is the strongest individual signal you can give the filter.
- Don't send the same exact body 50× in a row from the same domain — variation helps.

## Production Hardening Checklist

Before relying on email for any user-facing flow in production:

- [ ] Custom sending domain verified in Resend (e.g. `tavliai.com`)
- [ ] DKIM, SPF, DMARC records all green in Resend domain page
- [ ] DMARC policy at minimum `p=none` with `rua=` reporting to a real mailbox
- [ ] All transactional templates have:
  - [ ] Rich HTML body with brand identity, clear CTA, sender info in footer
  - [ ] Plain-text alternative passed via `text:` field
  - [ ] `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers
  - [ ] Reply-To set to a monitored mailbox (or clear "do not reply" copy + an alternate contact)
- [ ] Domain registered at [postmaster.google.com](https://postmaster.google.com) for visibility
- [ ] Resend webhooks configured for `email.bounced` and `email.complained` so we surface delivery failures in the app or in logs
- [ ] Warm-up plan: gradually ramp send volume over 2–4 weeks rather than launching at full volume
- [ ] Production `RESEND_FROM_ADDRESS` uses a brand-coherent local part (`invites@tavliai.com`, `noreply@tavliai.com`, etc.)
- [ ] Production `PUBLIC_APP_URL` points at the production domain so accept links work

## Quick Fixes During Testing

While developing, the practical loop is:

1. Send the test invite.
2. If it lands in spam, mark **Not spam** in Gmail. Repeat 3–5 times — Gmail learns quickly per-recipient.
3. After a few "Not spam" votes, the same template will land in inbox for that recipient, even before any template improvements are deployed.

This is fine for unblocking dev work, but **does not fix the underlying issue** — a real recipient seeing the email for the first time will still hit spam. The Production Hardening Checklist is the durable fix.

## Common Pitfalls

| Pitfall                                                    | Symptom                                                                                                                                                          | Fix                                                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Env vars set in `.env.local` instead of Convex             | Convex logs show `RESEND_API_KEY missing`, no API call ever made                                                                                                 | `npx convex env set RESEND_API_KEY <key>`                                                                                                                  |
| Sending to non-owner email before domain verification      | Convex logs show 403 from Resend with "you can only send testing emails to your own email address"                                                               | Verify a domain in Resend, switch `RESEND_FROM_ADDRESS` to that domain                                                                                     |
| Gmail `+aliases` in test-mode Resend                       | Same 403 as above                                                                                                                                                | Either invite the canonical owner email, or verify a domain                                                                                                |
| A **non-Convex** sender left on `onboarding@resend.dev`    | Nothing at all app-side — the sending app reports success, the recipient never gets mail. Only evidence is `403 Testing domain restriction` in **Resend → Logs** | Point its `SMTP_FROM_ADDRESS` / from-header at `tavliai.com`. Bit self-hosted Infisical (`infisical.gggfox.com`) for 8 days — see the Infisical note below |
| Forgot to add `_dmarc` record                              | Email lands in spam, headers show `DMARC: BESTGUESSPASS` instead of `PASS`                                                                                       | Add TXT `_dmarc` with `v=DMARC1; p=none;`                                                                                                                  |
| DKIM record truncated by DNS provider's 255-char TXT limit | DKIM `dig` lookup returns nothing or partial value, Resend won't verify                                                                                          | Hostinger usually handles this, but if not, split the value into 255-char chunks each in quotes                                                            |
| DNS edits in Hostinger but nameservers point elsewhere     | DNS records not visible via `dig`, Resend stays "Pending"                                                                                                        | Confirm `dig +short NS <domain>` returns Hostinger nameservers; if not, edit DNS at the actual nameserver provider                                         |

## Other senders on this Resend account

Tavli's Convex deployments are not the only thing sending through this Resend account, so a
domain or API-key change here affects more than the app.

**Self-hosted Infisical** (`infisical.gggfox.com`) sends its organization-invite emails via
Resend **SMTP** (not the HTTP API). Its config lives in Dokploy → project **Infisical** →
compose service `infisical` → **Environment** — the compose file declares the vars as bare
pass-throughs, so the values come from that tab, and a **Deploy** is required for a change to
take effect (Save alone does not restart the containers).

| Var                 | Value                                                                |
| ------------------- | -------------------------------------------------------------------- |
| `SMTP_HOST`         | `smtp.resend.com`                                                    |
| `SMTP_PORT`         | `465` (implicit TLS, matches `SMTP_SECURE=true` in the compose file) |
| `SMTP_USERNAME`     | `resend` (literal — this is not an account name)                     |
| `SMTP_PASSWORD`     | a Resend API key                                                     |
| `SMTP_FROM_ADDRESS` | `infisical@tavliai.com` — **must** be on the verified domain         |
| `SMTP_FROM_NAME`    | `Infisical`                                                          |

Note that Infisical's UI reports "invite sent" whether or not Resend accepted the message, and
writes nothing to its own logs on rejection. **Resend → Logs is the only place a failure shows
up.** A stray `SMTP_NAME` var is also present in that env; it is not an Infisical variable and
is not referenced by the compose file — it does nothing.

## References

- Resend domain setup: [resend.com/docs/dashboard/domains/introduction](https://resend.com/docs/dashboard/domains/introduction)
- Gmail bulk sender guidelines: [support.google.com/mail/answer/81126](https://support.google.com/mail/answer/81126)
- Gmail Postmaster Tools: [postmaster.google.com](https://postmaster.google.com)
- DMARC overview: [dmarc.org/overview](https://dmarc.org/overview/)
- Test deliverability score: [mail-tester.com](https://www.mail-tester.com) (send a test email to the address it gives you, get a 0–10 score and per-issue breakdown)
