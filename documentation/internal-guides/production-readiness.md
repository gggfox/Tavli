# Production readiness checklist

A grounded, evidence-based readiness assessment from a full-codebase audit (2026-07-18)
across six dimensions: auth/authorization, payments, backend robustness, observability &
ops, frontend/UX, and data/config. Each item is marked with severity and file evidence.
This is the parent tracker that TAVLI-1 ("Prod configuration"), the tech-debt records,
and the observability work (TAVLI-9) roll up into.

Legend: 🔴 blocker · 🟠 high · 🟡 medium · ✅ done · ⚙️ config/manual verify

## Progress since audit (2026-07-19)

The verdict and table below are the original 2026-07-18 snapshot — left as-is for the
historical record. Status changes are tracked in the checklist items themselves (checked
= merged into `main`) and summarized here:

**Merged:**

- ✅ Commission rate fixed to 12% → [#50](https://github.com/gggfox/Tavli/pull/50) (TAVLI-49)
- ✅ First-admin bootstrap for the empty prod DB → [#54](https://github.com/gggfox/Tavli/pull/54) (TAVLI-51)
- ✅ `orders` hot-path index → [#51](https://github.com/gggfox/Tavli/pull/51) (TAVLI-54)
- ✅ Anonymous reservation endpoints bounded + rate-limited → [#57](https://github.com/gggfox/Tavli/pull/57) (TAVLI-56)

**Open for review (implemented, not yet merged):**

- 🔍 Invite emails: no localhost fallback in prod → [#52](https://github.com/gggfox/Tavli/pull/52) (TAVLI-57)
- 🔍 Reconcile tabs stuck locked-for-payment → [#53](https://github.com/gggfox/Tavli/pull/53) (TAVLI-45)
- 🔍 Refund + dispute webhook handling → [#56](https://github.com/gggfox/Tavli/pull/56) (TAVLI-53)
- 🔍 Post-deploy health gate + deploy-failure alerting → [#55](https://github.com/gggfox/Tavli/pull/55) (TAVLI-52)
- 🔍 Error → i18n mapping, stop leaking raw backend errors → [#58](https://github.com/gggfox/Tavli/pull/58) (TAVLI-55)

**Still open, no PR yet:** refund story for tab payments (TAVLI-50, needs an implement-vs-SOP
decision), error tracking / Sentry (TAVLI-9), Convex backup + restore runbook (TAVLI-58),
staff/tablet responsive coverage (TAVLI-59).

## Overall verdict

**Not yet production-ready — but the hard parts are strong.** Authentication/authorization
and the deploy/secrets pipeline are in good shape (a security remediation of ~28 findings
is genuinely merged into `main`), and the payments _happy path_ is sound. The gaps that
block a real launch cluster in three areas: **payments edge-cases** (commission rate,
refunds, reconciliation), **observability** (no error tracking / alerting / health gate),
and **data bootstrap** (no way to create the first admin in the empty prod DB — the
"Access Denied" already seen on `tavliai.com`).

| Dimension           | Status                     | Headline                                                                                        |
| ------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| Auth & RBAC         | ✅ **Substantially ready** | Clerk SSR + per-restaurant RBAC uniform; IDOR/PIN/dev-gate fixes merged; only low-sev leftovers |
| Deploy & secrets    | ✅ **Ready**               | Infisical model live & documented; Clerk on prod instance                                       |
| Backend robustness  | 🟠 **Conditional**         | Money path solid; medium hardening (rate-limit, audit, cron scans)                              |
| Payments            | 🔴 **Not ready**           | Commission 6% vs 12%, no tab refunds, no reconciliation                                         |
| Observability & ops | 🔴 **Not ready**           | No error tracking, health gate, or alerting                                                     |
| Data & config       | 🔴 **Not ready**           | No first-admin bootstrap; orders hot-path scan                                                  |
| Frontend / UX       | 🟠 **Conditional**         | Error localization broken; staff/tablet responsive unfinished                                   |

---

## 🔴 Go / No-Go blockers (resolve before taking real traffic)

- [x] **Confirm the platform commission rate.** ~~Code charges **6%**~~ Fixed: `PLATFORM_APPLICATION_FEE_RATE` is now `0.12` across both Stripe payment paths, matching TAVLI-1's decision. → merged in [#50](https://github.com/gggfox/Tavli/pull/50) (TAVLI-49)
- [ ] **Decide the refund story for tab payments.** `createRefund` throws for the tab flow — the only live path (`convex/stripe.ts:523-528`). Today there is _no_ automated refund in production and no in-app reconciliation of manual dashboard refunds. Either implement, or write + adopt a manual-refund SOP with monitoring. → **TAVLI-50**, needs an implement-vs-SOP decision before work can start
- [x] **First-admin bootstrap for the empty prod DB.** Added a guarded `internalMutation` (only invokable via `npx convex run`/dashboard) that promotes an existing user to owner+admin, gated by an explicit env opt-in and refusing if any owner/admin already exists; documented operator procedure in `deployment-and-secrets.md`. → merged in [#54](https://github.com/gggfox/Tavli/pull/54) (TAVLI-51). _Still needed: actually run it once against prod to create the first admin and confirm `/admin/restaurants` loads — the code shipping doesn't mean prod has been bootstrapped yet._
- [ ] **Error tracking (frontend + Convex).** None exists — no Sentry/Rollbar/etc. (`package.json` clean). Production exceptions are invisible unless someone is watching the Convex dashboard. Wire a capture sink into the existing `ErrorBoundary` `onError` prop. → **TAVLI-9**
- [ ] **Post-deploy health gate + deploy-failure alerting.** `deploy.yml` fires the Dokploy webhook and stops — nothing verifies the site actually serves after redeploy, and no workflow notifies on failure. This is the exact class of failure behind the 4-day staging outage. → **TAVLI-9**, postmortem action items #4–#5. A real `/health` endpoint + CI health gate + failure alerting is implemented in [#55](https://github.com/gggfox/Tavli/pull/55) (TAVLI-52), open for review

---

## 🟠 High priority (before launch, or immediately after)

- [ ] **Payment reconciliation for stuck "processing" tabs.** Settlement depends entirely on the `payment_intent.succeeded` webhook (`TabCheckoutPage.tsx:426`); a dropped/delayed webhook locks the tab forever (`lockedForPaymentAt`) with no sweep that reconciles against Stripe (`sweepStaleOpenTabs`, `sessions.ts:574` only closes zero-balance tabs). Add a cron that polls PaymentIntent status and/or a client `retrievePaymentIntent` fallback. → **TAVLI-45** — implemented in [#53](https://github.com/gggfox/Tavli/pull/53), open for review (not yet run against live Stripe test-mode events)
- [ ] **Refund + dispute webhook handling.** Only `payment_intent.succeeded/​payment_failed` + `account.updated` are handled (`stripe.ts:453-478`). No `charge.refunded` / `charge.dispute.created`. Since the platform is `losses_collector` (`stripe.ts:107`), disputes/chargebacks hit the platform **silently**. Handle them or formally accept dashboard-only + monitoring. → **TAVLI-53** — implemented in [#56](https://github.com/gggfox/Tavli/pull/56), open for review (not yet run against live Stripe test-mode events)
- [x] **`orders` hot-path index.** New `by_restaurant_status` index on `orders`; the kitchen dashboard and analytics widget now query per-status instead of collecting the full restaurant order history. → merged in [#51](https://github.com/gggfox/Tavli/pull/51) (TAVLI-54)
- [ ] **Error localization is broken end-to-end.** `src/global/utils/errorMessages.ts` maps 3 codes, **all mismatched** vs the real codes in `convex/_util/auth.ts:37-42`, and has **zero callers**. The ErrorBoundary and the shared `DashboardShell` (`DashboardShell.tsx:39,89`) hardcode English and render raw `error.message` (a user can see `[CONVEX M(...)] … ERROR_TABLE_LOCKED`). Fix the code→i18n map and stop leaking raw strings. → **TAVLI-55** — implemented in [#58](https://github.com/gggfox/Tavli/pull/58), open for review (adversarially verified against the real returned-tuple error shape; a handful of low-traffic admin/debug surfaces still render raw errors, tracked as follow-up)
- [x] **Rate limit anonymous public endpoints.** Availability queries now bound the work (tightened date-range validators, capped iterations); `reservations.create` is sliding-window rate-limited per restaurant/contact. → merged in [#57](https://github.com/gggfox/Tavli/pull/57) (TAVLI-56). _Residual: Convex queries can't hold state for true rate limiting, so the availability reads are bounded per-call, not throttled in aggregate — reduced DoS surface, not eliminated._
- [ ] **Staff/tablet responsive coverage.** Only ~34 breakpoint prefixes across 196 components; polish is concentrated in customer ordering. Staff surfaces (schedule grid, reservation timeline, data tables) are desktop-first. Restaurants run these on tablets. Needs device testing to scope. → **TAVLI-3, TAVLI-4** (now tracked as **TAVLI-59**)
- [ ] **Invite emails fall back to `localhost:3000`.** `inviteActions.ts:23-24` defaults `acceptUrl` to localhost if `PUBLIC_APP_URL`/`VITE_APP_URL` are unset — silent onboarding failure in prod. Require the app URL (throw/skip) in production. → **TAVLI-57** — implemented in [#52](https://github.com/gggfox/Tavli/pull/52), open for review
- [ ] **Convex backup + restore procedure.** No configured/documented backup, export job, or restore runbook (relies on unconfigured platform defaults). Confirm Convex's backup posture and write a restore runbook. → **TAVLI-58**

---

## 🟡 Medium (hardening — soon after launch)

- [ ] **Audit-log the money & reservation lifecycles.** `appendAuditEvent` count is **0** in `orders/payments/sessions/reservations/stripe` — the highest-value audit surface writes nothing.
- [ ] **Harden the reservations-bot HTTP boundary.** Routes don't wrap `runQuery`/`runMutation` in try/catch and only presence-check inputs (`http.ts:185-260`); bad input → unhandled 500 with a verbose validator error. Validate types + catch → clean 4xx.
- [ ] **Bound cron table scans.** `sweepNoShows` (`reservations.ts:996`) and `sweepStaleOpenTabs` (`sessions.ts:578`, `.collect()` all sessions) are unbounded full scans; add time-lower-bounds / status-scoped indexes.
- [ ] **Language hydration mismatch.** SSR renders `en` (no server-side locale detection) but a returning Spanish user hydrates `es` — `<html lang>` + all SSR chrome mismatch on first paint (`__root.tsx:152`).
- [ ] **Pin the Stripe API version.** `new Stripe(key)` with no `apiVersion` (`_util/stripe.ts:32`); the integration uses version-sensitive V2 APIs. Pin it explicitly.
- [ ] **Align timezone defaults.** `resolveRestaurantTimezone` → `America/Mexico_City` vs `orderServiceDate.resolveTimeZone` → `UTC` (up to 6h service-date skew for un-backfilled rows).
- [ ] **Observability depth:** real `/health` endpoint (not `/` with `<500` = healthy), external uptime monitor, structured logging / Convex log-streaming, CI `.dockerignore` guard (postmortem #3). Real `/health` endpoint + CI health gate implemented in [#55](https://github.com/gggfox/Tavli/pull/55) (TAVLI-52), open for review — external uptime monitor and structured logging still open.
- [ ] **Frontend perf:** virtualize kitchen/reservation/table lists (no virtualization today); collapse per-category menu query fan-out (`MenuBrowser.tsx:390`); add `loading="lazy"` + dimensions to menu images.
- [ ] **Gate `getAllFeatureFlags`** (`featureFlags.ts:116-147`) — currently world-readable, leaks feature descriptions.
- [ ] **Design-token cleanup:** inline hex colors bypass theme tokens (`MenuBrowser.tsx`, `InlineError`); contrast unverified. → TDR-0005 area
- [ ] More per-route error boundaries (only 2 exist; a staff render error blanks the whole content region).

---

## ⚙️ Config & manual verification (not code — verify on the prod deployments)

- [ ] **Prod Convex (`polite-antelope-545`) env:** `CLERK_JWT_ISSUER_DOMAIN=https://clerk.tavliai.com` ✅ (set this session), `CONVEX_ENV=production`, `ENABLE_DEV_ROLE_SWITCHER` **unset**, `RESERVATIONS_BOT_TOKEN` (≥32 chars), `PUBLIC_APP_URL`, `OPENROUTER_API_KEY`, `RESEND_*`, Stripe secrets.
- [ ] **Both dev-role-switcher kill-switches off in prod:** Convex `ENABLE_DEV_ROLE_SWITCHER` **and** the frontend build's `VITE_DEV_ROLE_SWITCHER_ENABLED`.
- [ ] **Stripe live-mode cutover:** swap `sk_test→sk_live` (Convex) + `pk_test→pk_live` (Infisical, rebuild); create **live** webhook destinations at `https://<slug>.convex.site/stripe/webhook` and `/stripe/connect-webhook` (`.convex.site`, not `.cloud`) with fresh secrets; enable the live Connect platform profile; **re-onboard every restaurant** (test-mode account IDs are invalid in live). → **TAVLI-46**
- [ ] **Shared-employee Clerk credential** — verify the per-restaurant `sharedEmployeeClerkSubject` login is a strong, non-shared, per-device-scoped credential (whole kiosk tier depends on it).
- [ ] **Clerk `emailVerified` claim** — confirm the Clerk JWT template includes a trustworthy verified-email claim (`acceptInvitation` trusts it, `invites.ts:274`).
- [ ] **Run additive backfills** after the first prod schema push (`convex/migrations/*`).
- [ ] **Resend go-live** — domain verification / sending domain for prod. → **TAVLI-47**

---

## ✅ Already solid (don't re-litigate)

- **Auth/RBAC:** Clerk SSR → Convex wired correctly; per-restaurant RBAC applied uniformly across all sampled modules; PINs CSPRNG + bcrypt with lockout; XOR (User vs EmployeeAccount) enforced.
- **Security remediation merged in `main`:** TAVLI-13 (diner IDOR), TAVLI-34 (dev-role gate, fail-closed), TAVLI-35 (log redaction), TAVLI-36 (inactive-menu leakage) verified fixed; ~28 `[Sec]` findings marked Done.
- **Payments happy path:** webhook signature verification, layered idempotency (Stripe keys + status short-circuit + snapshot re-validation), correct destination-charge + fee-on-subtotal math, SAQ-A PCI scope.
- **Deploy & secrets:** Infisical machine-identity model live on staging + prod, documented (`deployment-and-secrets.md`); strong pre-merge CI gate; SHA-tagged images for manual rollback; container HEALTHCHECK present.
- **i18n:** CI-enforced EN/ES parity, Spanish genuinely complete, correct per-locale menu-content handling with historical snapshot fallback.
- **Clerk production instance** live this session (DNS+SSL, Google OAuth, `pk_live`/`sk_live`, issuer). → **TAVLI-48**

---

## 📋 Doc & tracking cleanup

- [ ] **Archive/rewrite TDR-0001** (`tech-debt/0001-missing-backend-authentication.md`) — describes WorkOS + `convex/tasks.ts` that no longer exist and gives wrong (WorkOS) prod-setup steps; the underlying gap is closed by Clerk+RBAC.
- [ ] **Refresh `stripe-go-live.md` / `email-deliverability.md`** to the Infisical model (they predate it).
- [ ] Move `TAVLI-48` → Done (bumps TAVLI-1 to 1/3); keep TAVLI-46/47 open.
