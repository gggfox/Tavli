/**
 * Turn the platform reservations switch on inside a test (TAVLI-100).
 *
 * The flag ships **default OFF** — a deliberate dark launch — so a suite that
 * exercises the reservation paths has to enable it exactly as a real
 * deployment does, by running the seed or flipping the flag in
 * `/admin/feature-flags`.
 *
 * That is why this helper exists rather than the flag defaulting to on for
 * tests: a test environment that silently differs from production on the one
 * switch under test would hide the very failure the switch introduces.
 */
import type { DataModel } from "../../_generated/dataModel";
import type { GenericDatabaseWriter } from "convex/server";
import { FEATURE_FLAGS } from "../../featureFlags";

/**
 * Insert the `reservations` flag, enabled.
 *
 * Call inside a `t.run` alongside the rest of a fixture's seeding. Idempotent:
 * a second call patches the existing row instead of inserting a duplicate that
 * `.first()` might then read either of.
 */
export async function enableReservationsFlag(
	db: GenericDatabaseWriter<DataModel>,
	now = Date.now()
): Promise<void> {
	const existing = await db
		.query("featureFlags")
		.withIndex("by_key", (q) => q.eq("key", FEATURE_FLAGS.RESERVATIONS))
		.first();
	if (existing) {
		await db.patch(existing._id, { enabled: true, updatedAt: now });
		return;
	}
	await db.insert("featureFlags", {
		key: FEATURE_FLAGS.RESERVATIONS,
		enabled: true,
		createdAt: now,
		updatedAt: now,
	});
}
