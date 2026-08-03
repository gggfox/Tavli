# ADR-007: Audit events survive the restaurant purge — personal data does not

## Metadata

| Field             | Value      |
| ----------------- | ---------- |
| **Status**        | Accepted   |
| **Date**          | 2026-08-01 |
| **Author(s)**     | Tavli team |
| **Supersedes**    | —          |
| **Superseded by** | —          |

## Context

The restaurant hard purge (TAVLI-66, `convex/restaurantPurge.ts`) exists for
data retention: 30 days after a soft delete, a restaurant and its dependent
rows — reservations with guest contact details, employee accounts with legal
names and hashed PINs, orders, sessions — are hard-deleted.

`allEvents` is deliberately exempt from that cascade. The audit trail is the
record that the purge (and everything before it) actually happened; deleting it
with the rest would leave no evidence of the deletion itself, and would also
break event idempotency lookups (`convex/_util/idempotency.ts`).

Those two goals collided: several emitters denormalized personal data into
event payloads, so the exemption quietly turned the audit trail into an
indefinite store of data the purge was supposed to erase:

- `employeeAccounts.created` carried `firstName` and `paternalLastname`.
- `employeeAccounts.updated` stored the raw patch — any of the three name
  fields with their new values.
- `invitations.created` carried the invitee email.

While auditing this we also found that the purge never deleted
`employeeAccounts` rows at all: it removed the `restaurantMembers` rows that
point at them but left the accounts — legal names, PIN hashes, and photo
blobs — orphaned in the table forever. Any payload policy would be theater
while the primary rows survived.

## Decision

**The audit trail survives the purge; personal data inside it does not.**
Three rules implement this:

1. **Event payloads must not carry direct personal data** (names, emails,
   phone numbers). Payloads reference the aggregate by id; readers join the
   row for display while it exists. Once the row is purged, the event
   deliberately degrades to "who did what to which id, when" — which is the
   retention promise, not a defect. Pseudonymous identifiers (Clerk user ids,
   Stripe object ids, Convex document ids) are allowed.

2. **The restaurant purge deletes employee accounts** — rows and photo
   blobs — alongside the member rows that reference them.

3. **The purge redacts legacy personal data instead of deleting events.**
   For each employee account it deletes, the purge rewrites that aggregate's
   historical `employeeAccounts.*` payloads: the fields in
   `EMPLOYEE_ACCOUNT_PII_PAYLOAD_FIELDS` (`firstName`, `paternalLastname`,
   `maternalLastname`) are overwritten with `AUDIT_PAYLOAD_REDACTED` and the
   event row is stamped `piiRedactedAt`. Everything else — event type, actor,
   timestamp, ids — is preserved. This is the one sanctioned break in
   `allEvents`' append-only discipline, and `piiRedactedAt` is the honest
   marker that it happened.

Deliberate boundaries of the policy:

- **Business data in tombstone events stays.** `restaurants.hard_deleted`,
  `sections.hard_deleted`, and `tables.hard_deleted` snapshot the business
  entity (restaurant name/slug, section names, table labels) into the payload
  on purpose — that is the business's own operational record, not personal
  data about an individual.
- **Historical `invitations.created` emails are fixed forward-only.** The
  invitation row is organization-scoped and survives a restaurant purge, so
  redacting the event while the row keeps the email would achieve nothing.
  New events no longer carry the email; erasing historical invitation data
  belongs to a future organization-deletion flow.
- **Clerk user ids in events are out of scope.** They are pseudonymous
  references; erasure for a Clerk identity is a user-account-deletion
  concern, not part of the restaurant purge.

## Consequences

### Positive

- The purge now delivers its retention promise: after it runs, no legal
  names, emails, PIN hashes, or photos of the restaurant's people remain —
  in the primary tables or in the audit trail.
- The audit trail stays complete: every event survives with actor,
  timestamp, and aggregate ids intact, so sequences like "manager X created
  an account, reset its PIN twice, restaurant purged on date Y" remain
  reconstructible.
- Idempotency keys in `allEvents` are untouched, so replay protection keeps
  working across the purge.

### Negative

- Audit readers lose display names for purged aggregates; events read as
  "account `k57…` created by user `user_2N…`". While the aggregate row
  exists this is recoverable by a join; after the purge it is not — by
  design.
- Redaction must know the legacy field names. If a historical event carried
  personal data under a field not in `EMPLOYEE_ACCOUNT_PII_PAYLOAD_FIELDS`,
  it would survive. The forward-looking rule (no personal data in new
  payloads) keeps this list frozen rather than growing.

