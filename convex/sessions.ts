import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedError,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	fromErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { getCurrentUserId, requireRestaurantStaffAccess } from "./_util/auth";
import {
	DINER_SESSION_ERRORS,
	isSessionMember,
	requireAuthenticatedDiner,
	requireOwnedActiveSession,
	toDinerVisiblePayment,
} from "./_util/dinerSession";
import {
	AUDIT_SYSTEM_USER_ID,
	ORDER_PAYMENT_STATE,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
	SESSION_PAYMENT_STATE,
	SESSION_STATUS,
	STALE_TAB_MAX_AGE_MS,
	TABLE,
} from "./constants";
import {
	generateJoinCode,
	getPayableOrders,
	isPayableOrder,
	sumOrderTotals,
} from "./sessionHelpers";

type StaffAuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject | NotFoundErrorObject;

async function insertSessionWithJoinCode(
	ctx: { db: DatabaseWriter },
	base: {
		restaurantId: Id<typeof TABLE.RESTAURANTS>;
		userId: string;
	}
): Promise<Id<typeof TABLE.SESSIONS>> {
	// Retry on the (unlikely) collision with another open tab at the same
	// restaurant. Closed tabs may reuse a code — lookups filter on status.
	let joinCode = generateJoinCode();
	for (let attempt = 0; attempt < 5; attempt++) {
		const clash = await ctx.db
			.query(TABLE.SESSIONS)
			.withIndex("by_restaurant_join_code", (q) =>
				q.eq("restaurantId", base.restaurantId).eq("joinCode", joinCode)
			)
			.collect();
		if (!clash.some((s) => s.status === SESSION_STATUS.ACTIVE)) break;
		joinCode = generateJoinCode();
	}

	return await ctx.db.insert(TABLE.SESSIONS, {
		restaurantId: base.restaurantId,
		userId: base.userId,
		status: SESSION_STATUS.ACTIVE,
		startedAt: Date.now(),
		joinCode,
		memberUserIds: [],
		paymentState: SESSION_PAYMENT_STATE.UNPAID,
	});
}

/**
 * Open a new tab (Session) for a signed-in customer.
 * Requires Clerk authentication; binds the session to the current user and
 * generates a shareable join code so friends can join the same tab.
 */
export const create = mutation({
	args: {
		restaurantSlug: v.string(),
	},
	handler: async (ctx, args) => {
		const userId = await requireAuthenticatedDiner(ctx);

		const restaurant = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_slug", (q) => q.eq("slug", args.restaurantSlug))
			.first();

		if (!restaurant || !restaurant.isActive) {
			throw new NotFoundError("Restaurant not found");
		}

		const sessionId = await insertSessionWithJoinCode(ctx, {
			restaurantId: restaurant._id,
			userId,
		});

		return { sessionId, restaurantId: restaurant._id };
	},
});

/**
 * Join a friend's open tab with its share code. Joining implies physical
 * presence at the table, so the client also treats it as a geofence pass.
 */
export const joinByCode = mutation({
	args: {
		restaurantSlug: v.string(),
		joinCode: v.string(),
	},
	handler: async (ctx, args) => {
		const userId = await requireAuthenticatedDiner(ctx);

		const restaurant = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_slug", (q) => q.eq("slug", args.restaurantSlug))
			.first();
		if (!restaurant || !restaurant.isActive) {
			throw new NotFoundError("Restaurant not found");
		}

		const normalized = args.joinCode.trim().toUpperCase();
		const candidates = await ctx.db
			.query(TABLE.SESSIONS)
			.withIndex("by_restaurant_join_code", (q) =>
				q.eq("restaurantId", restaurant._id).eq("joinCode", normalized)
			)
			.collect();
		const session = candidates.find((s) => s.status === SESSION_STATUS.ACTIVE);
		if (!session) {
			throw fromErrorObject(new NotFoundError(DINER_SESSION_ERRORS.INVALID_JOIN_CODE).toObject());
		}

		if (!isSessionMember(session, userId)) {
			await ctx.db.patch(session._id, {
				memberUserIds: [...(session.memberUserIds ?? []), userId],
			});
		}

		return { sessionId: session._id, restaurantId: restaurant._id };
	},
});

