# Production readiness checklist

A grounded, evidence-based readiness assessment from a full-codebase audit (2026-07-18)
across six dimensions: auth/authorization, payments, backend robustness, observability &
ops, frontend/UX, and data/config. Each item is marked with severity and file evidence.
This is the parent tracker that TAVLI-1 ("Prod configuration"), the tech-debt records,
and the observability work (TAVLI-9) roll up into.

Legend: 🔴 blocker · 🟠 high · 🟡 medium · ✅ done · ⚙️ config/manual verify

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

- [ ] **Confirm the platform commission rate.** Code charges **6%** (`PLATFORM_APPLICATION_FEE_RATE = 0.06`, `convex/constants.ts:175`; used at `convex/stripe.ts:815`), but TAVLI-1 says **12%**. If 12% is intended, every live charge under-collects revenue by half. **Revenue-critical decision.**
- [ ] **Decide the refund story for tab payments.** `createRefund` throws for the tab flow — the only live path (`convex/stripe.ts:523-528`). Today there is _no_ automated refund in production and no in-app reconciliation of manual dashboard refunds. Either implement, or write + adopt a manual-refund SOP with monitoring.
- [ ] **First-admin bootstrap for the empty prod DB.** Every privileged mutation requires an already-privileged caller (`organizations.ts:60`, `admin.ts:215`, `restaurants.ts:218`); no Clerk `user.created` webhook seeds roles; `devSetOwnRoles` is (correctly) blocked in prod. The only path today is a manual Convex-dashboard row insert — undocumented. Provide a guarded seed script or a documented procedure. _(This is the concrete cause of the `/admin/restaurants` "Access Denied" on prod.)_
- [ ] **Error tracking (frontend + Convex).** None exists — no Sentry/Rollbar/etc. (`package.json` clean). Production exceptions are invisible unless someone is watching the Convex dashboard. Wire a capture sink into the existing `ErrorBoundary` `onError` prop. → **TAVLI-9**
- [ ] **Post-deploy health gate + deploy-failure alerting.** `deploy.yml` fires the Dokploy webhook and stops — nothing verifies the site actually serves after redeploy, and no workflow notifies on failure. This is the exact class of failure behind the 4-day staging outage. → **TAVLI-9**, postmortem action items #4–#5

---

## 🟠 High priority (before launch, or immediately after)

- [ ] **Payment reconciliation for stuck "processing" tabs.** Settlement depends entirely on the `payment_intent.succeeded` webhook (`TabCheckoutPage.tsx:426`); a dropped/delayed webhook locks the tab forever (`lockedForPaymentAt`) with no sweep that reconciles against Stripe (`sweepStaleOpenTabs`, `sessions.ts:574` only closes zero-balance tabs). Add a cron that polls PaymentIntent status and/or a client `retrievePaymentIntent` fallback. → **TAVLI-45**
- [ ] **Refund + dispute webhook handling.** Only `payment_intent.succeeded/​payment_failed` + `account.updated` are handled (`stripe.ts:453-478`). No `charge.refunded` / `charge.dispute.created`. Since the platform is `losses_collector` (`stripe.ts:107`), disputes/chargebacks hit the platform **silently**. Handle them or formally accept dashboard-only + monitoring.
- [ ] **`orders` hot-path index.** The live kitchen dashboard `.collect()`s _every_ order for a restaurant and filters status in memory (`orders.ts:585-591`); `orders` has no `by_restaurant_status` index (`schema.ts:470`). Add the index + query by it — this is the hottest, most-polled read and grows unbounded.
- [ ] **Error localization is broken end-to-end.** `src/global/utils/errorMessages.ts` maps 3 codes, **all mismatched** vs the real codes in `convex/_util/auth.ts:37-42`, and has **zero callers**. The ErrorBoundary and the shared `DashboardShell` (`DashboardShell.tsx:39,89`) hardcode English and render raw `error.message` (a user can see `[CONVEX M(...)] … ERROR_TABLE_LOCKED`). Fix the code→i18n map and stop leaking raw strings.
- [ ] **Rate limit anonymous public endpoints.** `getAvailability` / `listReservationSlotsForDay` (up to 64 iterations of table+reservation+lock scans, `reservations.ts:182-217`) are anonymous and unthrottled — a cheap-request/expensive-work DoS surface. `reservations.create` UI mutation is likewise open. Consider `@convex-dev/rate-limiter`.
- [ ] **Staff/tablet responsive coverage.** Only ~34 breakpoint prefixes across 196 components; polish is concentrated in customer ordering. Staff surfaces (schedule grid, reservation timeline, data tables) are desktop-first. Restaurants run these on tablets. Needs device testing to scope. → **TAVLI-3, TAVLI-4**
- [ ] **Invite emails fall back to `localhost:3000`.** `inviteActions.ts:23-24` defaults `acceptUrl` to localhost if `PUBLIC_APP_URL`/`VITE_APP_URL` are unset — silent onboarding failure in prod. Require the app URL (throw/skip) in production.
- [ ] **Convex backup + restore procedure.** No configured/documented backup, export job, or restore runbook (relies on unconfigured platform defaults). Confirm Convex's backup posture and write a restore runbook.

---

## 🟡 Medium (hardening — soon after launch)

- [ ] **Audit-log the money & reservation lifecycles.** `appendAuditEvent` count is **0** in `orders/payments/sessions/reservations/stripe` — the highest-value audit surface writes nothing.
- [ ] **Harden the reservations-bot HTTP boundary.** Routes don't wrap `runQuery`/`runMutation` in try/catch and only presence-check inputs (`http.ts:185-260`); bad input → unhandled 500 with a verbose validator error. Validate types + catch → clean 4xx.
- [ ] **Bound cron table scans.** `sweepNoShows` (`reservations.ts:996`) and `sweepStaleOpenTabs` (`sessions.ts:578`, `.collect()` all sessions) are unbounded full scans; add time-lower-bounds / status-scoped indexes.
- [ ] **Language hydration mismatch.** SSR renders `en` (no server-side locale detection) but a returning Spanish user hydrates `es` — `<html lang>` + all SSR chrome mismatch on first paint (`__root.tsx:152`).
- [ ] **Pin the Stripe API version.** `new Stripe(key)` with no `apiVersion` (`_util/stripe.ts:32`); the integration uses version-sensitive V2 APIs. Pin it explicitly.
- [ ] **Align timezone defaults.** `resolveRestaurantTimezone` → `America/Mexico_City` vs `orderServiceDate.resolveTimeZone` → `UTC` (up to 6h service-date skew for un-backfilled rows).
- [ ] **Observability depth:** real `/health` endpoint (not `/` with `<500` = healthy), external uptime monitor, structured logging / Convex log-streaming, CI `.dockerignore` guard (postmortem #3).
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
