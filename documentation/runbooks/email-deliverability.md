# Email Deliverability Runbook

## Purpose

This runbook covers transactional email delivery for Tavli — currently used by the member invitation flow (`convex/inviteActions.ts`), and any future transactional email (password resets, receipts, reservation confirmations, etc.).

Symptom this runbook addresses: **an email shows "Delivered" in the Resend dashboard but lands in the recipient's spam folder** (or worse, never reaches the inbox at all).

## Background

Email is sent through [Resend](https://resend.com) from a Tavli-owned domain (currently `gggfox.com`, eventually `tavli.com`). Resend reports "Delivered" when the recipient's mail server (e.g. Gmail's MX) accepts the message — that is _not_ the same as "landed in the inbox". Inbox vs. spam placement is decided by the recipient mail provider after acceptance, based on signals like:

- Sender domain reputation (history of sending from the domain)
- DNS authentication (SPF, DKIM, DMARC)
- Message content (HTML quality, link density, ratio of HTML/text)
- Engagement (whether previous recipients opened, replied, or reported)
- Required headers (`List-Unsubscribe`, `Message-ID`, etc.)

A brand-new sending domain with a sparse template will land in spam by default. This is normal.

## Required Environment Variables (Convex)

- `RESEND_API_KEY` — Resend API key
- `RESEND_FROM_ADDRESS` — sender, e.g. `Tavli <invites@gggfox.com>` or `Tavli <invites@tavli.com>`
- `PUBLIC_APP_URL` — base URL used to build accept links inside the email (e.g. `http://localhost:3000` in dev, `https://app.tavli.com` in prod)

Set with: `npx convex env set <NAME> <VALUE>`. Verify with: `npx convex env list`.

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

The current invitation template at `convex/inviteActions.ts` has a sparse HTML body, no plain-text alternative, and no `List-Unsubscribe` header — all of which contribute to spam scoring. Improving the template is the single biggest deliverability lever.

### 4. Check engagement signals

If recipients consistently open and reply to your messages, reputation builds. If they ignore or delete-without-opening, reputation suffers. For testing:

- Mark spam-foldered test messages as **Not spam** in Gmail. This is the strongest individual signal you can give the filter.
- Don't send the same exact body 50× in a row from the same domain — variation helps.

## Production Hardening Checklist

Before relying on email for any user-facing flow in production:

- [ ] Custom sending domain verified in Resend (e.g. `tavli.com`)
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
- [ ] Production `RESEND_FROM_ADDRESS` uses a brand-coherent local part (`invites@tavli.com`, `noreply@tavli.com`, etc.)
- [ ] Production `PUBLIC_APP_URL` points at the production domain so accept links work

## Quick Fixes During Testing

While developing, the practical loop is:

1. Send the test invite.
2. If it lands in spam, mark **Not spam** in Gmail. Repeat 3–5 times — Gmail learns quickly per-recipient.
3. After a few "Not spam" votes, the same template will land in inbox for that recipient, even before any template improvements are deployed.

This is fine for unblocking dev work, but **does not fix the underlying issue** — a real recipient seeing the email for the first time will still hit spam. The Production Hardening Checklist is the durable fix.

## Common Pitfalls

| Pitfall                                                    | Symptom                                                                                            | Fix                                                                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Env vars set in `.env.local` instead of Convex             | Convex logs show `RESEND_API_KEY missing`, no API call ever made                                   | `npx convex env set RESEND_API_KEY <key>`                                                                          |
| Sending to non-owner email before domain verification      | Convex logs show 403 from Resend with "you can only send testing emails to your own email address" | Verify a domain in Resend, switch `RESEND_FROM_ADDRESS` to that domain                                             |
| Gmail `+aliases` in test-mode Resend                       | Same 403 as above                                                                                  | Either invite the canonical owner email, or verify a domain                                                        |
| Forgot to add `_dmarc` record                              | Email lands in spam, headers show `DMARC: BESTGUESSPASS` instead of `PASS`                         | Add TXT `_dmarc` with `v=DMARC1; p=none;`                                                                          |
| DKIM record truncated by DNS provider's 255-char TXT limit | DKIM `dig` lookup returns nothing or partial value, Resend won't verify                            | Hostinger usually handles this, but if not, split the value into 255-char chunks each in quotes                    |
| DNS edits in Hostinger but nameservers point elsewhere     | DNS records not visible via `dig`, Resend stays "Pending"                                          | Confirm `dig +short NS <domain>` returns Hostinger nameservers; if not, edit DNS at the actual nameserver provider |

## References

- Resend domain setup: [resend.com/docs/dashboard/domains/introduction](https://resend.com/docs/dashboard/domains/introduction)
- Gmail bulk sender guidelines: [support.google.com/mail/answer/81126](https://support.google.com/mail/answer/81126)
- Gmail Postmaster Tools: [postmaster.google.com](https://postmaster.google.com)
- DMARC overview: [dmarc.org/overview](https://dmarc.org/overview/)
- Test deliverability score: [mail-tester.com](https://www.mail-tester.com) (send a test email to the address it gives you, get a 0–10 score and per-issue breakdown)
