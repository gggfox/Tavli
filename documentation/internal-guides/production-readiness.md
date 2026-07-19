# Production readiness checklist

A grounded, evidence-based readiness assessment from a full-codebase audit (2026-07-18)
across six dimensions: auth/authorization, payments, backend robustness, observability &
ops, frontend/UX, and data/config. Each item is marked with severity and file evidence.
This is the parent tracker that TAVLI-1 ("Prod configuration"), the tech-debt records,
and the observability work (TAVLI-9) roll up into.

Legend: 🔴 blocker · 🟠 high · 🟡 medium · ✅ done · ⚙️ config/manual verify

## Status — 2026-07-19

**Every code-level finding from the 2026-07-18 audit is now merged into `main`.** The
verdict and dimension table below have been updated to match; the per-item evidence
(`file:line`, severity, original wording) is preserved throughout so the audit trail
stays intact.

**Merged since the audit:**

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
bootstrap — have all landed in `main`. What stands between here and real traffic is no
longer mostly engineering: it is **error tracking**, the **Stripe live cutover**, a
handful of **one-time prod operations**, and **validating the new Stripe paths against
live test-mode events**.

| Dimension           | Status             | Headline                                                                                              |
| ------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| Auth & RBAC         | ✅ **Ready**       | Clerk SSR + per-restaurant RBAC uniform; JWT `email_verified` claim empirically verified on prod      |
| Deploy & secrets    | ✅ **Ready**       | Infisical model live & documented; Clerk prod instance; post-deploy health gate + failure alerting    |
| Backend robustness  | 🟠 **Conditional** | Money path solid; hot-path index + rate limiting merged; medium hardening (audit logging, cron scans) |
| Payments            | 🟠 **Conditional** | Commission, reconciliation, refund/dispute webhooks all merged — but unexercised against live Stripe  |
| Observability & ops | 🟠 **Conditional** | Health gate + deploy alerting merged; **error tracking still missing** (TAVLI-9)                      |
| Data & config       | 🟠 **Conditional** | Bootstrap + index shipped; prod still needs the bootstrap actually run and env values confirmed       |
| Frontend / UX       | 🟠 **Conditional** | Error localization fixed end-to-end; staff/tablet responsive still unfinished                         |

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

- [ ] **Archive/rewrite TDR-0001** (`tech-debt/0001-missing-backend-authentication.md`) — describes WorkOS + `convex/tasks.ts` that no longer exist and gives wrong (WorkOS) prod-setup steps; the underlying gap is closed by Clerk+RBAC.
- [ ] **Refresh `stripe-go-live.md`** to the Infisical model (it predates it). `email-deliverability.md` was refreshed in [#59](https://github.com/gggfox/Tavli/pull/59) ✅
- [x] `TAVLI-48` (Clerk) → **Done**; `TAVLI-47` (Resend) → **Done**; `TAVLI-49` (commission) → **Done**. TAVLI-1 is down to **TAVLI-46 (Stripe)** as its last open integration.
