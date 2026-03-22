/**
 * Idempotency utilities for event sourcing.
 *
 * Provides functions to check for existing events with the same idempotencyKey
 * to prevent duplicate operations.
 */
import { AsyncReturn } from "@/global";
import { NotFoundError, NotFoundErrorObject } from "@/global/types/errors";
import type { Doc } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { TABLE, type TableName } from "../constants";

type EventDoc = Doc<typeof TABLE.ALL_EVENTS>;

/**
 * Check if an event with the given idempotencyKey already exists for the specified aggregate.
 *
 * @param ctx - Database context
 * @param aggregateType - The type of aggregate (e.g., TABLE.AUCTIONS)
 * @param aggregateId - The ID of the aggregate (as a string)
 * @param idempotencyKey - The idempotency key to check
 * @returns The existing event document if found, null otherwise
 */
export async function findExistingEventByKey(
	ctx: { db: DatabaseReader },
	aggregateType: TableName,
	aggregateId: string,
	idempotencyKey: string
): AsyncReturn<EventDoc, NotFoundErrorObject> {
	const events = await ctx.db
		.query(TABLE.ALL_EVENTS)
		.withIndex("by_aggregate", (q) =>
			q.eq("aggregateType", aggregateType).eq("aggregateId", aggregateId)
		)
		.collect();

	const existing = events.find((doc) => doc.idempotencyKey === idempotencyKey);

	if (!existing) {
		return [null, new NotFoundError("Event not found").toObject()];
	}

	return [existing, null];
}

/**
 * Check if an event with the given idempotencyKey already exists for the specified aggregate type.
 * This is useful when checking idempotency before an aggregate is created (e.g., during creation).
 *
 * @param ctx - Database context
 * @param aggregateType - The type of aggregate (e.g., TABLE.AUCTIONS)
 * @param idempotencyKey - The idempotency key to check
 * @returns The existing event document if found, null otherwise
 */
export async function findExistingEventByKeyAndType(
	ctx: { db: DatabaseReader },
	aggregateType: TableName,
	idempotencyKey: string
): AsyncReturn<EventDoc, NotFoundErrorObject> {
	const events = await ctx.db
		.query(TABLE.ALL_EVENTS)
		.withIndex("by_aggregate_type", (q) => q.eq("aggregateType", aggregateType))
		.collect();

	const existing = events.filter((doc) => doc.idempotencyKey === idempotencyKey);

	if (existing.length === 0) {
		return [null, new NotFoundError("Event not found").toObject()];
	}

	if (existing.length > 1) {
		return [
			null,
			new NotFoundError("Multiple events found with the same idempotency key").toObject(),
		];
	}

	return [existing[0], null];
}
