# TDR-0001: Missing Backend Authentication & Authorization

## Status

**Archived** — 2026-07-19. The gap this record described is closed, and the
record's own content had gone stale enough to be misleading. Kept as a stub for
the historical link; do not use it as a description of the system.

## What this originally said

Written 2024-12-21 against the scaffold: WorkOS AuthKit handled client-side
sign-in while Convex functions ran no identity check, so `convex/tasks.ts` was
world-readable and world-writable. It recommended wiring WorkOS JWTs into Convex
and adding `userId` scoping, and was marked Resolved a day later with a
`WORKOS_CLIENT_ID` setup note.

## Why it is archived rather than updated

Every concrete thing it names is gone:

- **WorkOS was replaced by Clerk** (`@clerk/tanstack-react-start`). ADR 002 still
  says WorkOS and is likewise out of date — the code is the source of truth.
- **`convex/tasks.ts` no longer exists.** It was scaffold demo data; there is no
  `tasks` table in `convex/schema.ts`.
- **The `WORKOS_CLIENT_ID` setup instructions are wrong** for this deployment.
  See [`documentation/internal-guides/deployment-and-secrets.md`](../internal-guides/deployment-and-secrets.md)
  for the current environment model.

## Where authorization actually lives now

- **Authentication**: Clerk, bridged to Convex via `convex/auth.config.ts`.
- **Authorization**: role guards in [`convex/_util/auth.ts`](../../convex/_util/auth.ts) —
  `getCurrentUserId`, `requireAdminRole`, `requireManagerRole`,
  `requireStaffRole`, `requireRestaurantManagerOrAbove`,
  `requireRestaurantStaffAccess`, and friends. Guards return an
  `AsyncReturn<T, E>` tuple rather than throwing, and errors are **stable codes**
  (`ERROR_ADMIN_ROLE_REQUIRED`, `NOT_AUTHORIZED`) that the frontend maps to i18n
  keys.
- **Two-tier roles**: org-level (`owner`, `admin`) in `userRoles`; per-restaurant
  (`manager`, `employee`) in `restaurantMembers`. A `RestaurantMember` is backed
  by either a `User` or an `EmployeeAccount`, never both — see ADR 006.

`CONTEXT.md` is the canonical glossary for these terms.

## Owner

Development Team

## Created

2024-12-21

## Archived

2026-07-19 (TAVLI-61, under the TAVLI-60 post-launch hardening rollup)
