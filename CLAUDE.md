# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tavli is a single-context restaurant operations product: menus, online ordering, payments, reservations, attendance, and per-restaurant staff scheduling. Read [`CONTEXT.md`](./CONTEXT.md) before touching domain code — it is the canonical glossary (Restaurant, Menu/MenuCategory/MenuItem, PrepStation, Session/Order/OrderItem, User vs. EmployeeAccount, RestaurantMember, Shift/ShiftRole, etc.) and defines which alternative phrasings to avoid. Architectural decisions live in [`documentation/ADR/`](./documentation/ADR/).

Naming note: the npm package is `tanstack-vc`, the product is **Tavli**, and older docs/ADRs still say "Fierro Viejo" — these all refer to this same project.

## Commands

Package manager is **pnpm**. `pnpm dev` runs Convex and Vite together (`concurrently`).

```bash
pnpm dev                 # convex dev + vite dev on :3000 (run both, they are coupled)
pnpm build               # production build (vite)
pnpm test                # vitest run (unit/component, jsdom)
pnpm test -- <pattern>   # single file/test, e.g. pnpm test -- orderServiceDate
pnpm test:coverage       # coverage variant used by CI
pnpm test:e2e            # Playwright E2E (e2e/)
pnpm lint                # eslint . (also lint:fix)
pnpm format              # prettier --write
pnpm email:dev           # preview React Email templates on :3001
```

E2E (`e2e/`) is excluded from vitest; run it only via `pnpm test:e2e`. Husky + lint-staged run eslint+prettier on commit.

## Architecture

Two codebases share one repo and are kept apart by ESLint's `boundaries` plugin:

- **`convex/`** — the backend (Backend-as-a-Service, ADR 003). Queries/mutations/actions, schema, HTTP routes, crons. **Convex files may only import other Convex files** — never from `src/`.
- **`src/`** — the TanStack Start frontend (SSR React 19, React Compiler enabled). It talks to Convex through `@convex-dev/react-query`: Convex queries are wired into TanStack Query in `src/router.tsx`, so components use `useQuery`/`useMutation` against the generated `api`.

### `src/` layering (enforced — read `.eslintrc.json` `boundaries`)

- `src/global/**` — shared design-system components, hooks, i18n, types, utils. Re-exported via `src/global/index.ts`.
- `src/features/<name>/**` — vertical feature slices (`menus`, `ordering`, `kitchen`, `reservations`, `schedule`, `attendance`, `team`, `dashboard`, `auth`, …). Each has `components/`, `hooks/`, `utils/`, `constants.ts`, `index.ts`.
- `src/routes/**` — TanStack **file-based** routes (`app` layer). `routeTree.gen.ts` is generated — never edit it. Root layout is `src/routes/__root.tsx`.

Allowed import directions: `feature`/`global`/`app` → may use `global`, `convex`, `shared`, `feature`. `convex` → `convex` only. Features must not import from `src/routes`. When `boundaries/element-types` errors, you crossed a layer — restructure rather than disabling the rule.

### `convex/` layering

- Public function modules at the top level (`menus.ts`, `orders.ts`, `payments.ts`, `reservations.ts`, …), often paired with a `*Helpers.ts` for pure logic.
- `convex/_util/` — cross-cutting helpers: `auth.ts` (RBAC), `audit.ts`, `idempotency.ts`, `env.ts`, `timezone.ts`, `stripe.ts`.
- `convex/_shared/` — `errors.ts`, shared types.
- `convex/schema.ts` defines all tables; enums come from `convex/constants.ts` (`USER_ROLES`, `RESTAURANT_MEMBER_ROLE`, `SHIFT_ROLE`, `PREP_STATION`, …). Use these constants, do not inline string literals.

### Auth & roles

Authentication is **Clerk** (`@clerk/tanstack-react-start`) — note ADR 002 says WorkOS and ADR 001 (Effect.ts) is **Deprecated**; the code is the source of truth, not those ADRs. Authorization is role-based in `convex/_util/auth.ts`:

- Org-level roles (`owner`, `admin`) live in `userRoles`.
- Per-restaurant roles (`manager`, `employee`) live in `restaurantMembers`. A `RestaurantMember` is backed by **either** a `User` (Clerk identity) **or** an `EmployeeAccount` (no Clerk identity, hashed Personal PIN) — XOR, enforced in app code (ADR 006).
- Backend errors are returned as **stable codes** (e.g. `ERROR_ADMIN_ROLE_REQUIRED`, `NOT_AUTHORIZED`), not prose — the frontend maps them to i18n keys. Preserve this when adding errors.

### Integrations

- **Stripe** (payments + Connect). Webhooks are Convex HTTP routes in `convex/http.ts`: `POST /stripe/webhook` and `POST /stripe/connect-webhook`. See README for `stripe listen` forwarding and `documentation/runbooks/stripe-go-live.md`.
- **Reservations bot** HTTP API under `/api/v1/reservations/*` in `convex/http.ts`, guarded by `RESERVATIONS_BOT_TOKEN`.
- **Emails** authored with React Email in `emails/` (`pnpm email:dev` to preview); sent from `convex/emails/`.
- **i18n** via i18next — app is bilingual (English/Spanish); user-facing strings go through translation keys, and menu/item content carries per-locale translation records (see `convex/schema.ts`).

### Environment gating

`CONVEX_ENV` (`development` | `staging` | `production`) gates dev-only features (e.g. the Settings role switcher). Set it on every deployment — see README. Stripe keys and `RESERVATIONS_BOT_TOKEN` are Convex env vars.

## Conventions

- Style is enforced by Prettier (tabs, see `.prettierrc.json`) and ESLint — run `pnpm lint`/`pnpm format` rather than hand-formatting.
- Prefix intentionally-unused vars/args with `_` to satisfy `no-unused-vars`.
- `.cursor/` ships a vendored **vercel-react-best-practices** skill (React/Next perf rules); apply its guidance when writing or refactoring React, but it is reference material, not project policy.
