/**
 * V8-side queries for the payments table.
 *
 * Live in their own file because `stripe.ts` is a `"use node"` action module
 * and can't host `internalQuery` definitions.
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import { requireRestaurantManagerOrAbove } from "./_util/auth";
import { TABLE } from "./constants";

/**
 * Internal export query: returns denormalized payment rows whose bucketing
 * timestamp falls in the given calendar year. Bucketing uses `succeededAt`
 * when present (the cleanest "this payment cleared on day X" signal); rows
 * without a `succeededAt` fall back to `createdAt`.
 *
 * The action that calls this query is responsible for translating timestamps
 * into the restaurant's local month index.
 */
export const internalListPaymentsForExportYear = internalQuery({
	args: {
		actingUserId: v.string(),
		restaurantId: v.id(TABLE.RESTAURANTS),
		yearStartMs: v.number(),
		yearEndMs: v.number(),
	},
	handler: async (ctx, args) => {
		const [, aerr] = await requireRestaurantManagerOrAbove(
			ctx,
			args.actingUserId,
			args.restaurantId
		);
		if (aerr) throw new Error("Unauthorized");

		const payments = await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		// Pad bucketing window by 36h so rows near a timezone-boundary midnight
		// still flow through; the action does the precise tz-aware month bucketing.
		const PAD_MS = 36 * 60 * 60 * 1000;
		const lowerBound = args.yearStartMs - PAD_MS;
		const upperBound = args.yearEndMs + PAD_MS;

		const filtered = payments.filter((p) => {
			const bucketingMs = p.succeededAt ?? p.createdAt;
			return bucketingMs >= lowerBound && bucketingMs <= upperBound;
		});

		const tableNumberCache = new Map<Id<"tables">, number>();
		const orderCache = new Map<
			Id<"orders">,
			{ tableId: Id<"tables"> | null; dailyOrderNumber: number | null }
		>();

		const denormRows = await Promise.all(
			filtered.map(async (payment) => {
				// Tab (session-level) payments have no single order behind them.
				let orderInfo: { tableId: Id<"tables"> | null; dailyOrderNumber: number | null } = {
					tableId: null,
					dailyOrderNumber: null,
				};
				if (payment.orderId) {
					const cached = orderCache.get(payment.orderId);
					if (cached) {
						orderInfo = cached;
					} else {
						const order = await ctx.db.get(payment.orderId);
						orderInfo = {
							tableId: order?.tableId ?? null,
							dailyOrderNumber: order?.dailyOrderNumber ?? null,
						};
						orderCache.set(payment.orderId, orderInfo);
					}
				}

				let tableNumber: number | null = null;
				if (orderInfo.tableId) {
					if (tableNumberCache.has(orderInfo.tableId)) {
						tableNumber = tableNumberCache.get(orderInfo.tableId) ?? null;
					} else {
						const table = await ctx.db.get(orderInfo.tableId);
						if (table) {
							tableNumber = table.tableNumber;
							tableNumberCache.set(orderInfo.tableId, tableNumber);
						}
					}
				}

				return {
					id: payment._id as string,
					orderId: (payment.orderId as string | undefined) ?? "",
					sessionId: (payment.sessionId as string | undefined) ?? "",
					dailyOrderNumber: orderInfo.dailyOrderNumber,
					tableNumber,
					status: payment.status,
					refundStatus: payment.refundStatus,
					attemptNumber: payment.attemptNumber,
					amountCents: payment.amount,
					gratuityCents: payment.gratuityAmount ?? null,
					currency: payment.currency,
					succeededAt: payment.succeededAt ?? null,
					failedAt: payment.failedAt ?? null,
					refundRequestedAt: payment.refundRequestedAt ?? null,
					refundedAt: payment.refundedAt ?? null,
					createdAt: payment.createdAt,
					stripePaymentIntentId: payment.stripePaymentIntentId ?? "",
					stripeChargeId: payment.stripeChargeId ?? "",
					stripeRefundId: payment.stripeRefundId ?? "",
					failureCode: payment.failureCode ?? "",
					failureMessage: payment.failureMessage ?? "",
				};
			})
		);

		return denormRows;
	},
});
