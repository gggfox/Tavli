# Runbook — Clerk go-live (development → production instance)

Move an environment from a Clerk **development** instance (shared OAuth, `pk_test`/
`sk_test`, "Development mode" badge, `*.accounts.dev` domain) to a Clerk **production**
instance served from your own domain. Written for **production / `tavliai.com`**; the
same shape applies to any environment.

No application code changes are needed — `<ClerkProvider>` (`src/routes/__root.tsx`) and
`clerkMiddleware()` (`src/start.ts`) read everything from environment variables. This is
a **keys + DNS + issuer** change.

## Why the "Development mode" badge shows

The badge is a property of the **publishable key the loaded bundle was built with**. A
`pk_test_…` key ⇒ development instance ⇒ badge. It disappears once the deployed build
uses the production `pk_live_…` key, served from the verified production domain.

## Where each value lives (Tavli specifics)

| Value                        | Where it's set                                      | Consumed                                                                        |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `VITE_CLERK_PUBLISHABLE_KEY` | Infisical, **per-env** (`prod`)                     | **Baked at build time** by `deploy.yml` (`infisical run --env=prod pnpm build`) |
| `CLERK_SECRET_KEY`           | Infisical, **per-env** (`prod`)                     | **Runtime**, injected by `docker-entrypoint.sh` (`INFISICAL_ENV=prod`)          |
| `CLERK_JWT_ISSUER_DOMAIN`    | **Convex** deployment env (`polite-antelope-545`)   | Convex `auth.config.ts` — must trust the prod issuer                            |
| DNS CNAMEs                   | DNS host (**Hostinger** hPanel, `tavliai.com` zone) | Clerk Frontend API + email                                                      |
| Google OAuth client          | Google Cloud Console → Clerk SSO                    | Google sign-in                                                                  |

Because `VITE_CLERK_PUBLISHABLE_KEY` is **baked at build time**, changing it in Infisical
has no effect until production is **rebuilt** (a container restart is not enough).

## Ordering (important)

Do **not** deploy `pk_live` before DNS is verified, and do **not** flip the Convex issuer
before the `pk_live` build is live — either one breaks auth on the currently-running site.

1. DNS records → verify in Clerk → SSL issued.
2. Google OAuth production credentials.
3. Set `CLERK_SECRET_KEY=sk_live_…` in Infisical `prod` (publishable key `pk_live` is set
   there already).
4. **Cutover (do together):** set Convex `CLERK_JWT_ISSUER_DOMAIN=https://clerk.tavliai.com`
   **and** redeploy production.

## Step 1 — DNS (Hostinger hPanel → Domains → tavliai.com → DNS records)

Add these 5 CNAME records, then click **Verify configuration** on the Clerk Dashboard
**Domains** page. (Hostinger propagates in minutes; Clerk allows up to 48h.)

| Type  | Name / Host       | Value                               |
| ----- | ----------------- | ----------------------------------- |
| CNAME | `clerk`           | `frontend-api.clerk.services`       |
| CNAME | `accounts`        | `accounts.clerk.services`           |
| CNAME | `clkmail`         | `mail.vdd2e3d2eg5x.clerk.services`  |
| CNAME | `clk._domainkey`  | `dkim1.vdd2e3d2eg5x.clerk.services` |
| CNAME | `clk2._domainkey` | `dkim2.vdd2e3d2eg5x.clerk.services` |

> The `mail` / `dkim*` targets (`vdd2e3d2eg5x`) are instance-specific — copy them from the
> Clerk Dashboard **Domains** page, don't hardcode from here for a different instance.

Clerk then issues SSL certificates for `clerk.tavliai.com` and `accounts.tavliai.com`
(minutes, up to 24h).

## Step 2 — Google OAuth (production needs your own credentials)

Clerk's shared dev Google OAuth does not work on production instances.

1. Google Cloud Console (project `tavli-502709`) → **APIs & Services → Credentials →
   Create OAuth client ID → Web application**.
2. **Authorized redirect URI:** `https://clerk.tavliai.com/v1/oauth_callback`
   (also add the OAuth consent screen authorized domain `tavliai.com`).
3. Copy the **Client ID** and **Client Secret**.
4. Clerk Dashboard → **SSO connections → Google → Use custom credentials** → paste both →
   Save.

## Step 3 — Production Clerk keys in Infisical (`prod` env)

- `VITE_CLERK_PUBLISHABLE_KEY` = `pk_live_…` — already set.
- `CLERK_SECRET_KEY` = `sk_live_…` — get it from Clerk Dashboard → **API keys**
  (production instance) and replace the `sk_test_…` value. **Secret — handle directly in
  Infisical, never in chat/logs.**

## Step 4 — Cutover: Convex issuer + redeploy

1. Point the production Convex deployment at the production issuer:
   ```bash
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://clerk.tavliai.com --prod
   ```
   (or Convex Dashboard → `polite-antelope-545` → Settings → Environment Variables).
   `auth.config.ts` trusts this issuer; if it still points at the dev instance
   (`https://model-mustang-98.clerk.accounts.dev`), production users' Convex calls 401
   after the switch.
2. Confirm the production Dokploy `frontend` app has `INFISICAL_ENV=prod` +
   `INFISICAL_MACHINE_CLIENT_ID/SECRET` (so the container fetches `sk_live` at boot — see
   [dokploy-runtime-secrets postmortem action #6](../postmortems/2026-07-17-staging-bad-gateway.md)).
3. Redeploy production so `pk_live` is baked into a fresh build: run the **Promote to
   Production** workflow (fast-forwards `production` from `staging`) or push to the
   `production` branch. This triggers `deploy-production.yml` → rebuild + push
   `ghcr.io/gggfox/tavli:production` → Dokploy redeploy.

## Verification

- `curl -s https://tavliai.com/ | grep -o 'clerk\.[a-z.]*'` → references `clerk.tavliai.com`,
  not `*.accounts.dev`.
- Load `https://tavliai.com/` → **no "Development mode" badge** on the Clerk widget.
- Sign in with email and with Google; confirm an authenticated Convex query succeeds (no
  401 / issuer error in the network tab or Convex logs).
- Clerk Dashboard → production instance shows the domain **Verified** and SSL **Issued**.

## Rollback

Revert `CLERK_SECRET_KEY` in Infisical `prod` to the previous `sk_test_…`, set Convex
`CLERK_JWT_ISSUER_DOMAIN` back to `https://model-mustang-98.clerk.accounts.dev`, and
redeploy. (Note `VITE_CLERK_PUBLISHABLE_KEY` would also need reverting to `pk_test` for a
true rollback, since it is baked at build time.) DNS records are additive and safe to
leave in place.
