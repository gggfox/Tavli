# ADR-006: Managed employee accounts and shared session identity

## Metadata

| Field | Value |
| ------- | ------- |
| **Status** | Accepted |
| **Date** | 2026-05-17 |
| **Author(s)** | Tavli team |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

Tavli restaurants need staff accounts for employees who do not have (and
should not need) their own email address or Clerk identity. Today every
`restaurantMembers` row is backed by a Clerk user (`userId`), and new
members are added via an email-based invitation flow that requires the
invitee to sign up in Clerk and accept the invite with a matching email.

This creates friction: managers need to create accounts in bulk for
kitchen/bar/host staff, most of whom will never log in independently.
The employees only need to (a) see their own tips, attendance, and
schedule, and (b) self clock-in/out — all from a shared kiosk-style
device at the restaurant.

Three coupled decisions needed resolution:

1. Whether employees are Clerk users or managed records with no IdP
   identity.
2. How a shared device knows which restaurant it's operating on, and
   what it's allowed to do.
3. How employees authenticate for the limited self-service actions
   (view own data, clock-in/out).

## Decision

### 1. Employees are not Clerk users

A new `employeeAccounts` table holds the employee profile: structured
name (`firstName`, `paternalLastname`, `maternalLastname`), optional
photo (`photoStorageId`), and a hashed personal PIN. Employees have **no
Clerk identity**.

When an `EmployeeAccount` is created, a **shadow `restaurantMembers`
row** is also inserted with `role: employee`, `employeeAccountId` set
and `userId` unset. This preserves the existing invariant that
attendance, tips, and audit references always point at a
`restaurantMembers` id.

**XOR invariant on `restaurantMembers`:** exactly one of `userId` (Clerk-
backed) or `employeeAccountId` (managed) is set — never both, never
neither. Enforced at the application layer in every mutation that
inserts or patches a membership row.

### 2. Per-restaurant shared Clerk identity

Each restaurant gets a dedicated shared Clerk user ("empleados" session),
auto-provisioned on restaurant creation and bound via
`restaurants.sharedEmployeeClerkSubject`. Guards check: "is the current
Clerk subject === this restaurant's `sharedEmployeeClerkSubject`?"

Permissions of the shared session:

- **Read-only by default**: team directory (names + photos only, no
  emails, no role details beyond manager/employee badge).
- **PIN-gated reads**: own tips, own attendance summary, own schedule —
  each call verifies the PIN fresh against the target
  `employeeAccountId`.
- **PIN step-up writes**: self clock-in, self clock-out — PIN verified
  per action, no session promotion.

### 3. Personal PINs: hashed, shown once, with lockout

PINs are stored hashed (bcrypt/argon2) on `employeeAccounts.pinHash`.
A new PIN is generated and shown to the manager **once** at creation and
on reset; it is never retrievable after that.

Lockout: after 5 failed attempts in 10 minutes, the account is locked
(`lockedUntil` set). A manager must reset the PIN to clear the lockout.

## Consequences

### Positive

- Managers can onboard staff in seconds without requiring an email
  address, a Clerk sign-up, or an invitation flow.
- Existing attendance, tips, and audit code continues to work unchanged
  — it references `restaurantMembers`, and every employee still has one.
- Per-restaurant session scoping means Restaurant A's shared device
  cannot read Restaurant B's directory, ever, regardless of UI state.
- Hashed PINs with lockout protect against brute-force without the
  liability of plaintext password storage.

### Negative

- The XOR invariant on `restaurantMembers` has no database-level
  enforcement (Convex does not support check constraints). A buggy
  mutation could violate it. Mitigated by centralizing shadow-row
  creation in one helper and covering it with unit tests.
- Clerk-side provisioning failure during restaurant creation leaves a
  half-created restaurant. The create mutation must roll back on Clerk
  failure.
