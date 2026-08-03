/**
 * Append-only audit events + stamp helpers for updatedAt / updatedBy.
 *
 * Payload rule (ADR 007): events outlive the restaurant hard purge, so
 * payloads must not carry direct personal data (names, emails, phones).
 * Reference the aggregate by id; readers join the row for display.
 */
import type { Id } from "../_generated/dataModel";
import type { DatabaseWriter } from "../_generated/server";
import { AUDIT_PAYLOAD_REDACTED, AUDIT_SYSTEM_USER_ID, TABLE, type TableName } from "../constants";

/**
 * Only the writer is needed, not a full `MutationCtx`. Typing it this way lets
 * pure helpers that take `{ db: DatabaseWriter }` -- e.g.
 * `createReservationCore` in `reservationHelpers.ts` -- append events without
 * every caller having to thread a mutation context through. `MutationCtx`
 * satisfies this, so existing call sites are unaffected.
 */
type AuditCtx = { db: DatabaseWriter };

export async function appendAuditEvent(
	ctx: AuditCtx,
	args: {
		aggregateType: TableName;
		aggregateId: string;
		eventType: string;
		payload: unknown;
		userId: string;
		idempotencyKey?: string;
	}
): Promise<Id<"allEvents">> {
	const now = Date.now();
	return await ctx.db.insert(TABLE.ALL_EVENTS, {
		eventType: args.eventType,
		aggregateType: args.aggregateType,
		aggregateId: args.aggregateId,
		payload: args.payload,
		userId: args.userId,
		timestamp: now,
		idempotencyKey: args.idempotencyKey,
		createdAt: now,
	});
}

/**
 * Scrub personal data out of one aggregate's historical event payloads while
 * keeping the events themselves (ADR 007). Top-level `fields` found in a
 * payload are overwritten with `AUDIT_PAYLOAD_REDACTED` and the event row is
 * stamped `piiRedactedAt`; events whose payload carries none of the fields are
 * left untouched. Only plain-object payloads are inspected — every emitter
 * writes one, and the fields being scrubbed are top-level by construction.
 *
 * Returns the number of events redacted.
 */
export async function redactAuditEventPersonalData(
	ctx: AuditCtx,
	args: {
		aggregateType: TableName;
		aggregateId: string;
		fields: readonly string[];
	}
): Promise<number> {
	const events = await ctx.db
		.query(TABLE.ALL_EVENTS)
		.withIndex("by_aggregate", (q) =>
			q.eq("aggregateType", args.aggregateType).eq("aggregateId", args.aggregateId)
		)
		.collect();

	let redacted = 0;
	for (const event of events) {
		const payload: unknown = event.payload;
		if (payload === null || typeof payload !== "object" || Array.isArray(payload)) continue;
		const record = payload as Record<string, unknown>;

		const present = args.fields.filter((field) => record[field] !== undefined);
		if (present.length === 0) continue;

		const next = { ...record };
		for (const field of present) next[field] = AUDIT_PAYLOAD_REDACTED;
		await ctx.db.patch(event._id, { payload: next, piiRedactedAt: Date.now() });
		redacted++;
	}
	return redacted;
}

/** Patch fields for last-modifier display on documents. */
export function stampUpdated(userId: string): { updatedAt: number; updatedBy: string } {
	const now = Date.now();
	return { updatedAt: now, updatedBy: userId };
}

export function systemStamp(): { updatedAt: number; updatedBy: string } {
	return stampUpdated(AUDIT_SYSTEM_USER_ID);
}
