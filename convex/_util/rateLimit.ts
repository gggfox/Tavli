/**
 * Hand-rolled sliding-window (fixed-window counter) rate limiter.
 *
 * Convex has an official `@convex-dev/rate-limiter` component, but it requires
 * `convex.config.ts` registration + codegen against a live deployment. This
 * module is a dependency-free stand-in: a single `rateLimits` table keyed by an
 * opaque string, plus the pure decision function below.
 *
 * The design is split so the interesting logic is trivially unit-testable:
 *   - `evaluateRateLimit` is PURE -- given the stored counter (or `null`), the
 *     current time, and a config, it returns whether the hit is allowed and the
 *     counter state to persist. No I/O.
 *   - `consumeRateLimit` is the thin DB wrapper that reads the row via the
 *     `by_key` index, calls `evaluateRateLimit`, and writes the new state back.
 *
 * Fixed-window semantics: a counter accumulates within `[windowStart,
 * windowStart + windowMs)`; the first hit after the window elapses opens a
 * fresh window. This is a coarse approximation of a true sliding window, but it
 * is O(1) in reads/writes and needs only two numeric columns.
 */
import type { Doc } from "../_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "../_generated/server";
import { TABLE } from "../constants";

export interface RateLimitConfig {
	/** Length of a window in milliseconds. */
	windowMs: number;
	/** Maximum number of hits permitted within a single window. */
	max: number;
}

/** The persisted counter state for one key. */
export interface RateLimitState {
	windowStart: number;
	count: number;
}

export interface RateLimitDecision {
	/** True when the hit is within the cap (and should be counted). */
	allowed: boolean;
	/** Counter state to persist. On rejection this is the unchanged prior state. */
	state: RateLimitState;
	/** Milliseconds until the active window resets. `0` when a fresh window opens. */
	retryAfterMs: number;
}

/**
 * PURE fixed-window decision. `previous` is the stored counter (or `null` when
 * the key has never been seen). Never mutates its inputs.
 */
export function evaluateRateLimit(
	previous: RateLimitState | null,
	now: number,
	config: RateLimitConfig
): RateLimitDecision {
	// No prior state, or the previous window has fully elapsed: open a fresh
	// window and count this hit as the first.
	if (previous === null || now - previous.windowStart >= config.windowMs) {
		return { allowed: true, state: { windowStart: now, count: 1 }, retryAfterMs: 0 };
	}

	// Within the active window and still under the cap: count this hit.
	if (previous.count < config.max) {
		return {
			allowed: true,
			state: { windowStart: previous.windowStart, count: previous.count + 1 },
			retryAfterMs: 0,
		};
	}

	// Over the cap: reject and leave the stored counter untouched so a flood of
	// rejected hits can't push the window forward.
	return {
		allowed: false,
		state: previous,
		retryAfterMs: Math.max(0, previous.windowStart + config.windowMs - now),
	};
}

/** Minimal ctx surface the DB wrapper needs: read the index, insert, patch. */
type RateLimitWriteCtx = {
	db: Pick<DatabaseReader, "query"> & Pick<DatabaseWriter, "insert" | "patch">;
};

type RateLimitDoc = Doc<typeof TABLE.RATE_LIMITS>;

/**
 * Read the counter for `key`, apply {@link evaluateRateLimit}, and persist the
 * result. Returns the decision. Must run inside a mutation (it writes); the
 * read + write happen in one transaction so Convex OCC handles concurrent
 * callers on the same key without double-counting.
 *
 * `now` is injectable for deterministic tests; it defaults to `Date.now()`.
 */
export async function consumeRateLimit(
	ctx: RateLimitWriteCtx,
	key: string,
	config: RateLimitConfig,
	now: number = Date.now()
): Promise<RateLimitDecision> {
	// `.first()` rather than `.unique()`: a duplicate row (from a rare insert
	// race) must never throw on the create path and take down bookings.
	const existing: RateLimitDoc | null = await ctx.db
		.query(TABLE.RATE_LIMITS)
		.withIndex("by_key", (q) => q.eq("key", key))
		.first();

	const decision = evaluateRateLimit(
		existing ? { windowStart: existing.windowStart, count: existing.count } : null,
		now,
		config
	);

	if (!decision.allowed) return decision;

	if (existing) {
		await ctx.db.patch(existing._id, {
			windowStart: decision.state.windowStart,
			count: decision.state.count,
			updatedAt: now,
		});
	} else {
		await ctx.db.insert(TABLE.RATE_LIMITS, {
			key,
			windowStart: decision.state.windowStart,
			count: decision.state.count,
			updatedAt: now,
		});
	}

	return decision;
}
