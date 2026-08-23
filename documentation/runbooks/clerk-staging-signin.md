# Runbook — Clerk sign-in needs two clicks on staging

## Purpose

Diagnose the staging sign-in symptom reported against `https://staging.tavliai.com`:

> **Google sign-in required two clicks.** The first click appeared to do nothing
> (no popup, no redirect, or a redirect that came straight back signed-out). The
> second click signed in and rendered the page normally.

A second, possibly related report came from an **iPad** (a different user could
not see their organization in the restaurant-creation modal). That one has a
proven, unrelated backend cause (see
[TAVLI-71 item 8](#not-this-the-ipad-organization-report)) — **do not** merge the
two into a single "iPad is broken" theory.

> [!IMPORTANT]
> **This runbook does not assert a cause.** As of writing, nobody has captured a
> HAR, a Clerk dashboard log line, or a reproduction with instrumentation. Every
> section below is a hypothesis plus the check that confirms or kills it. Work
> them in order; stop at the first one that reproduces the symptom, and record
> the evidence in the ticket rather than the conclusion alone.

## Scope and prerequisites

| Thing                | Value                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| Affected host        | `staging.tavliai.com` (Dokploy `frontend` app, image `ghcr.io/gggfox/tavli:<sha>`)                            |
| Convex deployment    | `aromatic-dog-762` (staging)                                                                                  |
| Infisical env slug   | `staging`                                                                                                     |
| Clerk wiring         | `<ClerkProvider>` in `src/routes/__root.tsx`, `clerkMiddleware()` in `src/start.ts`                           |
| Convex issuer        | `CLERK_JWT_ISSUER_DOMAIN` on the **Convex** deployment, read by `convex/auth.config.ts`                       |
| Sign-in entry points | `<SignInButton mode="redirect">` (`src/routes/r/$slug.tsx`), `mode="modal"` (`src/routes/invites/$token.tsx`) |

Background reading, in this order:

- [`clerk-go-live.md`](./clerk-go-live.md) — dev vs production instance, what the
  "Development mode" badge means, shared vs custom Google OAuth credentials.
- [`../internal-guides/deployment-and-secrets.md`](../internal-guides/deployment-and-secrets.md)
  — which Clerk value lives where and whether it is **baked at build** or
  injected at runtime.
- The `env-and-dokploy` skill (`.claude/skills/env-and-dokploy/SKILL.md`) — the
  same table in short form, plus the `jwk-kid mismatch` and "Convex 401 for
  signed-in users" rows of its symptom table.

> [!NOTE]
> `VITE_CLERK_PUBLISHABLE_KEY` is **baked into the JS bundle at build time**.
> Any fix that changes it requires a **rebuild and redeploy** of staging, not a
> container restart. `CLERK_SECRET_KEY` (runtime) and Convex's
> `CLERK_JWT_ISSUER_DOMAIN` (applies immediately) do not.

## Step 0 — Reproduce deterministically before changing anything

A one-off "it took two clicks" is worthless as evidence. Get it to reproduce, or
get it to stop reproducing, on demand.

1. **Fresh profile, every time.** A brand-new Chrome profile / Safari private
   window per attempt. The symptom is almost certainly first-visit-only: once a
   `__client` cookie and a Clerk session exist, the second click "works" for the
   rest of the browser session and you can no longer see the bug.
2. Clear staging state explicitly between attempts:
   - DevTools → Application → Storage → **Clear site data** for
     `staging.tavliai.com` **and** for the Clerk Frontend API host (see Step 3
     for which host that is — `*.accounts.dev` or `clerk.tavliai.com`).
3. Record the matrix. The differences between these rows are the diagnosis:

   | Variant                                                              | First click works? |
   | -------------------------------------------------------------------- | ------------------ |
   | Chrome desktop, fresh profile, third-party cookies allowed           |                    |
   | Chrome desktop, fresh profile, third-party cookies **blocked**       |                    |
   | Safari desktop, private window (ITP on)                              |                    |
   | **iPad Safari**, private tab                                         |                    |
   | iPad Safari, Settings → Safari → **Prevent Cross-Site Tracking OFF** |                    |
   | Same, but signing in with **email/password** instead of Google       |                    |

   The email/password row is the single most informative one: if email sign-in
   is also two-click, the problem is session bootstrap / cookies (Steps 4–5) and
   **not** OAuth (Step 3). If only Google is two-click, invert that.

4. Note **which entry point** was used. `mode="redirect"` (customer landing,
   `src/routes/r/$slug.tsx`) and `mode="modal"` (invite acceptance,
   `src/routes/invites/$token.tsx`) fail differently — a modal that never opens
   is a clerk-js load/hydration problem, a redirect that returns signed-out is a
   handshake problem.

> The dev-only Auth devtools panel (`AuthDebugPanel`, gated behind
> `config.isDev` in `src/routes/__root.tsx`) is **not** available on staging.
> Don't plan a diagnosis around it; use the network tab and Clerk's own logs.

## Step 1 — Which Clerk instance is staging actually on?

A Clerk **development** instance behaves materially differently from a
production one: it serves an **interstitial/handshake page**, uses
`*.accounts.dev` for the Frontend API, ships shared OAuth credentials, and
carries looser bot-protection defaults. A staging host running on a dev instance
is the single most common explanation for "first attempt does nothing".

**Check:**

```bash
# Which Clerk host does the deployed bundle talk to?
curl -s https://staging.tavliai.com/ | grep -o 'clerk\.[a-z0-9.-]*\|[a-z0-9-]*\.clerk\.accounts\.dev' | sort -u
```

- `*.clerk.accounts.dev` → **development instance** (`pk_test_…` was baked in).
- `clerk.<domain>` → production instance.

Also check visually: load `https://staging.tavliai.com/` and look for the Clerk
**"Development mode"** badge. It is a property of the publishable key the bundle
was built with (see [`clerk-go-live.md`](./clerk-go-live.md#why-the-development-mode-badge-shows)).

Confirm the halves match — a `pk_test` bundle with an `sk_live` runtime key (or
vice versa) produces `jwk-kid mismatch` and handshake redirect loops:

```bash
infisical secrets get VITE_CLERK_PUBLISHABLE_KEY --env=staging | cut -c1-12   # pk_test_ / pk_live_
# CLERK_SECRET_KEY is a secret — check its pk/sk *prefix only*, in Infisical's UI.
npx convex env get CLERK_JWT_ISSUER_DOMAIN   # against aromatic-dog-762
```

`CLERK_JWT_ISSUER_DOMAIN` must name the **same instance** the frontend key comes
from. A mismatch here does not break Clerk sign-in itself — Clerk will report
signed-in while every Convex query 401s — which can _look_ like "the first click
did nothing, the page didn't render".

**If staging is on a dev instance:** that is a finding, not yet a cause. Record
it, then decide (with the owner) whether staging should get its own production
Clerk instance with its own domain. Do not silently cut it over — that is the
[`clerk-go-live.md`](./clerk-go-live.md) procedure, with its own ordering
constraints.

## Step 2 — Smart CAPTCHA / attack protection

Clerk's **invisible** bot protection can swallow a submission with **zero error
UI** — exactly the "first click did nothing" shape. We have already been bitten
by this: automating Clerk's hosted sign-**up** fails silently for the same
reason (see the `device-testing-browserstack` notes; the fix there was to
provision users via the Backend API instead of fighting the widget).

**Check** — Clerk Dashboard → the staging instance → **Configure → Attack
protection**:

| Setting                          | What to record                                             |
| -------------------------------- | ---------------------------------------------------------- |
| Bot sign-up protection           | On / off, and **Invisible** vs **Smart (managed) CAPTCHA** |
| Sign-in / sign-up rate limits    | Whether the reporting IP tripped one                       |
| Blocked/allowed countries or IPs | Whether the reporter's egress IP is affected               |

Then, in the browser, watch for a Turnstile/CAPTCHA widget mounting on the first
click: DevTools → Network, filter `challenges.cloudflare.com` or `turnstile`.
A challenge that loads, resolves, and _then_ needs a re-submit is the classic
two-click signature. Invisible mode is specifically the variant with no visible
affordance to explain the wasted click.

> Note: bot protection is primarily a **sign-up** control. If the reporter's
> account already existed and they were signing **in**, deprioritise this step
> below Steps 3–5 — but still record the settings, because a first-time Google
> sign-in _creates_ an account.

## Step 3 — OAuth: shared dev credentials, and authorized redirect URLs

Clerk's **shared** Google OAuth credentials (the default on a development
instance) are throttled, show Clerk's own consent screen, and are explicitly not
supported on production instances. A misconfigured redirect URI produces a
round-trip that lands back on staging **without** a session — visually identical
to "nothing happened".

**Check:**

1. Clerk Dashboard → staging instance → **SSO connections → Google**. Record
   whether it uses **shared** credentials or **custom** ones.
2. If custom: Google Cloud Console (project `tavli-502709`) → Credentials → that
   OAuth client → **Authorized redirect URIs** must contain the Clerk Frontend
   API callback for _this_ instance:
   - production instance: `https://clerk.<domain>/v1/oauth_callback`
   - development instance: `https://<slug>.clerk.accounts.dev/v1/oauth_callback`

   The redirect URI is the **Clerk** host, not `staging.tavliai.com`. A common
   error is registering the app host here.

3. Clerk Dashboard → **Paths / Domains**: confirm the allowed redirect origins
   include `https://staging.tavliai.com`. A rejected `redirect_url` is silently
   dropped back to the default path.
4. Watch the round trip in the network tab with **"Preserve log"** on:
   `…/v1/oauth_callback` → `…/v1/client/sessions/…` → back to
   `staging.tavliai.com`. Note any `4xx` and any hop that redirects to
   `sign-in` again.

> [!TIP]
> When reading redirect URLs, parse them — don't eyeball them. `redirect_url`
> query params contain the app host barely-encoded, so a substring check like
> `url.includes("staging.tavliai.com")` matches on pages that are **not** on the
> app host. Use `new URL(u).host`.

## Step 4 — Cookie domain, `__client`, and satellite/proxy config

Clerk keeps its session in a `__client` cookie set on the **Frontend API**
domain, and the app reads it back through the handshake. If the app host and the
Frontend API host are not on a shared parent domain — or if the browser refuses
the cookie as third-party — the first navigation completes without a session and
a _second_ attempt succeeds only because the first one finally planted the
cookie.

That two-phase behaviour is precisely the reported symptom, which is why this
step ranks high despite being invisible in the UI.

**Check:**

1. Identify the Frontend API host (Step 1). Then compare:
   - App host: `staging.tavliai.com`
   - Frontend API: `clerk.tavliai.com` (**same registrable domain** → first-party) or
     `<slug>.clerk.accounts.dev` (**different registrable domain** → third-party
     cookie territory)
2. DevTools → Application → **Cookies**, both hosts. On a fresh profile, after
   the _first_ click, record whether `__client` (and `__session` / `__clerk_db_jwt`
   on dev instances) exists, on which domain, and with what `SameSite` /
   `Secure` / `Partitioned` attributes.
3. DevTools → Network → the failing request → **Cookies** tab: Chrome flags
   cookies it **blocked** here (third-party, SameSite, or Partitioned/CHIPS).
   That flag is the confirmation; the Application tab alone is not.
4. If the app is configured as a Clerk **satellite** or behind a **proxy**
   (`proxyUrl` / `domain` / `isSatellite` props on `<ClerkProvider>` or the
   equivalent env vars): note that `src/routes/__root.tsx` currently renders a
   bare `<ClerkProvider>` with **no** satellite/proxy props, so all of it comes
   from the publishable key. If someone has since added `VITE_CLERK_*` overrides
   in Infisical `staging`, list them:

   ```bash
   infisical secrets --env=staging | grep -i clerk
   ```

**Kill-test:** disable third-party cookie blocking (Chrome: allow third-party
cookies for the site; iPad: Settings → Safari → Prevent Cross-Site Tracking
**off**) and repeat Step 0. If the first click now works, this is your cause and
the fix is a first-party Frontend API domain for staging (i.e. give staging its
own Clerk production instance on `clerk-staging.tavliai.com`, per
[`clerk-go-live.md`](./clerk-go-live.md)), **not** asking users to weaken their
browser settings.

## Step 5 — Handshake / session bootstrap in the network tab

This is where you turn "two clicks" into a specific failing request.

Open DevTools → Network **before** the first click, enable **Preserve log** and
**Disable cache**, filter on the Frontend API host, and perform the whole
two-click sequence. Then export the HAR (Step 8).

What to look for, and what each means:

| Observation                                                                              | Reading                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **First click: `GET /v1/client` → `401`; second attempt → `200`**                        | No client/session existed yet and the bootstrap did not complete on the first pass — points at the cookie/handshake path (Step 4), not OAuth. A 401 here is _normal_ for a signed-out visitor; the bug is that the **subsequent** bootstrap did not then succeed. |
| A `__clerk_handshake` query param or a redirect to `…/v1/client/handshake`, looping once | The dev-instance handshake ran and had to retry — expected on dev instances, and a strong argument for Step 1's finding.                                                                                                                                          |
| `/v1/environment` or `clerk.browser.js` blocked / slow / `ERR_BLOCKED_BY_CLIENT`         | Content blocker or extension, not our config. Retest in a clean profile (Step 0).                                                                                                                                                                                 |
| clerk-js loaded but `crypto.subtle` unavailable                                          | Insecure context. Not applicable to `https://staging.tavliai.com`, but it is exactly what made the Sign In button look dead in local device testing — remember it before blaming iOS.                                                                             |
| Sign-in succeeds at Clerk but Convex calls return `401`                                  | `CLERK_JWT_ISSUER_DOMAIN` on `aromatic-dog-762` does not match the live instance (Step 1). The page then renders empty/broken even though the user _is_ signed in.                                                                                                |
| First click never issues **any** request                                                 | Client-side: the button rendered before clerk-js was ready. Check that the surface gates on `isLoaded` (`useAuth()`), and check the console for a Clerk error at mount.                                                                                           |

Also capture the **console** for the first click — Clerk logs its own errors
there, and a swallowed promise rejection is often the only trace of an attempt
that "did nothing".

## Step 6 — Clerk dashboard logs for the two attempts

Clerk records both attempts server-side; this is the cheapest way to learn
whether the first click reached Clerk at all.

Clerk Dashboard → staging instance → **Logs** (and **Users → the test user →
Sessions**, plus **Sessions** on the instance). For the timestamp window of the
reproduction, record:

- Whether **one** or **two** sign-in attempts appear. If only one appears, the
  first click never reached Clerk → client-side (clerk-js load, hydration,
  blocked request). If two appear and the first has an error/abandoned status,
  the reason string on it is the answer.
- The failure reason on the first attempt verbatim (e.g. verification expired,
  identifier not found, bot protection, OAuth error).
- The session's `created` vs the client's `created` timestamps — a client
  created only on the second attempt corroborates Step 4.

## Step 7 — iPad / Safari ITP specifics

Do this pass on the actual reported class of device, because Safari's Intelligent
Tracking Prevention makes several of the above hypotheses _only_ reproduce here.

- Safari blocks third-party cookies outright by default, and ITP additionally
  caps script-writable storage. A Clerk setup that is first-party on Chrome may
  still be third-party on Safari if the Frontend API is on `*.accounts.dev`.
- Test both: **Settings → Safari → Prevent Cross-Site Tracking** on (default)
  and off. A behaviour difference is a cookie-partitioning finding (Step 4).
- Test a **private tab** vs a normal tab: private tabs get a separate, empty
  cookie jar, so a first-click failure reproduces reliably there.
- Remote-inspect the iPad to get a real network log: connect it to a Mac, enable
  **Settings → Safari → Advanced → Web Inspector**, then Safari on the Mac →
  **Develop → \<device\> → staging.tavliai.com**. Screenshots of a phone screen
  are not evidence; a HAR is.
- If a physical iPad is not available, the repo's BrowserStack path
  (`pnpm test:e2e:device`, `e2e/device/`) drives a real iOS device — but note it
  runs against a **cloudflared tunnel of local dev**, not staging, so it
  validates the app, not staging's Clerk configuration. Do not report a green
  device suite as evidence about staging.

## Step 8 — What to capture before escalating to Clerk support

Clerk's first reply will ask for most of this. Collect it **all** in one pass —
the reproduction is fragile (Step 0) and you may not get it back.

- [ ] **Instance identifier**: dev or production, the instance id / Frontend API
      host, and the publishable key **prefix only** (`pk_test_…` / `pk_live_…`).
      Never paste `sk_*` keys into a support ticket.
- [ ] **Exact URL** of the page where the sign-in was initiated, and which entry
      point (`mode="redirect"` vs `mode="modal"`).
- [ ] **HAR file** covering both clicks, recorded with _Preserve log_ on, from a
      fresh profile. Confirm it contains the Frontend API requests.
- [ ] **Console log** export for the same window.
- [ ] **Cookie inventory** after click 1 and after click 2: name, domain,
      `SameSite`, `Secure`, `Partitioned`; plus any "blocked cookie" flags Chrome
      reported.
- [ ] **Clerk dashboard log entries** for both attempts (screenshot or ids) and
      the user id / session id involved.
- [ ] **Timestamps with timezone**, and the client's egress IP (for rate-limit /
      geo-block correlation).
- [ ] **Browser + OS + device**, and whether third-party cookies / Prevent
      Cross-Site Tracking were enabled.
- [ ] **Attack-protection settings** as recorded in Step 2.
- [ ] The **reproduction matrix** from Step 0 — including the rows that _worked_.
      Negative results are what let Clerk narrow it.
- [ ] Confirmation of whether email/password sign-in shows the same two-click
      behaviour.

## Candidate fixes, mapped to findings

Only apply the one your evidence supports.

| Finding                                                                         | Fix                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging runs a Clerk **development** instance (interstitial + `*.accounts.dev`) | Give staging its own **production** instance on a first-party subdomain (e.g. `clerk-staging.tavliai.com`) via [`clerk-go-live.md`](./clerk-go-live.md). Requires a **rebuild** (`pk_*` is baked at build time) plus the Convex issuer change on `aromatic-dog-762`. |
| Third-party `__client` cookie blocked (Safari/ITP, Chrome 3P blocking)          | Same as above — a first-party Frontend API domain. Do not ship guidance telling users to disable tracking prevention.                                                                                                                                                |
| OAuth redirect URI / allowed origin wrong                                       | Fix the Google OAuth client's authorized redirect URI (Clerk host, `…/v1/oauth_callback`) and Clerk's allowed redirect origins.                                                                                                                                      |
| Shared dev Google credentials                                                   | Move to custom Google credentials (Step 2 of [`clerk-go-live.md`](./clerk-go-live.md)).                                                                                                                                                                              |
| Bot protection swallowing the first submit                                      | Adjust the attack-protection mode for the staging instance, or accept it and surface the challenge; either way document it.                                                                                                                                          |
| Convex `401` after a successful Clerk sign-in                                   | `npx convex env set CLERK_JWT_ISSUER_DOMAIN <issuer>` on `aromatic-dog-762` — applies immediately, no rebuild.                                                                                                                                                       |
| First click issues no request at all                                            | App-side: gate the sign-in affordance on `isLoaded` from `useAuth()` so it cannot be clicked before clerk-js is ready.                                                                                                                                               |

After any change that touches `VITE_CLERK_PUBLISHABLE_KEY`, **redeploy staging**
(a restart is not enough) and re-run the Step 0 matrix from a fresh profile.

## Not this: the iPad "organization" report

The separate iPad report — an owner could not see their organization in the
create-restaurant modal — is **not** a Clerk, device, or session problem. Root
cause: `organizations.getAllOrganizations` required the `admin` role while the
create-restaurant affordance and `restaurants.create` only required `owner`, so
an owner's org query returned `NOT_AUTHORIZED` and the frontend hook swallowed
it into an empty `<select>`. Fixed in TAVLI-71 item 8 (tiered query: admins see
all organizations, owners see their own; the picker now renders explicit
loading / error / empty states).

Keep the two reports separate in the ticket. Conflating them is how a
five-minute authorization bug turns into a week of device testing.
