# threat-audit — reference

Authoritative context for the adversarial audit of **Tavli**. Layer agents read this plus
`CLAUDE.md` (architecture) and `CONTEXT.md` (domain glossary). Verify findings against the **real**
code — paths below are starting points, not an allowlist. All paths are relative to the repo root.

## Stack at a glance

- **Single app, two codebases** (not a monorepo): `src/` = TanStack Start SSR React 19 frontend;
  `convex/` = Convex Backend-as-a-Service (queries/mutations/actions, HTTP routes, crons). pnpm.
- **Backend = Convex**, not a conventional server. There is **no SQL and no row-level security** —
  every Convex function is a public RPC endpoint unless declared `internal*`, and **each one must
  enforce its own authorization**. Missing per-function authz is the dominant risk class here
  (see `documentation/tech-debt/0001-missing-backend-authentication.md`).
- **Auth = Clerk** (`@clerk/tanstack-react-start`), verified by Convex via
  `convex/auth.config.ts` (`CLERK_JWT_ISSUER_DOMAIN`, applicationID `convex`). Client wiring:
  `src/routes/__root.tsx` (`ClerkProvider` + `ConvexProviderWithClerk`).
- **Payments = Stripe** (incl. Connect). Webhooks are Convex HTTP routes in `convex/http.ts`.
- **Diner-facing routes are unauthenticated**: `src/routes/r/$slug/**` (public menu, cart,
  checkout, ordering, reservation). These call Convex functions with **no Clerk identity** — a prime
  IDOR / abuse surface.
- **Known weak spots to assume real until disproven:** everything under
  `documentation/tech-debt/` — especially `0001-missing-backend-authentication.md` and
  `0004-client-side-validation-bypassable.md`.

## Sensitive assets & trust boundaries (Tavli-specific)

