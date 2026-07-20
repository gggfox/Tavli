# Production readiness checklist

A grounded, evidence-based readiness assessment from a full-codebase audit (2026-07-18)
across six dimensions: auth/authorization, payments, backend robustness, observability &
ops, frontend/UX, and data/config. Each item is marked with severity and file evidence.
This is the parent tracker that TAVLI-1 ("Prod configuration"), the tech-debt records,
and the observability work (TAVLI-9) roll up into.

Legend: 🔴 blocker · 🟠 high · 🟡 medium · ✅ done · ⚙️ config/manual verify

## Status — 2026-07-20

**Every code-level finding from the 2026-07-18 audit is now merged into `main`** — the
🔴 blockers, the 🟠 high items, and the whole 🟡 medium hardening rollup including the
frontend slice ([#71](https://github.com/gggfox/Tavli/pull/71), merged 2026-07-20). What
is left is operational, a product decision, and the two dimensions the audit could not
close from code: error tracking and staff-tablet responsive coverage. The verdict and
dimension table below have been updated to match; the per-item evidence (`file:line`,
severity, original wording) is preserved throughout so the audit trail stays intact.

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

**What is genuinely left before real traffic:**

1. **Error tracking** — the only original blocker with no work started. → **TAVLI-9**
2. **Stripe live-mode cutover** — dashboard/config work, not code. → **TAVLI-46**
3. **Operational steps against prod** — run the first-admin bootstrap once; confirm the
   masked `CONVEX_ENV` / `PUBLIC_APP_URL` values; set `RESERVATIONS_BOT_TOKEN`.
4. **Code paths never exercised against live Stripe** — the refund/dispute handlers and
   the stuck-tab reconciler are unit-tested against fixtures only. Replay real test-mode
   events before trusting them. See the caveat under Payments below.

## Overall verdict

**Materially closer — the code gaps are closed, the remaining risk is operational.**
Auth/authorization and the deploy/secrets pipeline are solid (the ~28-finding security
remediation plus, now, an empirically-verified Clerk JWT claim). The three clusters that
blocked launch in the original audit — payments edge-cases, observability, and data
bootstrap — have all landed in `main`, as has the full medium hardening rollup. What
stands between here and real traffic is no longer mostly engineering: it is **error
tracking**, the **Stripe live cutover**, a handful of **one-time prod operations**, and
**validating the new Stripe paths against live test-mode events**. The one genuinely
open engineering item is **staff-tablet responsive coverage** (TAVLI-59).

| Dimension           | Status             | Headline                                                                                              |
| ------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| Auth & RBAC         | ✅ **Ready**       | Clerk SSR + per-restaurant RBAC uniform; JWT `email_verified` claim empirically verified on prod      |
| Deploy & secrets    | ✅ **Ready**       | Infisical model live & documented; Clerk prod instance; post-deploy health gate + failure alerting    |
| Backend robustness  | ✅ **Ready**       | Every audit finding merged: hot-path index, rate limiting, bounded crons, audit logging, bot boundary |
| Payments            | 🟠 **Conditional** | Commission, reconciliation, refund/dispute webhooks all merged — but unexercised against live Stripe  |
| Observability & ops | 🟠 **Conditional** | Health gate + deploy alerting merged; **error tracking still missing** (TAVLI-9)                      |
| Data & config       | 🟠 **Conditional** | Bootstrap + index shipped; prod still needs the bootstrap actually run and env values confirmed       |
| Frontend / UX       | 🟠 **Conditional** | Localization, hydration, boundaries, list perf and tokens all merged; staff-tablet responsive open    |

---

## 🔴 Go / No-Go blockers (resolve before taking real traffic)

- [x] **Confirm the platform commission rate.** ~~Code charges **6%**~~ Fixed: `PLATFORM_APPLICATION_FEE_RATE` is now `0.12` across both Stripe payment paths, matching TAVLI-1's decision. → merged in [#50](https://github.com/gggfox/Tavli/pull/50) (TAVLI-49)
- [ ] **Decide the refund story for tab payments.** `createRefund` throws for the tab flow — the only live path (`convex/stripe.ts:523-528`). **Half of this is now closed:** [#56](https://github.com/gggfox/Tavli/pull/56) (TAVLI-53) records `charge.refunded` events, so a refund issued manually from the Stripe dashboard is now reflected in-app instead of silently diverging. What remains is the product decision: **build in-app refund initiation, or formally adopt a dashboard-only SOP** now that the recording side exists. → **TAVLI-50**, still needs that decision
- [x] **First-admin bootstrap for the empty prod DB.** Added a guarded `internalMutation` (only invokable via `npx convex run`/dashboard) that promotes an existing user to owner+admin, gated by an explicit env opt-in and refusing if any owner/admin already exists; documented operator procedure in `deployment-and-secrets.md`. → merged in [#54](https://github.com/gggfox/Tavli/pull/54) (TAVLI-51). _Still needed: actually run it once against prod to create the first admin and confirm `/admin/restaurants` loads — the code shipping doesn't mean prod has been bootstrapped yet._
- [ ] **Error tracking (frontend + Convex).** None exists — no Sentry/Rollbar/etc. (`package.json` clean). Production exceptions are invisible unless someone is watching the Convex dashboard. Wire a capture sink into the existing `ErrorBoundary` `onError` prop. → **TAVLI-9**
- [x] **Post-deploy health gate + deploy-failure alerting.** ~~`deploy.yml` fires the Dokploy webhook and stops~~ Fixed: a real `/health` endpoint reports the running commit SHA, the deploy workflow polls it until it serves the just-deployed SHA (failing the job on timeout), and an `if: failure()` step files a `deploy-failure` GitHub issue. Addresses postmortem action items #4–#5 — the class of failure behind the 4-day staging outage. → merged in [#55](https://github.com/gggfox/Tavli/pull/55) (TAVLI-52). _Untuned against a real cold boot: the 5-min gate could false-fail if Nitro + Infisical startup ever exceeds it._

---

## 🟠 High priority (before launch, or immediately after)

- [x] **Payment reconciliation for stuck "processing" tabs.** A cron now finds sessions locked past a threshold with a stored PaymentIntent, retrieves the PI from Stripe, and settles / unlocks / waits accordingly — so a dropped webhook no longer locks a tab forever. → merged in [#53](https://github.com/gggfox/Tavli/pull/53) (TAVLI-45). _Known gap: if the checkout action dies between setting the lock and creating the PaymentIntent, the tab has no PI id and the reconciler can't see it. Alerting is `console.error` only until TAVLI-9 lands._
- [x] **Refund + dispute webhook handling.** `charge.refunded` and `charge.dispute.created/closed` are now handled idempotently, recorded against the payment/session records, audit-logged, and logged loudly. Since the platform is `losses_collector` (`stripe.ts:107`), this closes the silent-chargeback hole. → merged in [#56](https://github.com/gggfox/Tavli/pull/56) (TAVLI-53). ⚠️ **Verify before relying on it:** `computeRefundFacts` reads `charge.refunds.data[0]`, which Stripe does **not** expand by default in webhook payloads on SDK v22 — so `stripeRefundId` may come back unset in production even though the fixture-based tests pass. The new event types must also be added to the live webhook destinations (TAVLI-46).
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

- [ ] **Prod Convex (`polite-antelope-545`) env.** Verified 2026-07-19: `CLERK_JWT_ISSUER_DOMAIN=https://clerk.tavliai.com` ✅, `OPENROUTER_API_KEY` ✅, `RESEND_*` ✅. **Still open:** `CONVEX_ENV` and `PUBLIC_APP_URL` are _present_ but their values are masked in the dashboard — confirm they read `production` and `https://tavliai.com` respectively (a wrong `CONVEX_ENV` re-enables dev gating; a wrong `PUBLIC_APP_URL` breaks every invite link). `RESERVATIONS_BOT_TOKEN` (≥32 chars) and the Stripe secrets are not set yet.
- [ ] **Both dev-role-switcher kill-switches off in prod.** Convex `ENABLE_DEV_ROLE_SWITCHER` is confirmed **unset** ✅ (2026-07-19 — the prod env list runs `CONVEX_ENV` → `OPENROUTER_API_KEY` with no `E*` entry between them). The frontend build's `VITE_DEV_ROLE_SWITCHER_ENABLED` lives in **Infisical `prod`** and is **still unconfirmed** — both must be off.
- [ ] **Stripe live-mode cutover:** swap `sk_test→sk_live` (Convex) + `pk_test→pk_live` (Infisical, rebuild); create **live** webhook destinations at `https://<slug>.convex.site/stripe/webhook` and `/stripe/connect-webhook` (`.convex.site`, not `.cloud`) with fresh secrets — **including the new `charge.refunded` / `charge.dispute.*` event types** from [#56](https://github.com/gggfox/Tavli/pull/56); enable the live Connect platform profile; **re-onboard every restaurant** (test-mode account IDs are invalid in live). → **TAVLI-46**
- [x] **Shared-employee Clerk credential — N/A today; nothing is bound.** Verified 2026-07-19 against prod: `sharedEmployeeClerkSubject` does not appear in the `restaurants` table's inferred schema, and `employeeAccounts` / `restaurantMembers` are both empty — the kiosk tier is entirely unused in production, so there are no credentials to audit. The policy to apply **before the first binding** (dedicated per-restaurant Clerk user, generated 20+ char password in a password manager, never a personal credential, deliberate MFA choice, rotation when device-holders leave) is carried on **TAVLI-1**.
- [x] **Clerk `emailVerified` claim.** Verified empirically 2026-07-19 by decoding the live `convex`-template token from a signed-in prod session: `email_verified: true`, `iss: https://clerk.tavliai.com`, `aud: convex`. Confirmed **dynamic, not hardcoded** — the same token carries `phone_number_verified: false` for a user with no phone, which a hardcoded-`true` template could not produce. `acceptInvitation` (`invites.ts:274`) reads `emailVerified ?? email_verified`, so it resolves either casing. → **TAVLI-48**
- [ ] **Run additive backfills** after the first prod schema push (`convex/migrations/*`).
- [ ] **Bootstrap the first prod admin.** The guarded `admin.bootstrapFirstAdmin` shipped in [#54](https://github.com/gggfox/Tavli/pull/54), but **prod has not been bootstrapped** — `/admin/restaurants` will still show "Access Denied" until it is run once. Procedure: `deployment-and-secrets.md` → First-admin bootstrap.
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
- [ ] **Refresh `stripe-go-live.md`** to the Infisical model — still open (zero mentions of Infisical in the runbook today). Fold into **TAVLI-46**, since that is the ticket whose operator will follow it. `email-deliverability.md` was refreshed in [#59](https://github.com/gggfox/Tavli/pull/59) ✅
- [x] **Rewrite `design-system.md`** — ~~dark-only, still says "Fierro Viejo", teaches the `bg-[#0f0f0f]` arbitrary-value antipattern that `theme.css` forbids~~ rewritten against the real Tailwind v4 `@theme` token system. The internal-guides index was also wrong — it pointed at a `component-examples.md` that does not exist. → merged in [#71](https://github.com/gggfox/Tavli/pull/71) (TAVLI-64)
- [x] `TAVLI-48` (Clerk) → **Done**; `TAVLI-47` (Resend) → **Done**; `TAVLI-49` (commission) → **Done**; `TAVLI-61`/`62`/`63`/`64` (the whole medium hardening rollup) → **Done**. TAVLI-1 is down to **TAVLI-46 (Stripe)** as its last open integration.
