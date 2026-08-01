# Production readiness checklist

A grounded, evidence-based readiness assessment from a full-codebase audit (2026-07-18)
across six dimensions: auth/authorization, payments, backend robustness, observability &
ops, frontend/UX, and data/config. Each item is marked with severity and file evidence.
This is the parent tracker that TAVLI-1 ("Prod configuration"), the tech-debt records,
and the observability work (TAVLI-9) roll up into.

Legend: 🔴 blocker · 🟠 high · 🟡 medium · ✅ done · ⚙️ config/manual verify

## Status — 2026-08-01

**TAVLI-1 ("Prod configuration") is closed.** Every code-level finding from the
2026-07-18 audit is merged into `main`, and since the last update the operational side
has landed too: the **Stripe live-mode cutover is complete and verified against real
live events** (TAVLI-46, closed 2026-08-01), **in-app refund initiation shipped**
([#79](https://github.com/gggfox/Tavli/pull/79), TAVLI-50 — closing the last 🔴 product
decision), the **first prod admin is bootstrapped** (prod `userRoles` populated, verified
2026-08-01), and the go-live runbook was refreshed
([#80](https://github.com/gggfox/Tavli/pull/80)/[#81](https://github.com/gggfox/Tavli/pull/81)).
The deploy pipeline also hardened further: immutable-image rollout + failure
classification ([#77](https://github.com/gggfox/Tavli/pull/77)) and container-credential
preflight with a corrected postmortem root cause
([#78](https://github.com/gggfox/Tavli/pull/78)).

The verdict and dimension table below have been updated to match; the per-item evidence
(`file:line`, severity, original wording) is preserved throughout so the audit trail
stays intact.

**Merged since the audit — blockers & high:**

| Finding                                        | PR                                             | Ticket   |
| ---------------------------------------------- | ---------------------------------------------- | -------- |
| Commission rate → 12%                          | [#50](https://github.com/gggfox/Tavli/pull/50) | TAVLI-49 |
| `orders` hot-path index                        | [#51](https://github.com/gggfox/Tavli/pull/51) | TAVLI-54 |
| Invite emails: no localhost fallback in prod   | [#52](https://github.com/gggfox/Tavli/pull/52) | TAVLI-57 |
| Reconcile tabs stuck locked-for-payment        | [#53](https://github.com/gggfox/Tavli/pull/53) | TAVLI-45 |
| Guarded first-admin bootstrap                  | [#54](https://github.com/gggfox/Tavli/pull/54) | TAVLI-51 |
| Real `/health` + post-deploy gate + alerting   | [#55](https://github.com/gggfox/Tavli/pull/55) | TAVLI-52 |
| `charge.refunded` + `charge.dispute.*`         | [#56](https://github.com/gggfox/Tavli/pull/56) | TAVLI-53 |
| Bound + rate-limit anonymous reservation reads | [#57](https://github.com/gggfox/Tavli/pull/57) | TAVLI-56 |
| Error → i18n mapping, no raw backend errors    | [#58](https://github.com/gggfox/Tavli/pull/58) | TAVLI-55 |
| Email runbook → Infisical model                | [#59](https://github.com/gggfox/Tavli/pull/59) | TAVLI-47 |

**Merged since — 🟡 medium hardening (the TAVLI-60 rollup):**

| Finding                                                                                                 | PR                                             | Ticket   |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------- |
| Bounded `sweepNoShows` / `sweepStaleOpenTabs` cron scans                                                | [#66](https://github.com/gggfox/Tavli/pull/66) | TAVLI-62 |
| Audit-logged the order / session / reservation lifecycles                                               | [#68](https://github.com/gggfox/Tavli/pull/68) | TAVLI-63 |
| Bot HTTP boundary, `getAllFeatureFlags` gate, Stripe `apiVersion`, timezone defaults, TDR-0001 archived | [#65](https://github.com/gggfox/Tavli/pull/65) | TAVLI-61 |
| Frontend: language hydration, error boundaries, list perf, tokens                                       | [#71](https://github.com/gggfox/Tavli/pull/71) | TAVLI-64 |

**Merged since — cutover & launch wave (2026-07-25 → 08-01):**

| Finding                                                          | PR                                                                                            | Ticket   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------- |
| Resolve refund id when `charge.refunded` omits the refunds list  | [#75](https://github.com/gggfox/Tavli/pull/75)                                                | TAVLI-46 |
| Immutable-image rollout + rollout-failure classification         | [#77](https://github.com/gggfox/Tavli/pull/77)                                                | —        |
| Container-credential preflight + corrected postmortem root cause | [#78](https://github.com/gggfox/Tavli/pull/78)                                                | —        |
| In-app refund initiation for tab payments                        | [#79](https://github.com/gggfox/Tavli/pull/79)                                                | TAVLI-50 |
| `stripe-go-live.md` → Infisical model (+ Connect corrections)    | [#80](https://github.com/gggfox/Tavli/pull/80)/[#81](https://github.com/gggfox/Tavli/pull/81) | TAVLI-46 |

**What is genuinely left before real traffic:**

1. **Error tracking** — the last open blocker, now **in progress**: PostHog integration
   on [#64](https://github.com/gggfox/Tavli/pull/64). → **TAVLI-9**
2. **Staff/tablet responsive coverage** → **TAVLI-59**; iPhone side on
   [#60](https://github.com/gggfox/Tavli/pull/60) (TAVLI-4).
3. **Convex backup posture + restore runbook** → **TAVLI-58** (untouched).
4. **Two residual config confirmations** — `RESERVATIONS_BOT_TOKEN` (only gates the
   not-yet-live bot API) and `VITE_DEV_ROLE_SWITCHER_ENABLED` off in Infisical `prod`.
5. **Onboard the first real restaurant** — reframed from "re-onboard every restaurant":
   prod has exactly one restaurant row and it is a test record.

~~Stripe live-mode cutover~~ ✅ done & live-verified (TAVLI-46). ~~First-admin
bootstrap~~ ✅ run (prod `userRoles` populated). ~~Replay test-mode events~~ ✅ done —
and the `computeRefundFacts` suspicion **was correct**: live `charge.refunded` events
carry no `refunds` list, fixed with a `refunds.list` lookup in
[#75](https://github.com/gggfox/Tavli/pull/75), verified against a resent real event.

**New follow-ups out of the cutover verification:** **TAVLI-65** — handle the other 13
`v2.core.account*` thin-event types the live Connect destination subscribes to (only 2
have handlers; the rest log `Unhandled thin event type`); **TAVLI-66** — restaurant
purge misses 8 of 31 restaurant-scoped tables.

## Overall verdict

**Production-ready pending error tracking.** Every code finding is merged, the Stripe
live cutover is complete and **verified against real live events** (fee math excluding
tips, settlement, partial refunds, the full dispute lifecycle, and the reconciler
running on schedule in production), the first prod admin exists, and the deploy/secrets
pipeline has been hardened twice over. What remains: **error tracking** (in progress,
[#64](https://github.com/gggfox/Tavli/pull/64)), **staff-tablet responsive coverage**
(TAVLI-59), the **backup/restore runbook** (TAVLI-58), and two residual config
confirmations.

| Dimension           | Status             | Headline                                                                                                                       |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Auth & RBAC         | ✅ **Ready**       | Clerk SSR + per-restaurant RBAC uniform; JWT `email_verified` claim empirically verified on prod                               |
| Deploy & secrets    | ✅ **Ready**       | Infisical model live & documented; health gate + alerting; immutable images + credential preflight (#77/78)                    |
| Backend robustness  | ✅ **Ready**       | Every audit finding merged: hot-path index, rate limiting, bounded crons, audit logging, bot boundary                          |
| Payments            | ✅ **Ready**       | Live cutover complete; refunds (incl. in-app + partial), disputes, reconciler all verified on live Stripe                      |
| Observability & ops | 🟠 **Conditional** | Health gate + deploy alerting merged; **error tracking in progress** ([#64](https://github.com/gggfox/Tavli/pull/64), TAVLI-9) |
| Data & config       | ✅ **Ready**       | First admin bootstrapped; live Stripe secrets fingerprint-verified; two low-stakes confirmations left                          |
| Frontend / UX       | 🟠 **Conditional** | Localization, hydration, boundaries, list perf and tokens all merged; staff-tablet responsive open                             |

---

## 🔴 Go / No-Go blockers (resolve before taking real traffic)

- [x] **Confirm the platform commission rate.** ~~Code charges **6%**~~ Fixed: `PLATFORM_APPLICATION_FEE_RATE` is now `0.12` across both Stripe payment paths, matching TAVLI-1's decision. → merged in [#50](https://github.com/gggfox/Tavli/pull/50) (TAVLI-49)
- [x] **Decide the refund story for tab payments.** ~~`createRefund` throws for the tab flow~~ Decided **and built**: in-app refund initiation for tab payments shipped in [#79](https://github.com/gggfox/Tavli/pull/79) (TAVLI-50), on top of the `charge.refunded` recording from [#56](https://github.com/gggfox/Tavli/pull/56). Partial refunds were verified against live Stripe during the TAVLI-46 cutover.
- [x] **First-admin bootstrap for the empty prod DB.** Added a guarded `internalMutation` (only invokable via `npx convex run`/dashboard) that promotes an existing user to owner+admin, gated by an explicit env opt-in and refusing if any owner/admin already exists; documented operator procedure in `deployment-and-secrets.md`. → merged in [#54](https://github.com/gggfox/Tavli/pull/54) (TAVLI-51). _~~Still needed: actually run it once against prod~~ **Run.** Verified 2026-08-01: prod `userRoles` now has a populated inferred schema (an empty table infers nothing), so the first admin exists._
- [ ] **Error tracking (frontend + Convex).** None exists — no Sentry/Rollbar/etc. (`package.json` clean). Production exceptions are invisible unless someone is watching the Convex dashboard. Wire a capture sink into the existing `ErrorBoundary` `onError` prop. → **TAVLI-9**, now **in progress**: PostHog integration open on [#64](https://github.com/gggfox/Tavli/pull/64) — the last open blocker.
- [x] **Post-deploy health gate + deploy-failure alerting.** ~~`deploy.yml` fires the Dokploy webhook and stops~~ Fixed: a real `/health` endpoint reports the running commit SHA, the deploy workflow polls it until it serves the just-deployed SHA (failing the job on timeout), and an `if: failure()` step files a `deploy-failure` GitHub issue. Addresses postmortem action items #4–#5 — the class of failure behind the 4-day staging outage. → merged in [#55](https://github.com/gggfox/Tavli/pull/55) (TAVLI-52). _Untuned against a real cold boot: the 5-min gate could false-fail if Nitro + Infisical startup ever exceeds it._

---

## 🟠 High priority (before launch, or immediately after)

- [x] **Payment reconciliation for stuck "processing" tabs.** A cron now finds sessions locked past a threshold with a stored PaymentIntent, retrieves the PI from Stripe, and settles / unlocks / waits accordingly — so a dropped webhook no longer locks a tab forever. → merged in [#53](https://github.com/gggfox/Tavli/pull/53) (TAVLI-45). Since verified live during the TAVLI-46 cutover: the `unlock` branch fired correctly against a real `paymentIntents.retrieve`, and the cron is confirmed running on schedule in production. _Known gap: if the checkout action dies between setting the lock and creating the PaymentIntent, the tab has no PI id and the reconciler can't see it. Alerting is `console.error` only until TAVLI-9 lands._
- [x] **Refund + dispute webhook handling.** `charge.refunded` and `charge.dispute.created/closed` are now handled idempotently, recorded against the payment/session records, audit-logged, and logged loudly. Since the platform is `losses_collector` (`stripe.ts:107`), this closes the silent-chargeback hole. → merged in [#56](https://github.com/gggfox/Tavli/pull/56) (TAVLI-53). ~~⚠️ Verify before relying on it: `computeRefundFacts` reads `charge.refunds.data[0]`, which Stripe does not expand by default…~~ **The suspicion was correct** — live `charge.refunded` payloads carry no `refunds` list, so `stripeRefundId` was never written and `refundedAt` fell back to processing time. Fixed with a `refunds.list` lookup in [#75](https://github.com/gggfox/Tavli/pull/75) and verified end-to-end against a resent real event. The event types are subscribed on the live destinations (TAVLI-46 ✅), plus `payment_intent.canceled`, `charge.dispute.updated`/`funds_reinstated` and `radar.early_fraud_warning.created` subscribed ahead of their handlers → **TAVLI-65**.
- [x] **`orders` hot-path index.** New `by_restaurant_status` index on `orders`; the kitchen dashboard and analytics widget now query per-status instead of collecting the full restaurant order history. → merged in [#51](https://github.com/gggfox/Tavli/pull/51) (TAVLI-54)
- [x] **Error localization is broken end-to-end.** Fixed: a registry (`src/global/i18n/keys/errors.ts`) maps every stable backend code to an `errors.<CODE>` key with EN/ES parity, and `extractErrorCode` resolves the **specific** code over the generic category — the actual shape this backend produces (`.name` = category, `.message` = specific code, via returned result tuples). Raw `error.message` no longer reaches user-facing surfaces. → merged in [#58](https://github.com/gggfox/Tavli/pull/58) (TAVLI-55). _~8 low-traffic admin/debug surfaces still render raw messages (`DashboardPage.tsx:193`, `useMenuImport.ts:62,96`, the org dialogs, `FeatureFlagsTable.tsx:65`, the auth-debug panels) — tracked as follow-up._
- [x] **Rate limit anonymous public endpoints.** Availability queries now bound the work (tightened date-range validators, capped iterations); `reservations.create` is sliding-window rate-limited per restaurant/contact. → merged in [#57](https://github.com/gggfox/Tavli/pull/57) (TAVLI-56). _Residual: Convex queries can't hold state for true rate limiting, so the availability reads are bounded per-call, not throttled in aggregate — reduced DoS surface, not eliminated._
- [ ] **Staff/tablet responsive coverage.** Only ~34 breakpoint prefixes across 196 components; polish is concentrated in customer ordering. Staff surfaces (schedule grid, reservation timeline, data tables) are desktop-first. Restaurants run these on tablets. Needs device testing to scope. → **TAVLI-59** (staff/tablet); iPhone side is **TAVLI-4**, in progress on [#60](https://github.com/gggfox/Tavli/pull/60)
- [x] **Invite emails fall back to `localhost:3000`.** Fixed: `getAppUrl()` (`convex/_util/env.ts`) falls back to localhost **only** in development and throws the stable `APP_URL_NOT_CONFIGURED` code in staging/production — failing loud beats emailing a real invitee a dead link. → merged in [#52](https://github.com/gggfox/Tavli/pull/52) (TAVLI-57). _Depends on `PUBLIC_APP_URL` actually being set on prod Convex — see the config section._
- [ ] **Convex backup + restore procedure.** No configured/documented backup, export job, or restore runbook (relies on unconfigured platform defaults). Confirm Convex's backup posture and write a restore runbook. → **TAVLI-58**

---

## 🟡 Medium (hardening — soon after launch)

Rolled up as **TAVLI-60** and scheduled 2026-07-19 into four sub-issues — **all four are
now merged.** Observability depth is the only item on the rollup with no work started.

- [x] **Audit-log the money & reservation lifecycles.** ~~`appendAuditEvent` count is **0**~~ Two corrections to the original finding: the table is `allEvents` (not `auditLogs`), and the count was not strictly zero — `stripeHelpers.ts` and `tips.ts` already wrote. The real gap was orders, sessions, reservations and the payment paths, which now emit events through a typed `AUDIT_EVENT` registry with accurate actor attribution (any tab member can act, so the session opener is _not_ the actor; crons and webhooks record a system user). → merged in [#68](https://github.com/gggfox/Tavli/pull/68) (TAVLI-63). _Residual: ~40 inline event-name strings in menus/shifts/restaurantMembers still bypass the registry._
- [x] **Harden the reservations-bot HTTP boundary.** Bot routes now type-validate the body (`partySize: "5"` used to pass), resolve `restaurantId` through a `normalizeRestaurantId` internalQuery instead of a blind cast (unknown/soft-deleted → 404), wrap `runQuery`/`runMutation` in try/catch behind an opaque 500, and return only the stable error code. New `convex/_tests/http.test.ts` — there was no HTTP test file. → merged in [#65](https://github.com/gggfox/Tavli/pull/65) (TAVLI-61)
- [x] **Bound cron table scans.** `sweepNoShows` now runs one `by_restaurant_status_time` pass per sweepable status inside a lookback window with a batch cap; `sweepStaleOpenTabs` got a new `by_status_started` index and the same treatment, replacing a `.collect()` of every session ever written. Both return counts so a run is observable. → merged in [#66](https://github.com/gggfox/Tavli/pull/66) (TAVLI-62). _Deliberate tradeoff: rows older than the lookback (7d reservations / 30d tabs) keep their last status rather than being re-read forever._
- [x] **Pin the Stripe API version.** Pinned to `2026-05-27.dahlia` — what `stripe@22.2.2` already resolved to, so behaviour-preserving — plus `maxNetworkRetries` and `appInfo`. The in-code comment claiming `2026-03-25.dahlia` was stale and is fixed. → merged in [#65](https://github.com/gggfox/Tavli/pull/65) (TAVLI-61)
- [x] **Align timezone defaults.** `orderServiceDate` now delegates to `resolveRestaurantTimezone` instead of falling back to UTC — the 6h skew across the 04:00 rollover only ever affected legacy rows with no `timezone`. → merged in [#65](https://github.com/gggfox/Tavli/pull/65) (TAVLI-61). _Already-stored `orderServiceDateKey` values are not recomputed._
- [x] **Gate `getAllFeatureFlags`.** Now admin-only, matching `setFeatureFlag`; `getFeatureFlag`/`isFeatureEnabled` stay anonymous on purpose (keyed lookups evaluated on every render). → merged in [#65](https://github.com/gggfox/Tavli/pull/65) (TAVLI-61)
- [x] **Frontend hardening.** Four findings, all fixed in [#71](https://github.com/gggfox/Tavli/pull/71) (TAVLI-64):
  - **Language hydration** — a cookie now leads the i18next detector chain and is read in the root `beforeLoad`, so `<html lang>` comes from router context instead of `i18n.language`; `/r/:slug/:lang/*` reads the URL segment during SSR and the post-hydration `useEffect` is gone. Normalization (`en-US` → `en`) consolidated in `src/global/i18n/language.ts`.
  - **Error boundaries** — a router `defaultErrorComponent` covers all 37 routes rather than 35 hand-written boundaries; the fallback UI was extracted into a presentational `ErrorFallback` so the class boundary (render errors) and the router's function `errorComponent` (loader/`beforeLoad` errors) render the same panel. `/admin` and `/r/$slug` override it where recovery differs — the latter's ad-hoc dead-end error UI now offers a real retry. `componentDidCatch` still only `console.error`s: telemetry is TAVLI-9.
  - **Perf** — new batched `menuItems.getByMenu` replaces one live subscription per category; the duplicate `getCategoriesByMenu` subscription is gone; the per-render `new Date()` and unmemoized availability filter that defeated the `visibleItems` memo are fixed; avatars and menu images carry intrinsic dimensions + `loading`/`decoding` hints; `@tanstack/react-virtual` now backs a shared `VirtualGrid` (reusing the ancestor scroll container via `useScrollParent` rather than nesting a second scrollbar) plus row virtualization in `ReservationsTable`.
  - **Design tokens** — 29 inline literals replaced. Two new tokens were genuinely needed: `--text-on-accent` (not `--text-inverse`, which flips with the theme and would have turned pill labels dark on a saturated fill) and `--overlay-scrim`. `TabCheckoutPage` keeps literals — Stripe Elements is a cross-origin iframe that cannot read CSS vars — but derives them from one exported token map. **`--bg-danger` was never declared**, so `InlineError` always used its dark-only hex fallback: a latent light-mode bug, not a style nit.

  _Also rewrote `design-system.md` (see doc cleanup below). `ReservationTimeline` was deliberately left unvirtualized — it needs its own ticket._

- [ ] **Observability depth:** real `/health` endpoint ✅ + CI health gate ✅ (merged, [#55](https://github.com/gggfox/Tavli/pull/55) / TAVLI-52) — **external uptime monitor, structured logging / Convex log-streaming, and the CI `.dockerignore` guard (postmortem #3) are still open.** Deliberately parked on TAVLI-60 rather than split out, because it overlaps **TAVLI-9**.

**Spun out of this work** (tracked on TAVLI-60, none blocking): virtualize
`ReservationTimeline` (1212 lines, eager O(sections × tables × hours) grid); finish the
repo-wide design-token sweep; retrofit `AUDIT_EVENT` over the ~40 legacy inline strings;
pin the Node version (no `engines.node`/`.nvmrc` — `pnpm build` fails on Node 26 while CI
uses 22); **per-request i18n instance** — now live in `main`: TAVLI-64's root `beforeLoad`
mutates the shared `i18n` module singleton across concurrent SSR requests. Safe today only
because those renders are synchronous with respect to it; an `await` introduced between
`beforeLoad` and render turns it into a cross-request language bleed. Worth a ticket.

---

## ⚙️ Config & manual verification (not code — verify on the prod deployments)

- [x] **Prod Convex (`polite-antelope-545`) env.** Verified 2026-07-19: `CLERK_JWT_ISSUER_DOMAIN=https://clerk.tavliai.com` ✅, `OPENROUTER_API_KEY` ✅, `RESEND_*` ✅; `CONVEX_ENV` / `PUBLIC_APP_URL` ticked off on TAVLI-1 (closed 2026-08-01). The **Stripe live secrets are now set and fingerprint-verified** to the production account `acct_1TGR3u…` — a _different_ Stripe account from dev (`acct_1TGR41…`). _Last residual: `RESERVATIONS_BOT_TOKEN` (≥32 chars) is not set — it only gates the `/api/v1/reservations/*` bot API, which is not live yet._
- [ ] **Both dev-role-switcher kill-switches off in prod.** Convex `ENABLE_DEV_ROLE_SWITCHER` is confirmed **unset** ✅ (2026-07-19 — the prod env list runs `CONVEX_ENV` → `OPENROUTER_API_KEY` with no `E*` entry between them). The frontend build's `VITE_DEV_ROLE_SWITCHER_ENABLED` lives in **Infisical `prod`** and is **still unconfirmed** — both must be off.
- [x] **Stripe live-mode cutover — complete and verified against live Stripe.** (TAVLI-46, closed 2026-08-01.) All of it done with evidence, not just configured: `sk_live`/`pk_live` fingerprint-verified to the prod account, `pk_live` confirmed baked into the served bundle after a rebuild; **live webhook destinations `tavli-prod-payments` (snapshot, 9 events) + `tavli-prod-connect-accounts` (thin, 15 events)** on `.convex.site`, both secrets **proven with real live deliveries returning 200**; live Connect platform profile enabled (three sequential undiscoverable gates) and verified by creating + closing a real live connected account; stale `checkout.session.*` subscriptions pruned and dead `account.updated` dropped. Beyond original scope, verified live: **12% fee reaches Stripe and excludes tips**, `payment_intent.succeeded` → settlement, full dispute lifecycle, partial refunds. _~~Re-onboard every restaurant~~ reframed: prod has exactly one restaurant row and it is a test record — onboard the first real restaurant at launch._
- [x] **Shared-employee Clerk credential — N/A today; nothing is bound.** Verified 2026-07-19 against prod: `sharedEmployeeClerkSubject` does not appear in the `restaurants` table's inferred schema, and `employeeAccounts` / `restaurantMembers` are both empty — the kiosk tier is entirely unused in production, so there are no credentials to audit. The policy to apply **before the first binding** (dedicated per-restaurant Clerk user, generated 20+ char password in a password manager, never a personal credential, deliberate MFA choice, rotation when device-holders leave) is carried on **TAVLI-1**.
- [x] **Clerk `emailVerified` claim.** Verified empirically 2026-07-19 by decoding the live `convex`-template token from a signed-in prod session: `email_verified: true`, `iss: https://clerk.tavliai.com`, `aud: convex`. Confirmed **dynamic, not hardcoded** — the same token carries `phone_number_verified: false` for a user with no phone, which a hardcoded-`true` template could not produce. `acceptInvitation` (`invites.ts:274`) reads `emailVerified ?? email_verified`, so it resolves either casing. → **TAVLI-48**
- [x] **Run additive backfills** after the first prod schema push (`convex/migrations/*`) — ticked off on TAVLI-1 (closed 2026-08-01).
- [x] **Bootstrap the first prod admin.** ~~prod has not been bootstrapped~~ **Run.** Verified 2026-08-01: prod `userRoles` has a populated inferred schema (an empty table infers nothing), so the first owner+admin exists.
- [x] **Resend go-live.** Domain `tavliai.com` verified in Resend since 2026-07-13 — DKIM (`TXT resend._domainkey`), SPF (`MX send` + `TXT send`), and DMARC (`TXT _dmarc` → `v=DMARC1; p=none`) all confirmed; `RESEND_API_KEY` / `RESEND_FROM_ADDRESS` (`support@tavliai.com`) set on staging and prod. → **TAVLI-47**. _Remaining: one real end-to-end invite send on prod._

---

## ✅ Already solid (don't re-litigate)

- **Auth/RBAC:** Clerk SSR → Convex wired correctly; per-restaurant RBAC applied uniformly across all sampled modules; PINs CSPRNG + bcrypt with lockout; XOR (User vs EmployeeAccount) enforced.
- **Security remediation merged in `main`:** TAVLI-13 (diner IDOR), TAVLI-34 (dev-role gate, fail-closed), TAVLI-35 (log redaction), TAVLI-36 (inactive-menu leakage) verified fixed; ~28 `[Sec]` findings marked Done.
- **Payments happy path:** webhook signature verification, layered idempotency (Stripe keys + status short-circuit + snapshot re-validation), correct destination-charge + fee-on-subtotal math, SAQ-A PCI scope.
- **Deploy & secrets:** Infisical machine-identity model live on staging + prod, documented (`deployment-and-secrets.md`); strong pre-merge CI gate; SHA-tagged images for manual rollback; container HEALTHCHECK present.
- **i18n:** CI-enforced EN/ES parity, Spanish genuinely complete, correct per-locale menu-content handling with historical snapshot fallback.
- **Clerk production instance** live (DNS+SSL, Google OAuth, `pk_live`/`sk_live`, issuer), with the `convex` JWT template's `email_verified` claim empirically verified against a real prod token. → **TAVLI-48** (Done)

---

## 📋 Doc & tracking cleanup

- [x] **Archive/rewrite TDR-0001** (`tech-debt/0001-missing-backend-authentication.md`) — ~~describes WorkOS + `convex/tasks.ts` that no longer exist~~ rewritten as an archived record; the gap is closed by Clerk + the RBAC guards in `convex/_util/auth.ts`. The tech-debt index was also wrong — it linked a TDR-0004 that was never written and omitted the TDR-0005 that exists. → merged in [#65](https://github.com/gggfox/Tavli/pull/65) (TAVLI-61)
- [x] **Refresh `stripe-go-live.md`** to the Infisical model — ~~zero mentions of Infisical in the runbook~~ refreshed in [#80](https://github.com/gggfox/Tavli/pull/80), with Connect-secret and reset guidance corrected in [#81](https://github.com/gggfox/Tavli/pull/81). `email-deliverability.md` was refreshed in [#59](https://github.com/gggfox/Tavli/pull/59) ✅
- [x] **Rewrite `design-system.md`** — ~~dark-only, still says "Fierro Viejo", teaches the `bg-[#0f0f0f]` arbitrary-value antipattern that `theme.css` forbids~~ rewritten against the real Tailwind v4 `@theme` token system. The internal-guides index was also wrong — it pointed at a `component-examples.md` that does not exist. → merged in [#71](https://github.com/gggfox/Tavli/pull/71) (TAVLI-64)
- [x] **TAVLI-1 ("Prod configuration") → Done 2026-08-01**, with all four integrations: `TAVLI-48` (Clerk), `TAVLI-47` (Resend), `TAVLI-49` (commission), `TAVLI-46` (Stripe live cutover). `TAVLI-50` (refund story) and the whole `TAVLI-60` medium-hardening rollup (`61`/`62`/`63`/`64`) are also Done. Open: **TAVLI-9** (in progress), **TAVLI-58**, **TAVLI-59**, **TAVLI-4** (in progress), and the new **TAVLI-65**/**TAVLI-66**.