| Asset                                                     | Where                                                                                                                                                               | Attacker value                                                                                                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`                                       | Convex env                                                                                                                                                          | Full payment-account access; refunds, charges, data exfil. Must never reach client or logs.                                                                                                           |
| `STRIPE_WEBHOOK_SECRET` / `STRIPE_CONNECT_WEBHOOK_SECRET` | Convex env                                                                                                                                                          | Webhook forgery → fake "paid" orders / account state if `stripe-signature` not verified. Verified in `convex/http.ts` → `convex/stripe.ts`/`convex/stripeHelpers.ts`.                                 |
| `VITE_STRIPE_PUBLISHABLE_KEY`                             | client (`VITE_*`, exposed by design)                                                                                                                                | Low-priv. Confirm **no secret key** is ever exposed via a `VITE_*` var.                                                                                                                               |
| `RESERVATIONS_BOT_TOKEN`                                  | Convex env                                                                                                                                                          | Bearer token gating `POST /api/v1/reservations/*` in `convex/http.ts`. Check token strength, the hand-rolled constant-time compare (`http.ts` ~L150–164), and that every bot route actually calls it. |
| `CLERK_JWT_ISSUER_DOMAIN`                                 | Convex env (`auth.config.ts`)                                                                                                                                       | Wrong/loose issuer → token forgery / cross-tenant identity.                                                                                                                                           |
| Convex deploy keys / dashboard                            | Convex deployment                                                                                                                                                   | Full backend control. Confirm not committed.                                                                                                                                                          |
| **Personal PIN** (employee)                               | hashed (bcrypt) on `employeeAccounts`; `convex/_util/auth.ts`, `PIN_LOCKOUT`                                                                                        | Brute-force → impersonate staff for tips/attendance/clock-in. Check hashing, lockout, shown-once on `resetEmployeePin`.                                                                               |
| **Shared employee session**                               | `restaurants.sharedEmployeeClerkSubject`; `convex/sharedEmployee.ts` (`*WithPin`)                                                                                   | A single shared Clerk identity; PIN step-up unlocks one employee's own reads + self clock in/out. Check step-up can't be skipped or used to read **others'** data (IDOR).                             |
| Invitation tokens                                         | `convex/invites.ts` (`createInvitation`, `getByTokenPublic`, `acceptInvitation`); route `src/routes/invites/$token.tsx`                                             | Token guessability, expiry (`expirePendingInvitations`), reuse/replay, privilege granted on accept, email binding.                                                                                    |
| Customer PII / orders / reservations                      | Convex tables, reached by **public** `r/$slug` functions                                                                                                            | IDOR across restaurants/sessions/orders; reservation enumeration.                                                                                                                                     |
| Org/restaurant role state                                 | `userRoles` (org `owner`/`admin`), `restaurantMembers` (`manager`/`employee`)                                                                                       | Privilege escalation; the `RestaurantMember` XOR (`userId` **xor** `employeeAccountId`) is enforced in app code only.                                                                                 |
| Admin surface                                             | `src/routes/admin/**`, `convex/admin.ts` (`requireAdminRole`), impersonation (`documentation/runbooks/admin-impersonation.md`)                                      | Full cross-tenant access; impersonation abuse/audit gaps.                                                                                                                                             |
| `CONVEX_ENV`                                              | Convex env (`convex/_util/env.ts`)                                                                                                                                  | Gates dev-only powers (e.g. Settings **role switcher** = adopt any role). If unset/misset on prod, any user can self-escalate.                                                                        |
| Uploaded files                                            | menu import (`convex/menuImport.ts`, `menuImportMutation.ts`) parsing PDF/DOCX/XLSX via `pdf-parse`/`mammoth`/`xlsx`; employee photos (`getEmployeePhotoUploadUrl`) | Malicious file parsing, zip/xml bombs, SSRF via parsers, **prompt injection** through AI menu import (`@ai-sdk/openai`), unauthorized upload URLs.                                                    |

**Trust boundaries:** browser ↔ TanStack Start server functions; **unauthenticated diner ↔ public
Convex functions** (`r/$slug`); authenticated client ↔ Convex (Clerk JWT); shared-session device ↔
Convex (PIN step-up); reservations bot ↔ Convex HTTP (bearer token); Stripe ↔ Convex webhooks
(signature); app ↔ Clerk; app ↔ Stripe; `public` vs `internal*` Convex functions.

## Per-layer checklist

- **frontend** — `src/`. `dangerouslySetInnerHTML`/XSS, secrets leaked through `VITE_*` or SSR
  loaders, trust of client-supplied data, open redirects, the **public** `r/$slug/**` flows (cart,
  checkout, ordering), TanStack server functions (`src/start.ts`, `*.server-funcs`), i18n content
  injection, SSR data over-fetch (returning fields the diner shouldn't see).
- **backend** — `convex/*.ts`. For **every** public `query`/`mutation`/`action`: is there an authz
  check (`requireAdminRole`/`requireOwnerOrManager`/`requireStaffRole`/restaurant-scoping) **before**
  any read/write? Argument validators present and tight (no mass assignment)? IDOR across
  `restaurantId`/`sessionId`/`orderId`? `internal*` functions not exposed publicly? The reservations
  bot routes + Stripe webhooks in `http.ts`. Live `prepStation` lookups (ADR 005) and denormalized
  order snapshots for tampering.
- **auth** — Clerk config (`auth.config.ts`, issuer domain), the RBAC helpers in `_util/auth.ts`
  (org `userRoles` vs per-restaurant `restaurantMembers`, the XOR invariant, owner short-circuit),
  Personal-PIN hashing + `PIN_LOCKOUT` + shown-once reset, `sharedEmployee.ts` PIN step-up (can it be
  bypassed / used to read others' data?), invite token flow, admin impersonation, and the
  `CONVEX_ENV`-gated role switcher (does prod truly lock it?).
- **database** — Convex document model. Since there's **no RLS**, data isolation lives entirely in
  query code: confirm every list/get scopes by restaurant/org/user. Soft-delete + purge
  (`restaurantPurge.ts`, `softDeletePurge.ts`) — leftover data, purge authz. File storage authz
  (`getEmployeePhotoUploadUrl`). PII at rest (hashed PINs, reservation/customer data). Idempotency
  keys (`_util/idempotency.ts`) and audit trail (`_util/audit.ts`) integrity.
- **infra** — Convex env config: `CONVEX_ENV=production` actually set on prod; Stripe webhook
  signature verification on **both** surfaces; `RESERVATIONS_BOT_TOKEN` strength + the hand-rolled
  compare; secrets in `console.*` logs (e.g. `http.ts` error logs); CORS/headers on Convex HTTP
  routes; debug/demo routes (`src/routes/demo/**`) shipping to prod; Vite/Nitro build config.
- **dependencies** — `pnpm audit`; inspect `pnpm-lock.yaml`. High-risk parsers handling untrusted
  input: `pdf-parse`, `mammoth`, `xlsx` (menu import). AI path: `ai` / `@ai-sdk/openai` (prompt
  injection from uploaded menus). `bcryptjs` (PIN hashing — params). Stripe/Clerk/Convex SDK
  currency. Abandoned/typosquat/supply-chain risk; `onlyBuiltDependencies` (esbuild) postinstall.

## Severity & confidence

- **Severity:** Critical / High / Medium / Low (attacker-impact based).
- **Confidence** (set by the verify phase, never causes deletion): **Confirmed** (verified real and
  reachable) · **Likely** (plausible, partial evidence) · **Speculative** (unconfirmed/partly refuted
  but flagged anyway). Always show confidence next to severity.

## Output format (render inline, no file)

1. **Vulnerability summary by severity** — counts per Critical/High/Medium/Low (a small table).
2. **Detailed findings** — grouped by severity, Critical first. Each: **title · severity ·
   confidence · affected component · description · exploitation steps · impact · recommended fix.**
3. **Attack chains** — multi-step paths composing smaller findings into larger impact.
4. **Secure design improvements** — class-level fixes beyond individual bugs.

Lead with a short threat-model recap (attackers, entry points, trust boundaries, assets) before the
four sections. Do not understate uncertainty — keep Speculative findings and mark them clearly.