### Neutral

- `allEvents` is no longer strictly append-only: `piiRedactedAt` marks the
  single sanctioned mutation. Anything else writing to existing events is
  still a bug.
- Restaurants purged before this change may have left orphaned
  `employeeAccounts` rows and un-redacted events behind. If any exist in a
  live deployment, they need a one-off backfill (iterate accounts whose
  `restaurantId` no longer resolves, then delete + redact with the same
  helpers).

## Alternatives Considered

### Option 1: Accept the trade-off and document it (audit trail wins)

Keep names in payloads; declare the audit trail exempt from erasure.

**Pros:**

- Zero code; audit events stay self-contained and human-readable forever.

**Cons:**

- Indefinite retention of employee legal names after the row purge
  contradicts the purge's reason to exist and common data-protection
  expectations (the names serve no audit purpose the id doesn't).
- The names duplicated data available by joining the aggregate row anyway;
  their only unique value arose exactly when they were supposed to be gone.

**Why not chosen:** the audit trail loses almost nothing by holding ids
instead of names, and the retention promise is worth more than payload
readability.

### Option 2: Only stop writing names into new payloads

Fix the emitters; leave historical payloads as they are.

**Pros:**

- Smallest diff; no write into existing events.

**Cons:**

- Every already-written name would still outlive its purge, indefinitely —
  the reported problem stays unsolved for all existing data.
- Does nothing about the orphaned `employeeAccounts` rows.

**Why not chosen:** it fixes the leak for data that doesn't exist yet and
ignores the data that does. It is, however, half of the chosen policy.

### Option 3: Only redact at purge time (keep writing names)

Leave emitters alone; rely on the purge to scrub every field list forever.

**Pros:**

- Payloads stay readable during the restaurant's life without a join.

**Cons:**

- The redaction field list has to chase every emitter change forever; one
  forgotten field name silently reintroduces the leak.
- Readability-without-a-join is marginal: every reader of these events
  already has db access to the aggregate row.

**Why not chosen:** redaction is the right tool for the legacy backlog, but
as the _only_ mechanism it turns a frozen migration list into a permanently
growing liability.

### Option 4: Delete the aggregate's events at purge time

Drop the exemption for purged aggregates and delete their events.

**Pros:**

- Simplest possible retention story.

**Cons:**

- Destroys the audit trail precisely where scrutiny is most likely
  (post-deletion disputes: attendance, tips, terminations).
- Deletes idempotency-keyed rows, weakening replay protection.

**Why not chosen:** the exemption exists for good reasons; the problem was
never the events, only the personal data inside them.

## Implementation

- `convex/_util/audit.ts` — payload rule documented on `appendAuditEvent`;
  `redactAuditEventPersonalData(ctx, { aggregateType, aggregateId, fields })`
  rewrites top-level payload fields to `AUDIT_PAYLOAD_REDACTED` and stamps
  `piiRedactedAt`, skipping events that carry none of the fields.
- `convex/constants.ts` — `AUDIT_PAYLOAD_REDACTED`,
  `EMPLOYEE_ACCOUNT_PII_PAYLOAD_FIELDS`, and the payload policy comment next
  to `AUDIT_EVENT`.
- `convex/restaurantPurge.ts` — `hardDeleteRestaurantDataTyped` now iterates
  the restaurant's `employeeAccounts`: redacts each account's events, deletes
  its photo blob, then deletes the row.
- `convex/schema.ts` — `allEvents.piiRedactedAt` (optional number).
- Emitters fixed: `employeeAccounts.created` (ids only),
  `employeeAccounts.updated` (`{ updatedFields }` — field names, not
  values), `invitations.created` (role only, email stays on the row).
- Tests: `convex/_tests/restaurantPurgePii.test.ts` (new payload shape,
  account/photo deletion, legacy redaction incl. cross-restaurant
  isolation), plus an `invitations.created` payload assertion in
  `convex/_tests/invites.test.ts`.

## References

- [ADR-006](./006-managed-employee-accounts.md) — why employee accounts hold
  this data at all
- TAVLI-66 — restaurant soft delete + hard purge
- `convex/restaurantPurge.ts`, `convex/_util/audit.ts`,
  `convex/_util/idempotency.ts`

---

## Change Log

| Date       | Author     | Description     |
| ---------- | ---------- | --------------- |
| 2026-08-01 | Tavli team | Initial version |