export const getActive = query({
	args: { sessionId: v.id(TABLE.SESSIONS) },
	handler: async (ctx, args) => {
		try {
			return await requireOwnedActiveSession(ctx, args.sessionId);
		} catch {
			return null;
		}
	},
});

/**
 * Everything the tab view and tab checkout need: the payable orders, the
 * balance, tip/payment state, lock state, and the share code.
 */
export const getTabSummary = query({
	args: { sessionId: v.id(TABLE.SESSIONS) },
	handler: async (ctx, args) => {
		let session;
		try {
			session = await requireOwnedActiveSession(ctx, args.sessionId);
		} catch {
			return null;
		}

		const orders = await ctx.db
			.query(TABLE.ORDERS)
			.withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
			.collect();
		const payableOrders = orders.filter(isPayableOrder);

		const activePaymentRaw = session.activePaymentId
			? await ctx.db.get(session.activePaymentId)
			: null;

		return {
			sessionId: session._id,
			restaurantId: session.restaurantId,
			joinCode: session.joinCode ?? null,
			memberCount: 1 + (session.memberUserIds?.length ?? 0),
			lockedForPayment: session.lockedForPaymentAt !== undefined,
			paymentState: session.paymentState ?? SESSION_PAYMENT_STATE.UNPAID,
			tipAmount: session.tipAmount ?? 0,
			paidAt: session.paidAt ?? null,
			subtotal: sumOrderTotals(payableOrders),
			payableOrderIds: payableOrders.map((o) => o._id),
			activePayment: toDinerVisiblePayment(activePaymentRaw),
		};
	},
});

export const close = mutation({
	args: { sessionId: v.id(TABLE.SESSIONS) },
	handler: async (ctx, args) => {
		const session = await requireOwnedActiveSession(ctx, args.sessionId);
		if (session.lockedForPaymentAt !== undefined) {
			throw fromErrorObject(new NotAuthorizedError(DINER_SESSION_ERRORS.TAB_LOCKED).toObject());
		}

		await ctx.db.patch(args.sessionId, {
			status: SESSION_STATUS.CLOSED,
			closedAt: Date.now(),
		});
	},
});

// ============================================================================
// Tab payment internals (called from the Stripe action / webhook)
// ============================================================================

/**
 * Verifies the caller may pay this tab and returns the amount snapshot the
 * Stripe action charges. Returns null when the caller is not a member or the
 * session is not active.
 */
export const verifyTabForPaymentInternal = internalQuery({
	args: {
		sessionId: v.id(TABLE.SESSIONS),
		userId: v.string(),
	},
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session || session.status !== SESSION_STATUS.ACTIVE) return null;
		if (!isSessionMember(session, args.userId)) return null;

		const payableOrders = await getPayableOrders(ctx, args.sessionId);
		return {
			restaurantId: session.restaurantId,
			subtotal: sumOrderTotals(payableOrders),
			activePaymentId: session.activePaymentId ?? null,
			lockedForPaymentAt: session.lockedForPaymentAt ?? null,
		};
	},
});

/**
 * Locks the tab and records a new pending payment row. Supersedes any prior
 * non-terminal payment attempt (e.g. an abandoned intent with a different tip).
 */
