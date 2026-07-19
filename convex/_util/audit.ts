/**
 * Append-only audit events + stamp helpers for updatedAt / updatedBy.
 */
import type { Id } from "../_generated/dataModel";
import type { DatabaseWriter } from "../_generated/server";
import { AUDIT_SYSTEM_USER_ID, TABLE, type TableName } from "../constants";

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

/** Patch fields for last-modifier display on documents. */
export function stampUpdated(userId: string): { updatedAt: number; updatedBy: string } {
	const now = Date.now();
	return { updatedAt: now, updatedBy: userId };
}

export function systemStamp(): { updatedAt: number; updatedBy: string } {
	return stampUpdated(AUDIT_SYSTEM_USER_ID);
}