- Lockout state is per-account; a shared device with multiple employees
  can accidentally lock each other out by mistyping PINs on the wrong
  account's prompt. Mitigated by locking only the targeted account, not
  the device.

### Neutral

- The `employeeAccounts` table is per-restaurant, not cross-restaurant.
  An employee working at two restaurants in the same org will have two
  separate accounts. This matches the existing per-restaurant
  `restaurantMembers` model and can be revisited if cross-restaurant
  profiles become needed.

## Alternatives Considered

### Option 1: Plaintext or reversible-encrypted PINs

Store the PIN in plaintext (or encrypted with an env-var key) so
managers can look it up anytime.

**Pros:**

- Simplest recovery story — manager reads the current PIN directly.

**Cons:**

- A DB dump or admin session compromise exposes every employee's PIN
  across every restaurant simultaneously.
- PINs appear in server logs, Sentry breadcrumbs, browser memory dumps,
  and screenshots.

**Why not chosen:** The stated need is **recovery**, not **lookup**.
Reset-to-recover (show once, hash, replace) satisfies the requirement
without long-term plaintext exposure.

### Option 2: Per-organization shared session

One Clerk identity shared across all restaurants in the org. The device
picks which restaurant it's operating on via UI state (localStorage).

**Pros:**

- Cheaper (fewer Clerk seats).

**Cons:**

- A kiosk-mode "I'm in Pizza Bar" state is a UI flag, not a security
  boundary. Restaurant A's directory would be accessible from Restaurant
  B's device via a state toggle.
- The shared subject cannot be scoped to a single restaurant's data
  without additional per-request checks that are easy to omit.

**Why not chosen:** Per-restaurant scoping provides a real security
boundary. Clerk seat cost is negligible compared to the risk of
cross-restaurant data leakage.

### Option 3: Polymorphic memberId across attendance and tips

Instead of a shadow `restaurantMembers` row, make `attendances.memberId`,
`tipPoolShares.memberId`, etc. accept either `restaurantMembers` or
`employeeAccounts` ids via a Convex union type plus a discriminator.

**Pros:**

- No shadow rows — each entity type is self-contained.

**Cons:**

- Every query, join, and report that touches `memberId` (attendance,
  tips, shifts, orders, analytics) must learn about two id types.
  Migration surface is large and error-prone.

**Why not chosen:** Shadow rows are invisible to existing code. The
shadow approach has a smaller blast radius and no migration.

## Implementation

Schema changes in [`convex/schema.ts`](../../convex/schema.ts):

- New `employeeAccounts` table with name, photo, PIN, lockout, and
  soft-remove fields.
- `restaurantMembers.userId` becomes `v.optional(v.string())`.
- `restaurantMembers.employeeAccountId` added as
  `v.optional(v.id("employeeAccounts"))`.
- `restaurantMembers.removedAt` and `removedBy` for soft-removal.
- `restaurants.sharedEmployeeClerkSubject` for the shared session
  binding.

Auth helpers in [`convex/_util/auth.ts`](../../convex/_util/auth.ts):

- `requireSharedEmployeeSession` — validates the Clerk subject matches
  the restaurant's shared session.
- `verifyEmployeePin` — bcrypt comparison, lockout state machine,
  centralized to avoid drift.

New modules:

- [`convex/employeeAccounts.ts`](../../convex/employeeAccounts.ts) —
  manager-facing CRUD.
- [`convex/sharedEmployee.ts`](../../convex/sharedEmployee.ts) — shared
  session queries + self clock-in/out.

## References

- [`CONTEXT.md`](../../CONTEXT.md) — glossary entries for
  *EmployeeAccount*, *Personal PIN*, *Shared employee session*.
- [ADR-002](./002-workos-authentication.md) — original auth decision
  (WorkOS; runtime is now Clerk).

---

## Change Log

| Date       | Author     | Description     |
| ---------- | ---------- | --------------- |
| 2026-05-17 | Tavli team | Initial version |