export const beginTabPayment = internalMutation({
	args: {
		sessionId: v.id(TABLE.SESSIONS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		amount: v.number(),
		currency: v.string(),
		gratuityAmount: v.number(),
	},
	handler: async (ctx, args): Promise<Id<typeof TABLE.PAYMENTS>> => {
		const session = await ctx.db.get(args.sessionId);
		if (!session || session.status !== SESSION_STATUS.ACTIVE) {
			throw new Error("Session is not active");
		}

		// Re-check the balance inside the transaction so a concurrent order
		// submission can't desync the charged amount from the tab.
		const payableOrders = await getPayableOrders(ctx, args.sessionId);
		const subtotal = sumOrderTotals(payableOrders);
		if (subtotal + args.gratuityAmount !== args.amount) {
			throw new Error("Tab balance changed, please retry");
		}

		let attemptNumber = 1;
		if (session.activePaymentId) {
			const previous = await ctx.db.get(session.activePaymentId);
			if (previous) {
				attemptNumber = previous.attemptNumber + 1;
				if (
					previous.status !== PAYMENT_STATUS.SUCCEEDED &&
					previous.status !== PAYMENT_STATUS.SUPERSEDED &&
					previous.status !== PAYMENT_STATUS.CANCELLED
				) {
					await ctx.db.patch(previous._id, {
						status: PAYMENT_STATUS.SUPERSEDED,
						updatedAt: Date.now(),
					});
				}
			}
		}

		const now = Date.now();
		const paymentId = await ctx.db.insert(TABLE.PAYMENTS, {
			restaurantId: args.restaurantId,
			sessionId: args.sessionId,
			amount: args.amount,
			currency: args.currency,
			status: PAYMENT_STATUS.PENDING,
			refundStatus: PAYMENT_REFUND_STATUS.NONE,
			attemptNumber,
			gratuityAmount: args.gratuityAmount,
			createdAt: now,
			updatedAt: now,
		});

		await ctx.db.patch(args.sessionId, {
			lockedForPaymentAt: now,
			paymentState: SESSION_PAYMENT_STATE.PENDING,
			activePaymentId: paymentId,
		});

		return paymentId;
	},
});

export const markTabPaymentProcessing = internalMutation({
	args: {
		sessionId: v.id(TABLE.SESSIONS),
		paymentId: v.id(TABLE.PAYMENTS),
		stripePaymentIntentId: v.string(),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.paymentId, {
			status: PAYMENT_STATUS.PROCESSING,
			stripePaymentIntentId: args.stripePaymentIntentId,
			updatedAt: Date.now(),
		});
		await ctx.db.patch(args.sessionId, {
			paymentState: SESSION_PAYMENT_STATE.PROCESSING,
		});
	},
});

/**
 * Called by the Stripe webhook after payment_intent.succeeded for a tab
 * payment. Marks every payable order paid, records the tip, closes the tab.
 */
export const confirmTabPayment = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		stripePaymentIntentId: v.string(),
		stripeChargeId: v.optional(v.string()),
		gratuityAmount: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment?.sessionId) {
			throw new Error(`Tab payment ${args.paymentId} not found`);
		}
		if (payment.status === PAYMENT_STATUS.SUCCEEDED) return;

		const session = await ctx.db.get(payment.sessionId);
		if (!session) throw new Error(`Session ${payment.sessionId} not found`);
		if (session.activePaymentId !== payment._id) {
			console.warn(
				`Tab payment ${payment._id} is no longer active for session ${session._id}, skipping`
			);
			return;
		}

		const now = Date.now();
		const tip = args.gratuityAmount ?? payment.gratuityAmount ?? 0;

		await ctx.db.patch(payment._id, {
			status: PAYMENT_STATUS.SUCCEEDED,
			stripePaymentIntentId: args.stripePaymentIntentId,
			...(args.stripeChargeId !== undefined && { stripeChargeId: args.stripeChargeId }),
			...(tip > 0 && { gratuityAmount: tip }),
			succeededAt: now,
			updatedAt: now,
			updatedBy: AUDIT_SYSTEM_USER_ID,
		});

		const payableOrders = await getPayableOrders(ctx, payment.sessionId);
		for (const order of payableOrders) {
			await ctx.db.patch(order._id, {
				paymentState: ORDER_PAYMENT_STATE.PAID,
				paidAt: now,
				updatedAt: now,
				updatedBy: AUDIT_SYSTEM_USER_ID,
			});
		}

		await ctx.db.patch(session._id, {
			status: SESSION_STATUS.CLOSED,
			closedAt: now,
			lockedForPaymentAt: undefined,
			paymentState: SESSION_PAYMENT_STATE.PAID,
			tipAmount: tip,
			paidAt: now,
			settledBy: "stripe",
		});
	},
});

