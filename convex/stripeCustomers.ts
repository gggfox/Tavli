/**
 * Platform-level Stripe Customers, one per Clerk user (ADR 008).
 *
 * The pay-at-submit charge sets `setup_future_usage: "off_session"`, which
 * needs a Customer to attach the card to — that saved card is what one-tap
 * tips and substitution deltas charge later. The Customer lives on the
 * platform account and follows the diner across restaurants, which is why
 * this table carries no restaurant reference (and is purge-exempt by
 * construction — see `restaurantPurge.ts`).
 *
 * These are V8 query/mutation halves only. The `customers.create` Stripe call
 * happens inside the action that needs the customer
 * (`_util/stripe.ts#getOrCreateStripeCustomerId`) — mutations cannot call
 * Stripe. The action uses the idempotency key `customer:${userId}` so two
 * racing actions get the same Stripe Customer back, and `upsertInternal`
 * resolves the remaining write race by letting the first stored row win.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { TABLE } from "./constants";

/** The stored Stripe Customer link for a Clerk user, or null before first charge. */
export const getByUserInternal = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.STRIPE_CUSTOMERS)
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.first();
	},
});

/**
 * Records the Stripe Customer for a user, unique-by-user. Returns the stored
 * customer id, which may differ from the argument when a concurrent action
 * already inserted a row — first write wins, and the caller must use the
 * returned id rather than the one it created. (The Stripe-side race is already
 * collapsed by the `customer:${userId}` idempotency key, so a divergent id here
 * is only reachable once that key expires; keeping the stored id keeps every
 * saved card on one Customer.)
 */
export const upsertInternal = internalMutation({
	args: {
		userId: v.string(),
		stripeCustomerId: v.string(),
	},
	returns: v.string(),
	handler: async (ctx, args): Promise<string> => {
		const existing = await ctx.db
			.query(TABLE.STRIPE_CUSTOMERS)
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.first();
		if (existing) {
			return existing.stripeCustomerId;
		}

		const now = Date.now();
		await ctx.db.insert(TABLE.STRIPE_CUSTOMERS, {
			userId: args.userId,
			stripeCustomerId: args.stripeCustomerId,
			createdAt: now,
			updatedAt: now,
		});
		return args.stripeCustomerId;
	},
});