/** Webhook path for a failed tab PaymentIntent: unlock so ordering can resume. */
export const failTabPayment = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		stripePaymentIntentId: v.optional(v.string()),
		failureCode: v.optional(v.string()),
		failureMessage: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment?.sessionId) return;
		if (payment.status === PAYMENT_STATUS.SUCCEEDED) return;

		const now = Date.now();
		await ctx.db.patch(payment._id, {
			status: PAYMENT_STATUS.FAILED,
			...(args.stripePaymentIntentId !== undefined &&
				args.stripePaymentIntentId !== "" && {
					stripePaymentIntentId: args.stripePaymentIntentId,
				}),
			...(args.failureCode !== undefined && { failureCode: args.failureCode }),
			...(args.failureMessage !== undefined && { failureMessage: args.failureMessage }),
			failedAt: now,
			updatedAt: now,
		});

		const session = await ctx.db.get(payment.sessionId);
		if (session?.activePaymentId === payment._id && session.status === SESSION_STATUS.ACTIVE) {
			await ctx.db.patch(session._id, {
				lockedForPaymentAt: undefined,
				paymentState: SESSION_PAYMENT_STATE.FAILED,
			});
		}
	},
});

/**
 * Abandon an in-flight tab payment from the client (e.g. user backs out of
 * checkout). Unlocks the tab so the group can keep ordering.
 */
export const cancelTabPayment = mutation({
	args: { sessionId: v.id(TABLE.SESSIONS) },
	handler: async (ctx, args) => {
		const session = await requireOwnedActiveSession(ctx, args.sessionId);
		if (session.lockedForPaymentAt === undefined) return;

		if (session.activePaymentId) {
			const payment = await ctx.db.get(session.activePaymentId);
			if (
				payment &&
				payment.status !== PAYMENT_STATUS.SUCCEEDED &&
				payment.status !== PAYMENT_STATUS.FAILED
			) {
				await ctx.db.patch(payment._id, {
					status: PAYMENT_STATUS.CANCELLED,
					updatedAt: Date.now(),
				});
			}
		}

		await ctx.db.patch(args.sessionId, {
			lockedForPaymentAt: undefined,
			paymentState: SESSION_PAYMENT_STATE.UNPAID,
		});
	},
});

// ============================================================================
// Staff-facing (open tabs view, manual close)
// ============================================================================

export type OpenTabRow = {
	sessionId: Id<typeof TABLE.SESSIONS>;
	joinCode: string | null;
	startedAt: number;
	memberCount: number;
	tableNumber: number | null;
	orderCount: number;
	unpaidTotal: number;
	lockedForPayment: boolean;
	paymentState: string;
	flaggedStaleAt: number | null;
};

export const getOpenTabsByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (ctx, args): AsyncReturn<OpenTabRow[], StaffAuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, accessError] = await requireRestaurantStaffAccess(ctx, userId, args.restaurantId);
		if (accessError) return [null, accessError];

		const sessions = await ctx.db
			.query(TABLE.SESSIONS)
			.withIndex("by_restaurant_status", (q) =>
				q.eq("restaurantId", args.restaurantId).eq("status", SESSION_STATUS.ACTIVE)
			)
			.collect();

		const tabs = await Promise.all(
			sessions.map(async (session) => {
				const orders = await ctx.db
					.query(TABLE.ORDERS)
					.withIndex("by_session", (q) => q.eq("sessionId", session._id))
					.collect();
				const payableOrders = orders.filter(isPayableOrder);
				const table = session.tableId ? await ctx.db.get(session.tableId) : null;
				const orderTableId = payableOrders[0]?.tableId;
				const orderTable = !table && orderTableId ? await ctx.db.get(orderTableId) : null;
				return {
					sessionId: session._id,
					joinCode: session.joinCode ?? null,
					startedAt: session.startedAt,
					memberCount: 1 + (session.memberUserIds?.length ?? 0),
					tableNumber: table?.tableNumber ?? orderTable?.tableNumber ?? null,
					orderCount: payableOrders.length,
					unpaidTotal: sumOrderTotals(payableOrders),
					lockedForPayment: session.lockedForPaymentAt !== undefined,
					paymentState: session.paymentState ?? SESSION_PAYMENT_STATE.UNPAID,
					flaggedStaleAt: session.flaggedStaleAt ?? null,
				};
			})
		);

		// Tabs with a balance first, oldest first inside each group.
		const withBalance = tabs.filter((tab) => tab.unpaidTotal > 0);
		const withoutBalance = tabs.filter((tab) => tab.unpaidTotal === 0);
		withBalance.sort((a, b) => a.startedAt - b.startedAt);
		withoutBalance.sort((a, b) => a.startedAt - b.startedAt);
		return [[...withBalance, ...withoutBalance], null];
	},
});

/**
 * Staff closes a tab that was settled in person (walkout fallback — no card
 * pre-auth exists, so unpaid tabs are a staff problem like a normal restaurant).
 */
export const closeTabAsStaff = mutation({
	args: { sessionId: v.id(TABLE.SESSIONS) },
	handler: async function (ctx, args): AsyncReturn<string, StaffAuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const session = await ctx.db.get(args.sessionId);
		if (!session) return [null, new NotFoundError("Session not found").toObject()];

		const [, accessError] = await requireRestaurantStaffAccess(ctx, userId, session.restaurantId);
		if (accessError) return [null, accessError];

		if (session.status === SESSION_STATUS.CLOSED) return [args.sessionId, null];

		if (session.activePaymentId) {
			const payment = await ctx.db.get(session.activePaymentId);
			if (
				payment &&
				payment.status !== PAYMENT_STATUS.SUCCEEDED &&
				payment.status !== PAYMENT_STATUS.FAILED
			) {
				await ctx.db.patch(payment._id, {
					status: PAYMENT_STATUS.CANCELLED,
					updatedAt: Date.now(),
					updatedBy: userId,
				});
			}
		}

		await ctx.db.patch(args.sessionId, {
			status: SESSION_STATUS.CLOSED,
			closedAt: Date.now(),
			lockedForPaymentAt: undefined,
			settledBy: "staff",
		});

		return [args.sessionId, null];
	},
});

// ============================================================================
// Cron sweep
// ============================================================================

/**
 * End-of-day hygiene: active tabs older than STALE_TAB_MAX_AGE_MS are closed
 * when they have no unpaid balance, and flagged (surfaced in the staff open
 * tabs view) when they still owe money. Never auto-charges anything.
 */
export const sweepStaleOpenTabs = internalMutation({
	args: {},
	handler: async (ctx) => {
		const cutoff = Date.now() - STALE_TAB_MAX_AGE_MS;
		const sessions = await ctx.db.query(TABLE.SESSIONS).collect();

		for (const session of sessions) {
			if (session.status !== SESSION_STATUS.ACTIVE) continue;
			if (session.startedAt > cutoff) continue;

			const payableOrders = await getPayableOrders(ctx, session._id);
			const unpaidTotal = sumOrderTotals(payableOrders);

			if (unpaidTotal === 0) {
				await ctx.db.patch(session._id, {
					status: SESSION_STATUS.CLOSED,
					closedAt: Date.now(),
					lockedForPaymentAt: undefined,
				});
			} else if (session.flaggedStaleAt === undefined) {
				await ctx.db.patch(session._id, { flaggedStaleAt: Date.now() });
			}
		}
	},
});

/**
 * Helper used by `reservations.markSeated`. Creates an active session pinned
 * to a table at "now", in the same Convex transaction as the reservation
 * status flip, so the existing ordering flow is reachable the moment the
 * guest sits down. Not exposed as a public mutation -- callers must already
 * have authorized the staff action.
 */
export async function createSessionForReservation(
	ctx: { db: DatabaseWriter },
	args: {
		restaurantId: Id<typeof TABLE.RESTAURANTS>;
		tableId: Id<typeof TABLE.TABLES>;
		serverMemberId?: Id<"restaurantMembers">;
		/** Set when the reservation was made by a signed-in user. */
		userId?: string;
	}
): Promise<Id<typeof TABLE.SESSIONS>> {
	return await ctx.db.insert(TABLE.SESSIONS, {
		restaurantId: args.restaurantId,
		tableId: args.tableId,
		status: SESSION_STATUS.ACTIVE,
		startedAt: Date.now(),
		joinCode: generateJoinCode(),
		memberUserIds: [],
		paymentState: SESSION_PAYMENT_STATE.UNPAID,
		...(args.serverMemberId !== undefined && { serverMemberId: args.serverMemberId }),
		...(args.userId !== undefined && { userId: args.userId }),
	});
}
