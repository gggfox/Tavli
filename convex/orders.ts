import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import {
	ConflictError,
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { appendAuditEvent } from "./_util/audit";
import {
	getCurrentUserId,
	requireRestaurantManagerOrAbove,
	requireRestaurantStaffAccess,
} from "./_util/auth";
import {
	isSessionMember,
	requireAuthenticatedDiner,
	requireOwnedActiveSession,
	requireOwnedOrder,
	requireUnlockedOwnedSession,
	toDinerVisiblePayment,
} from "./_util/dinerSession";
import {
	AUDIT_EVENT,
	AUDIT_SYSTEM_USER_ID,
	DEFAULT_ORDER_NUMBER_RESET_FREQUENCY,
	DEFAULT_PREP_STATION,
	ORDER_PAYMENT_STATE,
	ORDER_STATUS,
	PAYMENT_KIND,
	PAYMENT_STATUS,
	PREP_STATION,
	type PrepStation,
	SETTLED_BY,
	TABLE,
} from "./constants";
import { isCashSettledOrder, paymentMoneyBreakdown } from "./paymentMoneyHelpers";
import { allocateNextOrderNumber } from "./orderDayCounters";
import { getOrderResetPeriodKey, getOrderServiceDateKey } from "./orderServiceDate";
import { resolveAttributedMemberId } from "./_util/attribution";
import {
	allowedOrderTransitions,
	assertPositiveIntegerQuantity,
	DASHBOARD_STATUS_VALIDATOR,
	DASHBOARD_STATUSES,
	type DashboardStatusCounts,
	getApplicableStations,
	hasStationTicket,
	SERVICE_DATE_FILTER_VALIDATOR,
	type ServiceDateFilter,
	invalidateActivePayment,
	loadOrderItemTranslations,
	normalizeSelectedOptions,
	owesInPersonPayment,
	PREP_STATION_VALIDATOR,
	recalculateTotal,
	releasesCashOrdersImmediately,
	resolvePrepStation,
	selectedOptionValidator,
} from "./orderHelpers";
import {
	cancelPendingProposalsForOrder,
	executeOrderItemCancellation,
} from "./orderItemCancellation";
import { resolveSucceededPaymentForOrder } from "./orderRefundHelpers";

type StaffAuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

// ============================================================================
// Customer-facing (Clerk auth required; session ownership enforced)
// ============================================================================

export const createDraft = mutation({
	args: {
		sessionId: v.id(TABLE.SESSIONS),
		tableId: v.id(TABLE.TABLES),
	},
	handler: async (ctx, args) => {
		const session = await requireUnlockedOwnedSession(ctx, args.sessionId);

		const table = await ctx.db.get(args.tableId);
		if (!table || !table.isActive || table.restaurantId !== session.restaurantId) {
			throw new NotFoundError("Table not found");
		}

		// TAVLI-83: a Session is opened from the QR code, before the diner knows
		// where they are sitting, so the table only becomes known at the first
		// order. Pin it onto the session here — that is what makes the table read
		// as taken on the picker and on the staff floor editor. Only when unset:
		// a session belongs to one table, and later rounds must not move it
		// (reservation-seated sessions already arrive with theirs set).
		if (session.tableId === undefined) {
			await ctx.db.patch(session._id, { tableId: args.tableId });
		}

		const existingDraft = await ctx.db
			.query(TABLE.ORDERS)
			.withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
			.collect();

		const draft = existingDraft.find((o) => o.status === "draft");
		if (draft) return draft._id;

		const now = Date.now();
		return await ctx.db.insert(TABLE.ORDERS, {
			sessionId: args.sessionId,
			restaurantId: session.restaurantId,
			tableId: args.tableId,
			status: "draft",
			totalAmount: 0,
			paymentState: ORDER_PAYMENT_STATE.UNPAID,
			createdAt: now,
			updatedAt: now,
		});
	},
});

export const addItem = mutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		menuItemId: v.id(TABLE.MENU_ITEMS),
		quantity: v.number(),
		selectedOptions: v.array(selectedOptionValidator),
		specialInstructions: v.optional(v.string()),
		lang: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		assertPositiveIntegerQuantity(args.quantity);

		const order = await requireOwnedOrder(ctx, args.orderId, { draftOnly: true });

		const menuItem = await ctx.db.get(args.menuItemId);
		if (!menuItem) throw new NotFoundError("Menu item not found");

		const menuItemName = (args.lang && menuItem.translations?.[args.lang]?.name) || menuItem.name;

		const normalizedSelectedOptions = await normalizeSelectedOptions(
			ctx,
			order.restaurantId,
			args.selectedOptions
		);
		const optionsTotal = normalizedSelectedOptions.reduce((sum, o) => sum + o.priceModifier, 0);
		const lineTotal = (menuItem.basePrice + optionsTotal) * args.quantity;

		const itemId = await ctx.db.insert(TABLE.ORDER_ITEMS, {
			orderId: args.orderId,
			menuItemId: args.menuItemId,
			menuItemName,
			quantity: args.quantity,
			unitPrice: menuItem.basePrice,
			selectedOptions: normalizedSelectedOptions,
			specialInstructions: args.specialInstructions,
			lineTotal,
			createdAt: Date.now(),
		});

		await invalidateActivePayment(ctx, order);
		await recalculateTotal(ctx, args.orderId);
		return itemId;
	},
});

export const updateItem = mutation({
	args: {
		orderItemId: v.id(TABLE.ORDER_ITEMS),
		quantity: v.optional(v.number()),
		selectedOptions: v.optional(v.array(selectedOptionValidator)),
		specialInstructions: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.orderItemId);
		if (!item) throw new NotFoundError("Order item not found");

		if (args.quantity !== undefined) {
			assertPositiveIntegerQuantity(args.quantity);
		}

		const order = await requireOwnedOrder(ctx, item.orderId, { draftOnly: true });

		const quantity = args.quantity ?? item.quantity;
		const selectedOptions =
			args.selectedOptions !== undefined
				? await normalizeSelectedOptions(ctx, order.restaurantId, args.selectedOptions)
				: item.selectedOptions;
		const optionsTotal = selectedOptions.reduce((sum, o) => sum + o.priceModifier, 0);
		const lineTotal = (item.unitPrice + optionsTotal) * quantity;

		await ctx.db.patch(args.orderItemId, {
			...(args.quantity !== undefined && { quantity: args.quantity }),
			...(args.selectedOptions !== undefined && { selectedOptions }),
			...(args.specialInstructions !== undefined && {
				specialInstructions: args.specialInstructions,
			}),
			lineTotal,
		});

		await invalidateActivePayment(ctx, order);
		await recalculateTotal(ctx, item.orderId);
	},
});

export const removeItem = mutation({
	args: { orderItemId: v.id(TABLE.ORDER_ITEMS) },
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.orderItemId);
		if (!item) throw new NotFoundError("Order item not found");

		const order = await requireOwnedOrder(ctx, item.orderId, { draftOnly: true });

		await ctx.db.delete(args.orderItemId);
		await invalidateActivePayment(ctx, order);
		await recalculateTotal(ctx, item.orderId);
	},
});

/**
 * Persists order-level notes on a draft before it heads to checkout (ADR 008).
 * Under the tab model the notes travelled inside `submitOrder`; pay-at-submit
 * has no diner-side submit call — `confirmPayment` (webhook) and
 * `requestPayInPerson` flip the status — so the draft row itself must carry
 * them. Bumps `updatedAt` (and supersedes any active intent) so a payment
 * intent priced before the edit can never settle a differently-annotated
 * order.
 */
export const setDraftInstructions = mutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		specialInstructions: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const order = await requireOwnedOrder(ctx, args.orderId, { draftOnly: true });

		await ctx.db.patch(args.orderId, {
			specialInstructions: args.specialInstructions,
			updatedAt: Date.now(),
		});
		await invalidateActivePayment(ctx, order);
	},
});

/**
 * LEGACY pre-ADR-008 path: sends a draft order to the kitchen/bar unpaid
 * (TAVLI-6 tab model — the whole tab settles with one Stripe payment at the
 * end of the visit). Kept fully functional for pre-pivot sessions and for the
 * frontend until Phase 2A ships the pay-at-submit checkout, then removed with
 * the rest of the tab machinery. New-model orders reach the kitchen through
 * `confirmPayment` (card, via webhook) or `markOrderPaidInPerson` (cash).
 * Allocates the daily order number and server attribution here, where the
 * order becomes real for the restaurant.
 */
export const submitOrder = mutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		specialInstructions: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const order = await requireOwnedOrder(ctx, args.orderId, { draftOnly: true });

		const items = await ctx.db
			.query(TABLE.ORDER_ITEMS)
			.withIndex("by_order", (q) => q.eq("orderId", args.orderId))
			.collect();

		if (items.length === 0) {
			throw new UserInputValidationError({
				fields: [{ field: "items", message: "Order must have at least one item" }],
			});
		}

		const restaurant = await ctx.db.get(order.restaurantId);
		if (!restaurant) {
			throw new NotFoundError("Restaurant not found");
		}

		const now = Date.now();

		const orderServiceDateKey = getOrderServiceDateKey(
			now,
			restaurant.timezone,
			restaurant.orderDayStartMinutesFromMidnight
		);
		const periodKey = getOrderResetPeriodKey(
			now,
			restaurant.timezone,
			restaurant.orderDayStartMinutesFromMidnight,
			restaurant.orderNumberResetFrequency ?? DEFAULT_ORDER_NUMBER_RESET_FREQUENCY
		);
		const dailyOrderNumber = await allocateNextOrderNumber(ctx, order.restaurantId, periodKey, now);

		const session = await ctx.db.get(order.sessionId);
		const attributedMemberId = await resolveAttributedMemberId(ctx, {
			restaurantId: order.restaurantId,
			tableId: order.tableId,
			atMs: now,
			sessionServerMemberId: session?.serverMemberId,
		});

		await ctx.db.patch(args.orderId, {
			status: "submitted",
			paymentState: ORDER_PAYMENT_STATE.UNPAID,
			submittedAt: now,
			dailyOrderNumber,
			orderServiceDateKey,
			...(attributedMemberId !== undefined && { attributedMemberId }),
			...(args.specialInstructions !== undefined && {
				specialInstructions: args.specialInstructions,
			}),
			updatedAt: now,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.ORDERS,
			aggregateId: args.orderId,
			eventType: AUDIT_EVENT.ORDER_SUBMITTED,
			restaurantId: order.restaurantId,
			payload: {
				sessionId: order.sessionId,
				restaurantId: order.restaurantId,
				tableId: order.tableId,
				itemCount: items.length,
				totalAmount: order.totalAmount,
				dailyOrderNumber,
				orderServiceDateKey,
			},
			// Any tab member can submit against a shared tab, so the session opener
			// is not necessarily the actor.
			userId: await requireAuthenticatedDiner(ctx),
		});
	},
});

/**
 * The diner commits a draft for **in-person (cash) payment** (ADR 008): the
 * order becomes `awaiting_payment`, a staff-only status that never reaches the
 * kitchen rail. Staff collect the cash and release it via
 * {@link markOrderPaidInPerson}, or cancel it.
 *
 * Mirrors `submitOrder`'s validation (owned unlocked session, non-empty
 * order) and, like it, allocates the daily order number and server attribution
 * here — staff need a callable number to collect against, and the order is now
 * real for the restaurant even though the kitchen hasn't seen it.
 */
export const requestPayInPerson = mutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		specialInstructions: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		// `draftOnly` also routes through `requireUnlockedOwnedSession`, keeping
		// the tab-lock guard for legacy sessions.
		const order = await requireOwnedOrder(ctx, args.orderId, { draftOnly: true });

		// A live card intent must be cancelled first (stripe.cancelOrderPaymentIntent).
		// Without this guard the diner could commit to cash while the PaymentElement
		// is still mounted, and a late card confirmation would double-settle the
		// order the staff just collected cash for.
		if (order.activePaymentId) {
			const activePayment = await ctx.db.get(order.activePaymentId);
			if (
				activePayment &&
				(activePayment.status === PAYMENT_STATUS.PENDING ||
					activePayment.status === PAYMENT_STATUS.PROCESSING)
			) {
				throw new ConflictError("ERROR_ORDER_PAYMENT_IN_FLIGHT");
			}
		}

		const items = await ctx.db
			.query(TABLE.ORDER_ITEMS)
			.withIndex("by_order", (q) => q.eq("orderId", args.orderId))
			.collect();
		const liveItems = items.filter((item) => item.cancelledAt === undefined);

		if (liveItems.length === 0) {
			throw new UserInputValidationError({
				fields: [{ field: "items", message: "Order must have at least one item" }],
			});
		}

		const restaurant = await ctx.db.get(order.restaurantId);
		if (!restaurant) {
			throw new NotFoundError("Restaurant not found");
		}

		const now = Date.now();

		const orderServiceDateKey = getOrderServiceDateKey(
			now,
			restaurant.timezone,
			restaurant.orderDayStartMinutesFromMidnight
		);
		const periodKey = getOrderResetPeriodKey(
			now,
			restaurant.timezone,
			restaurant.orderDayStartMinutesFromMidnight,
			restaurant.orderNumberResetFrequency ?? DEFAULT_ORDER_NUMBER_RESET_FREQUENCY
		);
		const dailyOrderNumber = await allocateNextOrderNumber(ctx, order.restaurantId, periodKey, now);

		const session = await ctx.db.get(order.sessionId);
		const attributedMemberId = await resolveAttributedMemberId(ctx, {
			restaurantId: order.restaurantId,
			tableId: order.tableId,
			atMs: now,
			sessionServerMemberId: session?.serverMemberId,
		});

		const dinerId = await requireAuthenticatedDiner(ctx);

		await ctx.db.patch(args.orderId, {
			status: ORDER_STATUS.AWAITING_PAYMENT,
			awaitingPaymentAt: now,
			dailyOrderNumber,
			orderServiceDateKey,
			...(attributedMemberId !== undefined && { attributedMemberId }),
			...(args.specialInstructions !== undefined && {
				specialInstructions: args.specialInstructions,
			}),
			updatedAt: now,
			updatedBy: dinerId,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.ORDERS,
			aggregateId: args.orderId,
			eventType: AUDIT_EVENT.ORDER_AWAITING_PAYMENT,
			restaurantId: order.restaurantId,
			payload: {
				sessionId: order.sessionId,
				restaurantId: order.restaurantId,
				tableId: order.tableId,
				itemCount: liveItems.length,
				totalAmount: order.totalAmount,
				dailyOrderNumber,
				orderServiceDateKey,
			},
			// Any tab member can commit their own round, so the session opener is
			// not necessarily the actor.
			userId: dinerId,
		});
	},
});

/**
 * Transactional half of `stripe.cancelOrderPaymentIntent`: marks the order's
 * active pending/processing payment `cancelled` and clears the order's payment
 * pointer so the cash path (`requestPayInPerson`) unblocks. Mirrors the
 * bookkeeping of `sessions.cancelTabPayment` and the supersede semantics of
 * `invalidateActivePayment`.
 *
 * A payment that already `succeeded` is left untouched — the webhook owns that
 * settlement and cancelling it here would orphan real money.
 */
export const cancelActivePaymentInternal = internalMutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		/** Clerk subject of the diner who abandoned the intent (audit actor). */
		userId: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const order = await ctx.db.get(args.orderId);
		if (!order?.activePaymentId) return false;
		if (order.status !== "draft" && order.status !== ORDER_STATUS.AWAITING_PAYMENT) return false;

		const payment = await ctx.db.get(order.activePaymentId);
		if (!payment) return false;
		if (payment.status !== PAYMENT_STATUS.PENDING && payment.status !== PAYMENT_STATUS.PROCESSING) {
			return false;
		}

		const now = Date.now();
		await ctx.db.patch(payment._id, {
			status: PAYMENT_STATUS.CANCELLED,
			updatedAt: now,
		});
		await ctx.db.patch(order._id, {
			paymentState: ORDER_PAYMENT_STATE.UNPAID,
			activePaymentId: undefined,
			stripePaymentIntentId: undefined,
			updatedAt: now,
			updatedBy: args.userId,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.ORDERS,
			aggregateId: order._id,
			eventType: AUDIT_EVENT.ORDER_PAYMENT_CANCELLED,
			restaurantId: order.restaurantId,
			payload: {
				restaurantId: order.restaurantId,
				sessionId: order.sessionId,
				paymentId: payment._id,
				amount: payment.amount,
				stripePaymentIntentId: payment.stripePaymentIntentId,
			},
			userId: args.userId,
		});
		return true;
	},
});

/**
 * Called by the Stripe webhook handler after payment_intent.succeeded.
 * Releases a paid order to the kitchen: `draft` or `awaiting_payment` (a diner
 * who switched from cash to card) flips to `submitted`, payment facts are
 * recorded, and the ADR 008 settlement stamps (`settledBy: "stripe"`,
 * `paidByUserId`) land on the order.
 */
export const confirmPayment = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		stripePaymentIntentId: v.string(),
		stripeChargeId: v.optional(v.string()),
		gratuityAmount: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment) {
			throw new Error(`Payment ${args.paymentId} not found`);
		}
		if (!payment.orderId) {
			throw new Error(`Payment ${args.paymentId} is not an order payment`);
		}
		const paymentOrderId = payment.orderId;
		if (payment.status === PAYMENT_STATUS.SUCCEEDED) {
			return;
		}

		const order = await ctx.db.get(paymentOrderId);
		if (!order) throw new Error(`Order ${payment.orderId} not found`);
		if (order.activePaymentId !== payment._id) {
			console.warn(`Payment ${payment._id} is no longer active for order ${order._id}, skipping`);
			return;
		}
		if (
			payment.orderUpdatedAtSnapshot !== undefined &&
			order.updatedAt !== payment.orderUpdatedAtSnapshot
		) {
			console.warn(`Order ${order._id} changed after payment intent ${payment._id}, skipping`);
			return;
		}
		// New-model payments charge subtotal + fee, so the order total matches the
		// payment's `subtotalAmount`; legacy per-order intents carry no
		// `subtotalAmount` and charged the order total directly — the `??` keeps
		// them settling. A mismatch means the order was edited after the intent
		// was created: no-op, a fresh intent will supersede this one.
		if (order.totalAmount !== (payment.subtotalAmount ?? payment.amount)) {
			console.warn(
				`Order ${order._id} total ${order.totalAmount} no longer matches payment ${payment.amount}`
			);
			return;
		}
		if (
			order.status !== "draft" &&
			order.status !== "submitted" &&
			order.status !== ORDER_STATUS.AWAITING_PAYMENT
		) {
			console.warn(
				`Order ${order._id} is in status ${order.status}, skipping payment confirmation`
			);
			return;
		}

		const items = await ctx.db
			.query(TABLE.ORDER_ITEMS)
			.withIndex("by_order", (q) => q.eq("orderId", paymentOrderId))
			.collect();

		if (items.length === 0) {
			throw new Error(`Order ${paymentOrderId} has no items`);
		}

		const session = await ctx.db.get(order.sessionId);
		const attributedMemberId = await resolveAttributedMemberId(ctx, {
			restaurantId: order.restaurantId,
			tableId: order.tableId,
			atMs: Date.now(),
			sessionServerMemberId: session?.serverMemberId,
		});

		const now = Date.now();
		await ctx.db.patch(payment._id, {
			status: PAYMENT_STATUS.SUCCEEDED,
			stripePaymentIntentId: args.stripePaymentIntentId,
			...(args.stripeChargeId !== undefined && { stripeChargeId: args.stripeChargeId }),
			succeededAt: now,
			updatedAt: now,
			updatedBy: AUDIT_SYSTEM_USER_ID,
			...(args.gratuityAmount !== undefined && args.gratuityAmount > 0
				? { gratuityAmount: args.gratuityAmount }
				: {}),
		});

		const restaurant = await ctx.db.get(order.restaurantId);
		if (!restaurant) {
			throw new Error(`Restaurant ${order.restaurantId} not found`);
		}

		let dailyOrderNumber: number | undefined;
		let orderServiceDateKey: string | undefined;
		if (order.dailyOrderNumber === undefined) {
			orderServiceDateKey = getOrderServiceDateKey(
				now,
				restaurant.timezone,
				restaurant.orderDayStartMinutesFromMidnight
			);
			const periodKey = getOrderResetPeriodKey(
				now,
				restaurant.timezone,
				restaurant.orderDayStartMinutesFromMidnight,
				restaurant.orderNumberResetFrequency ?? DEFAULT_ORDER_NUMBER_RESET_FREQUENCY
			);
			dailyOrderNumber = await allocateNextOrderNumber(ctx, order.restaurantId, periodKey, now);
		}

		await ctx.db.patch(order._id, {
			status: "submitted",
			paymentState: ORDER_PAYMENT_STATE.PAID,
			stripePaymentIntentId: args.stripePaymentIntentId,
			paidAt: now,
			submittedAt: now,
			settledBy: "stripe",
			...(payment.paidByUserId !== undefined && { paidByUserId: payment.paidByUserId }),
			updatedAt: now,
			updatedBy: AUDIT_SYSTEM_USER_ID,
			...(dailyOrderNumber !== undefined && { dailyOrderNumber }),
			...(orderServiceDateKey !== undefined && { orderServiceDateKey }),
			...(attributedMemberId !== undefined && { attributedMemberId }),
		});

		// Webhook-originated, so the actor is the system rather than the diner.
		// Every early `return` above is a no-op path (already succeeded, stale
		// snapshot, amount drift) and deliberately writes no event.
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.ORDERS,
			aggregateId: order._id,
			eventType: AUDIT_EVENT.ORDER_PAYMENT_CONFIRMED,
			restaurantId: order.restaurantId,
			payload: {
				paymentId: payment._id,
				restaurantId: order.restaurantId,
				sessionId: order.sessionId,
				amount: payment.amount,
				subtotalAmount: payment.subtotalAmount,
				feeAmount: payment.feeAmount,
				gratuityAmount: args.gratuityAmount,
				fromStatus: order.status,
				stripePaymentIntentId: args.stripePaymentIntentId,
			},
			userId: AUDIT_SYSTEM_USER_ID,
			idempotencyKey: args.stripePaymentIntentId,
		});
	},
});

export const failPayment = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		stripePaymentIntentId: v.string(),
		failureCode: v.optional(v.string()),
		failureMessage: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment?.orderId) return;
		if (payment.status === PAYMENT_STATUS.SUCCEEDED) return;

		const now = Date.now();
		await ctx.db.patch(payment._id, {
			status: PAYMENT_STATUS.FAILED,
			stripePaymentIntentId: args.stripePaymentIntentId,
			...(args.failureCode !== undefined && { failureCode: args.failureCode }),
			...(args.failureMessage !== undefined && { failureMessage: args.failureMessage }),
			failedAt: now,
			updatedAt: now,
		});

		// `awaiting_payment` joins draft here: a diner switching from cash to card
		// keeps the order in `awaiting_payment` while the intent is in flight, and
		// a decline must surface as `failed` rather than a stale `processing`.
		const order = await ctx.db.get(payment.orderId);
		if (
			order?.activePaymentId === payment._id &&
			(order.status === "draft" || order.status === ORDER_STATUS.AWAITING_PAYMENT)
		) {
			await ctx.db.patch(order._id, {
				paymentState: ORDER_PAYMENT_STATE.FAILED,
				updatedAt: now,
			});
		}

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.ORDERS,
			aggregateId: payment.orderId,
			eventType: AUDIT_EVENT.ORDER_PAYMENT_FAILED,
			restaurantId: payment.restaurantId,
			payload: {
				paymentId: payment._id,
				amount: payment.amount,
				failureCode: args.failureCode,
				// Stripe's decline messages are customer-safe and are the whole
				// point of the record; without them a failure trail says nothing.
				failureMessage: args.failureMessage,
				stripePaymentIntentId: args.stripePaymentIntentId,
			},
			userId: AUDIT_SYSTEM_USER_ID,
			idempotencyKey: args.stripePaymentIntentId,
		});
	},
});

export const getOrderWithItems = query({
	args: { orderId: v.id(TABLE.ORDERS) },
	handler: async (ctx, args) => {
		let order;
		try {
			order = await requireOwnedOrder(ctx, args.orderId);
		} catch {
			return null;
		}

		const items = await ctx.db
			.query(TABLE.ORDER_ITEMS)
			.withIndex("by_order", (q) => q.eq("orderId", args.orderId))
			.collect();

		const activePaymentRaw = order.activePaymentId ? await ctx.db.get(order.activePaymentId) : null;

		// The succeeded pay-at-submit charge backing this order (ADR 008), so the
		// UI can display what was ACTUALLY charged (subtotal/fee split) instead of
		// recomputing the fee from the rate. Null for cash orders
		// (`markOrderPaidInPerson` writes no payments row) and legacy tab-paid
		// orders — those carried no customer-borne fee, so no fee line renders.
		const paidPayment =
			activePaymentRaw?.status === PAYMENT_STATUS.SUCCEEDED &&
			activePaymentRaw.kind === PAYMENT_KIND.ORDER
				? {
						subtotalAmount: activePaymentRaw.subtotalAmount ?? order.totalAmount,
						feeAmount: activePaymentRaw.feeAmount ?? 0,
						amount: activePaymentRaw.amount,
						paidAt: activePaymentRaw.succeededAt ?? order.paidAt ?? null,
					}
				: null;

		return {
			...order,
			paymentState: order.paymentState ?? ORDER_PAYMENT_STATE.UNPAID,
			activePayment: toDinerVisiblePayment(activePaymentRaw),
			paidPayment,
			items,
		};
	},
});

export const getOrdersBySession = query({
	args: { sessionId: v.id(TABLE.SESSIONS) },
	handler: async (ctx, args) => {
		try {
			await requireOwnedActiveSession(ctx, args.sessionId);
		} catch {
			return [];
		}

		return await ctx.db
			.query(TABLE.ORDERS)
			.withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
			.collect();
	},
});

/**
 * Used by Stripe actions to enforce session membership before payment intent
 * creation. Membership, not ownership: any tab member (opener or join-code
 * joiner) pays for their **own** round under ADR 008, so the same predicate
 * `verifyTabForPaymentInternal` uses gates here. Accepts `draft` (normal
 * pay-at-submit) and `awaiting_payment` (a diner switching from cash to card).
 */
export const verifyOrderForPaymentInternal = internalQuery({
	args: {
		orderId: v.id(TABLE.ORDERS),
		userId: v.string(),
	},
	returns: v.union(v.id(TABLE.ORDERS), v.null()),
	handler: async (ctx, args) => {
		const order = await ctx.db.get(args.orderId);
		if (!order) return null;
		if (order.status !== "draft" && order.status !== ORDER_STATUS.AWAITING_PAYMENT) return null;
		const session = await ctx.db.get(order.sessionId);
		if (!session || session.status !== "active" || !isSessionMember(session, args.userId)) {
			return null;
		}
		return order._id;
	},
});

// ============================================================================
// Staff-facing (auth required)
// ============================================================================

export const updateStatus = mutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		newStatus: v.union(
			v.literal("preparing"),
			v.literal("ready"),
			v.literal("served"),
			v.literal("cancelled")
		),
	},
	handler: async function (ctx, args): AsyncReturn<string, StaffAuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const order = await ctx.db.get(args.orderId);
		if (!order) return [null, new NotFoundError("Order not found").toObject()];

		const [staffRestaurant, restaurantError] = await requireRestaurantStaffAccess(
			ctx,
			userId,
			order.restaurantId
		);
		if (restaurantError) return [null, restaurantError];

		// Cancelling is the only transition that moves money — a paid order
		// refunds the diner — and it voids a kitchen ticket. Employees advance
		// tickets; only managers cancel. Checked before the transition test so an
		// employee gets "manager required" rather than a confusing state error.
		if (args.newStatus === "cancelled") {
			const [, managerError] = await requireRestaurantManagerOrAbove(
				ctx,
				userId,
				order.restaurantId
			);
			if (managerError) return [null, managerError];
		}

		// With `releaseCashOrdersImmediately` on, an uncollected cash round is
		// workable and advances exactly like `submitted` (TAVLI-81); off, this is
		// the ADR 008 table verbatim and `awaiting_payment` can only be cancelled.
		const allowedNext = allowedOrderTransitions(
			order.status,
			releasesCashOrdersImmediately(staffRestaurant)
		);
		if (!allowedNext?.includes(args.newStatus)) {
			// Cancelling a served order is now the most likely rejection here, and
			// the frontend needs a stable code for it — a free-text validation
			// message renders as the generic fallback string.
			if (args.newStatus === "cancelled") {
				throw new ConflictError("ERROR_ORDER_NOT_CANCELLABLE");
			}
			throw new UserInputValidationError({
				fields: [
					{
						field: "newStatus",
						message: `Cannot transition from ${order.status} to ${args.newStatus}`,
					},
				],
			});
		}

		const now = Date.now();

		// Defensive backfill: any pre-feature / seed order without a daily number
		// gets one allocated against today's live counter the first time the
		// kitchen touches it. Should never fire in steady state because
		// confirmPayment is the canonical allocator.
		let backfilledNumberPatch: {
			dailyOrderNumber?: number;
			orderServiceDateKey?: string;
		} = {};
		if (order.dailyOrderNumber === undefined) {
			const restaurant = await ctx.db.get(order.restaurantId);
			if (restaurant) {
				const orderServiceDateKey = getOrderServiceDateKey(
					now,
					restaurant.timezone,
					restaurant.orderDayStartMinutesFromMidnight
				);
				const periodKey = getOrderResetPeriodKey(
					now,
					restaurant.timezone,
					restaurant.orderDayStartMinutesFromMidnight,
					restaurant.orderNumberResetFrequency ?? DEFAULT_ORDER_NUMBER_RESET_FREQUENCY
				);
				const dailyOrderNumber = await allocateNextOrderNumber(
					ctx,
					order.restaurantId,
					periodKey,
					now
				);
				backfilledNumberPatch = { dailyOrderNumber, orderServiceDateKey };
			}
		}

		await ctx.db.patch(args.orderId, {
			status: args.newStatus,
			...(args.newStatus === "cancelled" &&
				order.paymentState === ORDER_PAYMENT_STATE.PAID && {
					paymentState: ORDER_PAYMENT_STATE.REFUND_REQUESTED,
				}),
			...backfilledNumberPatch,
			updatedAt: now,
			updatedBy: userId,
		});

		// No refund is issued from here. This mutation is the transactional half
		// of a cancel (and the dedup gate — `VALID_TRANSITIONS` has no `cancelled`
		// key, so a second cancel throws); the Stripe call lives in
		// `stripe.cancelOrderAndRefund`, which calls this first and then refunds.
		// A manager who calls this mutation directly leaves the order in
		// `refund_requested`, which the orders tab surfaces as a pending refund.

		// A cancelled order withdraws every pending substitution proposal on it —
		// there is no line left for the diner to accept a replacement onto
		// (TAVLI-71 Phase 3A). In-flight delta payments are retired in-app; the
		// webhook race is closed by `confirmSubstitutionPayment`'s auto-refund.
		if (args.newStatus === "cancelled") {
			await cancelPendingProposalsForOrder(ctx, {
				orderId: args.orderId,
				actorUserId: userId,
				reason: "order_cancelled",
			});
		}

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.ORDERS,
			aggregateId: args.orderId,
			eventType: AUDIT_EVENT.ORDER_STATUS_CHANGED,
			restaurantId: order.restaurantId,
			payload: {
				restaurantId: order.restaurantId,
				fromStatus: order.status,
				toStatus: args.newStatus,
				// Whether this cancel leaves money to be returned. The refund itself
				// is audited separately by `recordOrderRefundOutcomeInternal`.
				refundEligible:
					args.newStatus === "cancelled" && order.paymentState === ORDER_PAYMENT_STATE.PAID,
				totalAmount: order.totalAmount,
			},
			userId,
		});

		return [args.orderId, null];
	},
});

/**
 * Staff collected the cash for a round that owes it (ADR 008): stamps it paid
 * (`settledBy: "staff"`) and, when the kitchen has not seen it yet, releases it
 * to `submitted`.
 *
 * Callable at **every stage**, not only from `awaiting_payment` (TAVLI-81).
 * Where `releaseCashOrdersImmediately` is on, the round is already being cooked
 * while the cash is uncollected, so "mark paid in person" has to work from
 * `preparing`, `ready` and `served` too — collecting is otherwise unreachable
 * once the kitchen advances the ticket, which is precisely the workflow block
 * this ticket removes. The status is only rewritten on the release step: past
 * `awaiting_payment` the order keeps the status the kitchen gave it, and only
 * the money fields move.
 *
 * Deliberately writes **no `payments` row** — no Stripe money moved, and a
 * synthetic row would poison every revenue aggregate that reads the payments
 * table. Analytics and exports must therefore never assume paid ⇒ payments row
 * exists; the durable record of the cash is the order itself plus the
 * `orders.paidInPerson` audit event. `paidByUserId` stays unset for the same
 * reason: it means "this member's saved card paid", and there is no card here.
 */
export const markOrderPaidInPerson = mutation({
	args: { orderId: v.id(TABLE.ORDERS) },
	handler: async function (ctx, args): AsyncReturn<string, StaffAuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const order = await ctx.db.get(args.orderId);
		if (!order) return [null, new NotFoundError("Order not found").toObject()];

		const [, restaurantError] = await requireRestaurantStaffAccess(ctx, userId, order.restaurantId);
		if (restaurantError) return [null, restaurantError];

		// Keeps the stable code the frontend already maps. With the toggle off
		// this rejects exactly what the old `status !== awaiting_payment` check
		// rejected: an order can only owe in person while it holds that status.
		if (!owesInPersonPayment(order)) {
			throw new ConflictError("ERROR_ORDER_NOT_AWAITING_PAYMENT");
		}

		const isRelease = order.status === ORDER_STATUS.AWAITING_PAYMENT;
		const now = Date.now();
		await ctx.db.patch(args.orderId, {
			// Releasing is what makes `submitted` mean "the kitchen may start", so
			// it belongs to the collection only while the kitchen has not started.
			...(isRelease && { status: "submitted" as const, submittedAt: now }),
			paymentState: ORDER_PAYMENT_STATE.PAID,
			paidAt: now,
			settledBy: "staff",
			updatedAt: now,
			updatedBy: userId,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.ORDERS,
			aggregateId: args.orderId,
			eventType: AUDIT_EVENT.ORDER_PAID_IN_PERSON,
			restaurantId: order.restaurantId,
			payload: {
				restaurantId: order.restaurantId,
				sessionId: order.sessionId,
				amount: order.totalAmount,
				dailyOrderNumber: order.dailyOrderNumber,
			},
			userId,
		});

		return [args.orderId, null];
	},
});

const DEFAULT_DASHBOARD_STATUSES = ["submitted", "preparing", "ready"] as const;

/**
 * Ceiling on how many orders `getDashboardStatusCounts` will read per status.
 *
 * Counting spans every dashboard status at once, and `served` / `cancelled`
 * grow with the restaurant's whole history — an uncapped count would make the
 * dashboard hold a live subscription over that entire history and re-run on
 * every write to it. Past the cap the query reports what it saw plus
 * `capped: true`, and the UI renders "200+" rather than a wrong number.
 */
export const DASHBOARD_COUNT_SCAN_CAP = 200;

/**
 * Predicate for "does this order fall inside the requested service window".
 *
 * Buckets on `createdAt` rather than the stored `orderServiceDateKey`: that
 * column is only written at payment confirmation, so every unpaid and
 * awaiting-payment order — exactly the ones staff most need to see today —
 * would otherwise be filtered out as undated. Bucketing uses the restaurant's
 * own rollover, so an order opened at 01:00 still counts as last night's.
 */
function buildServiceDatePredicate(
	restaurant: Doc<"restaurants">,
	serviceDate: ServiceDateFilter | undefined
): (order: Doc<"orders">) => boolean {
	if (serviceDate !== "today") return () => true;

	const todayKey = getOrderServiceDateKey(
		Date.now(),
		restaurant.timezone,
		restaurant.orderDayStartMinutesFromMidnight
	);

	return (order) =>
		getOrderServiceDateKey(
			order.createdAt,
			restaurant.timezone,
			restaurant.orderDayStartMinutesFromMidnight
		) === todayKey;
}

/**
 * Per-status card counts for the dashboard's status filter, under the
 * station filter currently applied.
 *
 * Counts what the user would SEE on each segment, not how many orders hold
 * that status: with a single station selected the dashboard switches to that
 * station's rail, where `hasStationTicket` decides what survives — so these
 * counts route through the same rule (see `convex/orderHelpers.ts`).
 */
export const getDashboardStatusCounts = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		prepStations: v.optional(v.array(PREP_STATION_VALIDATOR)),
		serviceDate: v.optional(SERVICE_DATE_FILTER_VALIDATOR),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<DashboardStatusCounts, StaffAuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [restaurant, accessError] = await requireRestaurantStaffAccess(
			ctx,
			userId,
			args.restaurantId
		);
		if (accessError) return [null, accessError];

		const isInServiceWindow = buildServiceDatePredicate(restaurant, args.serviceDate);

		const stationFilter =
			args.prepStations && args.prepStations.length > 0 ? new Set(args.prepStations) : null;
		// Exactly one station selected puts the dashboard on that station's
		// rail; `awaiting_payment` is excluded there and handled as cards —
		// unless this restaurant releases cash orders immediately (TAVLI-81),
		// where those rounds are ordinary rail work.
		const railStation =
			args.prepStations && args.prepStations.length === 1 ? args.prepStations[0] : null;
		const cashReleasedImmediately = releasesCashOrdersImmediately(restaurant);

		// Every key is filled by the loop below, which walks all statuses.
		const counts = {} as DashboardStatusCounts;

		for (const status of DASHBOARD_STATUSES) {
			// Newest first, so a capped scan keeps the orders an ops board
			// actually cares about — and so a "today" window is never missed
			// behind a wall of older history.
			const scanned = await ctx.db
				.query(TABLE.ORDERS)
				.withIndex("by_restaurant_status", (q) =>
					q.eq("restaurantId", args.restaurantId).eq("status", status)
				)
				.order("desc")
				.take(DASHBOARD_COUNT_SCAN_CAP);

			const orders = scanned.filter(isInServiceWindow);

			// Hitting the ceiling only makes the count uncertain if the window
			// was still open at the oldest row we saw. With a "today" filter
			// whose oldest scanned order already predates the window, every
			// unscanned order is older still — the count is exact.
			const oldestScanned = scanned[scanned.length - 1];
			const capped =
				scanned.length === DASHBOARD_COUNT_SCAN_CAP &&
				oldestScanned !== undefined &&
				isInServiceWindow(oldestScanned);

			// No station filter: every order in the window is a card.
			if (!stationFilter) {
				counts[status] = { count: orders.length, capped };
				continue;
			}

			const onRail =
				railStation !== null && (status !== "awaiting_payment" || cashReleasedImmediately);
			let count = 0;

			for (const order of orders) {
				const items = await ctx.db
					.query(TABLE.ORDER_ITEMS)
					.withIndex("by_order", (q) => q.eq("orderId", order._id))
					.collect();

				const liveStationItems = [];
				for (const item of items) {
					if (item.cancelledAt !== undefined) continue;
					const menuItem = await ctx.db.get(item.menuItemId);
					const station = menuItem ? resolvePrepStation(menuItem) : DEFAULT_PREP_STATION;
					if (stationFilter.has(station)) liveStationItems.push(item);
				}

				if (onRail) {
					const stamp = railStation === "kitchen" ? order.kitchenReadyAt : order.barReadyAt;
					if (
						hasStationTicket({
							status: order.status,
							stationStamp: stamp,
							liveStationItemCount: liveStationItems.length,
							cashReleasedImmediately,
						})
					) {
						count += 1;
					}
					continue;
				}

				// Card grid with a station filter: the same presence check the
				// orders query applies.
				if (liveStationItems.length > 0) count += 1;
			}

			counts[status] = { count, capped };
		}

		return [counts, null];
	},
});

export const getActiveOrdersByRestaurant = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		// When omitted, defaults to the active set (submitted/preparing/ready)
		// so existing callers keep behaving as before.
		statuses: v.optional(v.array(DASHBOARD_STATUS_VALIDATOR)),
		// When omitted or empty, no station filter is applied (= "show all
		// stations"). When provided, only orders containing at least one
		// item whose `menuItem.prepStation` matches one of the listed
		// stations are returned (presence filter — the full card still
		// renders, the UI applies the visual highlight on matching items).
		// Reads `menuItems.prepStation` live (no snapshot on `orderItems`).
		prepStations: v.optional(v.array(PREP_STATION_VALIDATOR)),
		// Service-day window. Omitted / "all" keeps the original behavior of
		// returning every order in the requested statuses.
		serviceDate: v.optional(SERVICE_DATE_FILTER_VALIDATOR),
	},
	handler: async function (ctx, args) {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [restaurant, accessError] = await requireRestaurantStaffAccess(
			ctx,
			userId,
			args.restaurantId
		);
		if (accessError) return [null, accessError];

		const isInServiceWindow = buildServiceDatePredicate(restaurant, args.serviceDate);
		// Joined onto every card below rather than fetched separately by the
		// dashboard: whether an uncollected cash round may be worked is a fact
		// the card, the station rail and the action row all have to agree on,
		// and a second subscription to the restaurant row could disagree with
		// this one for a frame (TAVLI-81).
		const cashReleasedImmediately = releasesCashOrdersImmediately(restaurant);

		const requestedStatuses =
			args.statuses && args.statuses.length > 0
				? Array.from(new Set(args.statuses))
				: [...DEFAULT_DASHBOARD_STATUSES];

		// One indexed range per requested status — avoids collecting the
		// restaurant's entire (unbounded) order history just to keep the
		// handful of active tickets. `requestedStatuses` is deduped above,
		// so the per-status results are disjoint.
		const ordersPerStatus = await Promise.all(
			requestedStatuses.map((status) =>
				ctx.db
					.query(TABLE.ORDERS)
					.withIndex("by_restaurant_status", (q) =>
						q.eq("restaurantId", args.restaurantId).eq("status", status)
					)
					.collect()
			)
		);
		const filteredOrders = ordersPerStatus.flat().filter(isInServiceWindow);

		const ordersWithItems = await Promise.all(
			filteredOrders.map(async (order) => {
				const items = await ctx.db
					.query(TABLE.ORDER_ITEMS)
					.withIndex("by_order", (q) => q.eq("orderId", order._id))
					.collect();
				const table = await ctx.db.get(order.tableId);
				// `null`, never `0`: a table that has been deleted or purged is a
				// missing join, and the dashboard has to say so instead of sending
				// a server to a table numbered zero (TAVLI-80).
				return {
					...order,
					items,
					tableNumber: table?.tableNumber ?? null,
					cashReleasedImmediately,
				};
			})
		);

		const allItems = ordersWithItems.flatMap((o) => o.items);
		const { menuItemTranslations, optionTranslations, optionGroupTranslations } =
			await loadOrderItemTranslations(ctx, allItems);

		// Live lookup for prepStation — orderItems intentionally do NOT
		// snapshot the station, so a manager re-tagging a menuItem
		// re-routes already-active tickets. Documented in ADR 005 and the
		// CONTEXT.md flagged ambiguity.
		const menuItemIds = Array.from(new Set(allItems.map((i) => i.menuItemId)));
		const menuItemDocs = await Promise.all(menuItemIds.map((id) => ctx.db.get(id)));
		const menuItemStationMap = new Map<string, PrepStation>();
		for (const doc of menuItemDocs) {
			if (doc) menuItemStationMap.set(doc._id, resolvePrepStation(doc));
		}

		const stationFilter =
			args.prepStations && args.prepStations.length > 0 ? new Set(args.prepStations) : null;

		const enrichedOrders = ordersWithItems
			.map((order) => ({
				...order,
				items: order.items.map((item) => ({
					...item,
					prepStation: menuItemStationMap.get(item.menuItemId) ?? DEFAULT_PREP_STATION,
					menuItemTranslations: menuItemTranslations.get(item.menuItemId),
					selectedOptions: item.selectedOptions.map((selected) => ({
						...selected,
						optionTranslations: optionTranslations.get(selected.optionId),
						optionGroupTranslations: optionGroupTranslations.get(selected.optionGroupId),
					})),
				})),
			}))
			.filter((order) => {
				if (!stationFilter) return true;
				// An order whose only items at this station were 86'd has nothing
				// left for it to prepare, so it drops out of that station's queue.
				return order.items.some(
					(it) => it.cancelledAt === undefined && stationFilter.has(it.prepStation)
				);
			});

		return [enrichedOrders, null];
	},
});

/**
 * Mark this order's portion at a given station as ready. Independently
 * stamps `kitchenReadyAt` or `barReadyAt`. When *every* station that
 * actually has items in this order has been stamped, also advance the
 * order's overall `status` to "ready" via the normal transition path so
 * downstream consumers (UI, reports, exports) keep a single source of
 * truth on whole-order completion.
 *
 * Station autonomy without per-item state: see ADR 005.
 */
export const markStationReady = mutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		station: PREP_STATION_VALIDATOR,
	},
	handler: async function (ctx, args): AsyncReturn<string, StaffAuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const order = await ctx.db.get(args.orderId);
		if (!order) return [null, new NotFoundError("Order not found").toObject()];

		const [stationRestaurant, restaurantError] = await requireRestaurantStaffAccess(
			ctx,
			userId,
			order.restaurantId
		);
		if (restaurantError) return [null, restaurantError];

		// A station can only mark itself ready while the order is in flight
		// (submitted / preparing). Once "ready"/"served"/"cancelled", the
		// per-station stamp is no longer meaningful.
		//
		// Where the restaurant releases cash orders immediately (TAVLI-81), an
		// uncollected `awaiting_payment` round is in flight too — it sits on the
		// rail, so the station that cooked it must be able to stamp it. Off, that
		// status never reaches a rail and this rejects it exactly as before.
		const isInFlight =
			order.status === "submitted" ||
			order.status === "preparing" ||
			(order.status === ORDER_STATUS.AWAITING_PAYMENT &&
				releasesCashOrdersImmediately(stationRestaurant));
		if (!isInFlight) {
			throw new UserInputValidationError({
				fields: [
					{
						field: "station",
						message: `Cannot mark ${args.station} ready while order is ${order.status}`,
					},
				],
			});
		}

		const items = await ctx.db
			.query(TABLE.ORDER_ITEMS)
			.withIndex("by_order", (q) => q.eq("orderId", order._id))
			.collect();

		const menuItemIds = Array.from(new Set(items.map((i) => i.menuItemId)));
		const menuItemDocs = await Promise.all(menuItemIds.map((id) => ctx.db.get(id)));
		const menuItemStationMap = new Map<string, PrepStation>();
		for (const doc of menuItemDocs) {
			if (doc) menuItemStationMap.set(doc._id, resolvePrepStation(doc));
		}
		const applicable = getApplicableStations(items, menuItemStationMap);

		// The bartender pressing "Mark bar ready" on a kitchen-only order
		// would be a UI bug; reject defensively so we surface it instead of
		// silently no-oping.
		if (!applicable.has(args.station)) {
			throw new UserInputValidationError({
				fields: [
					{
						field: "station",
						message: `Order has no items prepared at the ${args.station}`,
					},
				],
			});
		}

		const now = Date.now();
		const stationStamp =
			args.station === PREP_STATION.KITCHEN ? { kitchenReadyAt: now } : { barReadyAt: now };

		// Compute next stamps so we can decide whether to flip the overall
		// status in the same patch. Pre-existing stamps survive (we never
		// overwrite a prior `*ReadyAt`).
		const nextKitchenReadyAt =
			args.station === PREP_STATION.KITCHEN ? (order.kitchenReadyAt ?? now) : order.kitchenReadyAt;
		const nextBarReadyAt =
			args.station === PREP_STATION.BAR ? (order.barReadyAt ?? now) : order.barReadyAt;

		const everyStationDone = Array.from(applicable).every((station) =>
			station === PREP_STATION.KITCHEN
				? nextKitchenReadyAt !== undefined
				: nextBarReadyAt !== undefined
		);

		// The guard above narrowed the status to one the kitchen is actively
		// working ("submitted" / "preparing", plus an immediately-released
		// `awaiting_payment`), so flipping to "ready" is always a forward step
		// here when every applicable station has been stamped. A released cash
		// round leaves `awaiting_payment` behind at this point and never returns
		// to it — its debt is carried by `awaitingPaymentAt` + `paidAt` from here
		// on (`owesInPersonPayment`), which is what keeps the badge, the
		// mark-paid action and the session guards intact.
		const statusPatch = everyStationDone ? { status: "ready" as const } : {};

		await ctx.db.patch(args.orderId, {
			...stationStamp,
			...statusPatch,
			updatedAt: now,
			updatedBy: userId,
		});

		return [args.orderId, null];
	},
});

/**
 * Undo a `markStationReady` stamp. On the station's own dashboard, stamping
 * bumps the station ticket off the rail, so a mistap makes work disappear —
 * this is the escape hatch behind the dashboard's short undo window.
 *
 * Clears the station's `*ReadyAt` and, when that stamp had been the one to
 * flip the whole order to "ready", walks the status back to "preparing".
 * `VALID_TRANSITIONS` stays forward-only on purpose: this backwards step is
 * encapsulated here, exactly like `markStationReady` encapsulates the forward
 * flip. Like that mutation, it writes no audit event.
 */
export const unmarkStationReady = mutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		station: PREP_STATION_VALIDATOR,
	},
	handler: async function (ctx, args): AsyncReturn<string, StaffAuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const order = await ctx.db.get(args.orderId);
		if (!order) return [null, new NotFoundError("Order not found").toObject()];

		const [unmarkRestaurant, restaurantError] = await requireRestaurantStaffAccess(
			ctx,
			userId,
			order.restaurantId
		);
		if (restaurantError) return [null, restaurantError];

		// Once served or cancelled the order has left the stations' hands, and a
		// stamp on a still-`submitted` order is unreachable from the ticket UI.
		//
		// A released cash round (TAVLI-81) can hold a stamp while still
		// `awaiting_payment` — one station of two done — so the undo window has
		// to reach it, or a mistap there is unrecoverable.
		const isUndoable =
			order.status === "preparing" ||
			order.status === "ready" ||
			(order.status === ORDER_STATUS.AWAITING_PAYMENT &&
				releasesCashOrdersImmediately(unmarkRestaurant));
		if (!isUndoable) {
			throw new UserInputValidationError({
				fields: [
					{
						field: "station",
						message: `Cannot undo ${args.station} ready while order is ${order.status}`,
					},
				],
			});
		}

		const stationStamp =
			args.station === PREP_STATION.KITCHEN ? order.kitchenReadyAt : order.barReadyAt;
		if (stationStamp === undefined) {
			throw new UserInputValidationError({
				fields: [{ field: "station", message: `Order is not marked ready at the ${args.station}` }],
			});
		}

		const now = Date.now();
		const clearedStamp =
			args.station === PREP_STATION.KITCHEN
				? { kitchenReadyAt: undefined }
				: { barReadyAt: undefined };

		await ctx.db.patch(args.orderId, {
			...clearedStamp,
			// The order can only be "ready" here because every applicable station
			// was stamped; removing one stamp makes that false again.
			...(order.status === "ready" && { status: "preparing" as const }),
			updatedAt: now,
			updatedBy: userId,
		});

		return [args.orderId, null];
	},
});

/**
 * "86" a single line: the kitchen is out of an ingredient, the bar is out of a
 * bottle. Cancelling the whole round because one station cannot make one item
 * is the wrong blast radius — this drops just that line.
 *
 * Two payment worlds (ADR 008):
 * - **Unpaid rounds** (legacy tab flow, and `awaiting_payment` cash orders):
 *   the line simply leaves `Order.totalAmount` — the diner is billed less and
 *   no Stripe call is made.
 * - **Paid orders** (pay-at-submit): the line is refunded — its price plus its
 *   share of the customer-borne service fee — via a scheduled
 *   `stripe.refundOrderItem`. The order keeps cooking; only 86'ing the last
 *   live line cancels it and refunds the payment's entire remaining balance.
 *
 * A payment or refund **in flight** (pending/processing/refund_*) still
 * refuses: 86'ing under an open intent shifts the total nobody agreed to, and
 * a double-86 while a refund is pending must not be able to double-refund.
 * That includes an `awaiting_payment` order whose diner is mid cash→card
 * switch — the open intent, not the status, decides.
 *
 * Orders paid by a **legacy** payment (a tab payment, or a pre-fee per-order
 * intent — no `subtotalAmount`) also refuse: the line-refund math is
 * fee-inclusive and its last-live-line sweep refunds the payment's entire
 * remaining balance, which against a tab payment would be other orders' money.
 * Legacy money keeps the pre-pivot rule — cancel the whole order instead.
 *
 * No station-level authorization exists in this codebase by design (ADR 005:
 * the station filter is a UI convenience, not an access boundary), so any
 * restaurant staff may 86 any line. `cancelledBy`/`cancelledAt` is the trail.
 */
export const cancelOrderItem = mutation({
	args: { orderItemId: v.id(TABLE.ORDER_ITEMS) },
	handler: async function (ctx, args): AsyncReturn<string, StaffAuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const item = await ctx.db.get(args.orderItemId);
		if (!item) return [null, new NotFoundError("Order item not found").toObject()];

		const order = await ctx.db.get(item.orderId);
		if (!order) return [null, new NotFoundError("Order not found").toObject()];

		const [, restaurantError] = await requireRestaurantStaffAccess(ctx, userId, order.restaurantId);
		if (restaurantError) return [null, restaurantError];

		if (item.cancelledAt !== undefined) {
			throw new ConflictError("ERROR_ORDER_ITEM_NOT_CANCELLABLE");
		}

		// Drafts belong to the diner (`removeItem`), and once an order is ready
		// the food is plated — comping that is a manager's whole-order call.
		// `awaiting_payment` is 86-able like any un-fired round: the cash hasn't
		// been collected, so the line just leaves what staff will collect.
		if (
			order.status !== "submitted" &&
			order.status !== "preparing" &&
			order.status !== ORDER_STATUS.AWAITING_PAYMENT
		) {
			throw new ConflictError("ERROR_ORDER_ITEM_NOT_CANCELLABLE");
		}

		// "Unpaid" is decided by paymentState alone — `awaiting_payment` gets no
		// shortcut. A diner switching cash→card holds an open intent while the
		// status stays awaiting_payment (paymentState pending/processing);
		// 86'ing under that intent would shift the total the payment sheet is
		// about to charge, and the webhook would then no-op the settle on the
		// snapshot mismatch — money moved, order stuck. requestPayInPerson
		// leaves paymentState unpaid and failPayment stamps `failed`, so a cash
		// order with no card attempt in flight still qualifies here.
		const paymentState = order.paymentState;
		const isUnpaid =
			paymentState === undefined ||
			paymentState === ORDER_PAYMENT_STATE.UNPAID ||
			paymentState === ORDER_PAYMENT_STATE.FAILED;
		const isPaid = !isUnpaid && paymentState === ORDER_PAYMENT_STATE.PAID;
		if (!isUnpaid && !isPaid) {
			// Payment or refund in flight — see the doc comment. Keeps the stable
			// code the frontend already maps.
			throw new ConflictError("ERROR_ORDER_ITEM_CANCEL_PAID");
		}

		// A tab locked for payment has a balance snapshot in flight; shifting the
		// total underneath it would charge the diner an amount nobody agreed to.
		// (Legacy sessions only — new-model sessions never lock.)
		const session = await ctx.db.get(order.sessionId);
		if (session?.lockedForPaymentAt !== undefined) {
			throw new ConflictError("ERROR_ORDER_ITEM_CANCEL_TAB_LOCKED");
		}

		// Resolve the money **before** stamping the line: a paid order whose
		// succeeded payment cannot be found must not end up with a cancelled line
		// and no refund on its way.
		let paidPaymentId: Id<typeof TABLE.PAYMENTS> | null = null;
		if (isPaid) {
			const paidPayment = await resolveSucceededPaymentForOrder(ctx, order);
			if (!paidPayment) {
				throw new ConflictError("ERROR_REFUND_PAYMENT_UNRESOLVED");
			}
			// Line refunds only exist for fee-inclusive ADR 008 payments (kind
			// "order", `subtotalAmount` set — the same vintage marker
			// `computeOrderRefundAmount` branches on). A legacy payment here is a
			// tab payment covering many orders (e.g. a residue order settled
			// before tabs waited for service) or a pre-fee per-order intent:
			// `refundOrderItem`'s fee top-up would refund money the diner never
			// paid, and its last-live-line sweep would refund the *other* orders'
			// subtotals and the tip. Restore the pre-pivot block for that money —
			// the whole-order cancel path owns legacy refund math (per-order
			// clamp, no fee).
			if (paidPayment.kind !== PAYMENT_KIND.ORDER || paidPayment.subtotalAmount === undefined) {
				throw new ConflictError("ERROR_ORDER_ITEM_CANCEL_PAID");
			}
			paidPaymentId = paidPayment._id;
		}

		// The cancellation itself — stamps, totals, last-live-line fallout, and
		// the scheduled refund — is shared with `substitutions.declineProposal`
		// (the diner declining a substitution 86's the line the same way). Any
		// pending substitution proposal on the line is auto-cancelled in there:
		// the 86 is the stronger signal, so staff never have to withdraw the
		// proposal first.
		await executeOrderItemCancellation(ctx, {
			item,
			order,
			actorUserId: userId,
			paidPaymentId,
		});

		return [args.orderItemId, null];
	},
});

/**
 * Rows for the staff Payments ledger: every paid Order in the window **plus**
 * every succeeded post-visit tip payment, which under ADR 008 is its own
 * `payments` row with no order behind it. Both kinds carry `rowKind` so the
 * table can label a tip distinctly from an order.
 *
 * Money per row follows `convex/paymentMoneyHelpers.ts`:
 * - `subtotalCents` is the food the restaurant sold. For an order this is the
 *   live `orders.totalAmount` (so an 86'd line leaves it, and an accepted
 *   substitution's delta is already in it), not the charge-time snapshot on
 *   the payment; tips contribute zero.
 * - `serviceFeeCents` is the customer-borne Tavli fee actually charged — the
 *   order payment's `feeAmount` **plus** every accepted substitution's
 *   `feeOnDelta`, which rode its own PaymentIntent — and is `null` when there
 *   is no fee-split payment behind the row (cash orders report a known 0;
 *   pre-pivot tab-settled orders report `null`, the commission having never
 *   been recorded on our side).
 * - `netToRestaurantCents` is what the restaurant keeps (subtotal + tip), also
 *   `null` for legacy rows for the same reason.
 *
 * ## One payment's money is never reported twice
 *
 * A row only takes tip/charge money from a payment whose `orderId` is that
 * order. This matters for the pre-pivot tail: `sessions.confirmTabPayment`
 * stamps ONE tab payment as `activePaymentId` on EVERY order it covers, so
 * reading its `gratuityAmount` off the order row multiplied a single tab's tip
 * by the number of orders on the tab (the dashboard's Tips card sums the
 * column). The tab's gratuity is instead surfaced once, as its own tip row
 * keyed on the payment. Order rows and that tip row partition the tab charge
 * exactly: Σ covered `orders.totalAmount` + gratuity === tab `amount`.
 */
export const getPaymentsLedgerByRestaurant = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		from: v.optional(v.number()),
		to: v.optional(v.number()),
	},
	handler: async function (ctx, args) {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, accessError] = await requireRestaurantStaffAccess(ctx, userId, args.restaurantId);
		if (accessError) return [null, accessError];

		const inWindow = (t: number | undefined): t is number => {
			if (t === undefined) return false;
			if (args.from && t < args.from) return false;
			if (args.to && t > args.to) return false;
			return true;
		};

		const allOrders = await ctx.db
			.query(TABLE.ORDERS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		const paidOrders = allOrders.filter((o) => inWindow(o.paidAt));

		const ordersWithItems = await Promise.all(
			paidOrders.map(async (order) => {
				const items = await ctx.db
					.query(TABLE.ORDER_ITEMS)
					.withIndex("by_order", (q) => q.eq("orderId", order._id))
					.collect();
				const table = await ctx.db.get(order.tableId);
				const payment = order.activePaymentId ? await ctx.db.get(order.activePaymentId) : null;
				return { order, items, tableNumber: table?.tableNumber ?? 0, payment };
			})
		);

		const allItems = ordersWithItems.flatMap((o) => o.items);
		const { menuItemTranslations, optionTranslations, optionGroupTranslations } =
			await loadOrderItemTranslations(ctx, allItems);

		const succeededPayments = (
			await ctx.db
				.query(TABLE.PAYMENTS)
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
				.collect()
		).filter((p) => p.status === PAYMENT_STATUS.SUCCEEDED);

		// Accepted substitutions charge their delta (+ fee on delta) on a separate
		// PaymentIntent carrying the same `orderId`. The food value is already in
		// `orders.totalAmount`; only the fee and the charge have to be folded back
		// in here, or a substituted order reports full food against a submit-time
		// fee that no longer covers it.
		const substitutionPaymentsByOrder = new Map<string, Doc<"payments">[]>();
		for (const payment of succeededPayments) {
			if (payment.kind !== PAYMENT_KIND.SUBSTITUTION || !payment.orderId) continue;
			const key = payment.orderId as string;
			const bucket = substitutionPaymentsByOrder.get(key);
			if (bucket) bucket.push(payment);
			else substitutionPaymentsByOrder.set(key, [payment]);
		}

		const orderRows = ordersWithItems.map(({ order, items, tableNumber, payment }) => {
			// Only a payment for THIS order may put money on this row — a tab
			// payment is stamped on every order it covers (see the header note).
			const ownPayment = payment?.orderId === order._id ? payment : null;
			const money =
				ownPayment && ownPayment.status === PAYMENT_STATUS.SUCCEEDED
					? paymentMoneyBreakdown(ownPayment)
					: null;
			const substitutionMoney = (substitutionPaymentsByOrder.get(order._id as string) ?? []).map(
				paymentMoneyBreakdown
			);
			const substitutionFeeCents = substitutionMoney.reduce(
				(sum, m) => sum + (m.serviceFee ?? 0),
				0
			);
			const substitutionChargedCents = substitutionMoney.reduce(
				(sum, m) => sum + m.chargedToDiner,
				0
			);
			// A cash order never went through Stripe, so no service fee was
			// charged and the restaurant keeps the whole subtotal — a known zero,
			// not the "we never recorded it" null of a pre-pivot tab payment.
			const baseServiceFeeCents = isCashSettledOrder(order) ? 0 : (money?.serviceFee ?? null);
			const serviceFeeCents =
				baseServiceFeeCents === null ? null : baseServiceFeeCents + substitutionFeeCents;
			const tipCents = money?.tip ?? 0;
			return {
				id: order._id as string,
				rowKind: PAYMENT_KIND.ORDER,
				dailyOrderNumber: order.dailyOrderNumber ?? null,
				paidAt: order.paidAt ?? null,
				tableNumber,
				settledBy: order.settledBy ?? null,
				subtotalCents: order.totalAmount,
				serviceFeeCents,
				tipCents,
				chargedCents: (money?.chargedToDiner ?? order.totalAmount) + substitutionChargedCents,
				netToRestaurantCents: serviceFeeCents === null ? null : order.totalAmount + tipCents,
				items: items.map((item) => ({
					...item,
					menuItemTranslations: menuItemTranslations.get(item.menuItemId),
					selectedOptions: item.selectedOptions.map((selected) => ({
						...selected,
						optionTranslations: optionTranslations.get(selected.optionId),
						optionGroupTranslations: optionGroupTranslations.get(selected.optionGroupId),
					})),
				})),
			};
		});

		// Two shapes produce a tip row: an ADR 008 post-visit tip payment (the
		// whole row is the tip), and a pre-pivot TAB settlement, whose gratuity
		// rode along with the food. The tab's food is already reported by the
		// order rows it covers, so its tip row carries the gratuity ONLY — the
		// two together add up to the tab charge, and neither counts the other's
		// money. A pre-pivot per-ORDER payment is not in here: its gratuity is
		// reported on its own order row, which would otherwise double-count.
		const tipPayments = succeededPayments.filter((p) => {
			if (!inWindow(p.succeededAt)) return false;
			if (p.kind === PAYMENT_KIND.TIP) return true;
			const isLegacyTabPayment = p.kind === undefined && p.orderId === undefined && !!p.sessionId;
			return isLegacyTabPayment && (p.gratuityAmount ?? 0) > 0;
		});

		const tipRows = await Promise.all(
			tipPayments.map(async (payment) => {
				const session = payment.sessionId ? await ctx.db.get(payment.sessionId) : null;
				const table = session?.tableId ? await ctx.db.get(session.tableId) : null;
				const money = paymentMoneyBreakdown(payment);
				const isTipPayment = payment.kind === PAYMENT_KIND.TIP;
				return {
					id: payment._id as string,
					rowKind: PAYMENT_KIND.TIP,
					dailyOrderNumber: null,
					paidAt: payment.succeededAt ?? payment.createdAt,
					tableNumber: table?.tableNumber ?? 0,
					settledBy: SETTLED_BY.STRIPE as string | null,
					subtotalCents: 0,
					// Legacy tab: `serviceFee`/`netToRestaurant` are null — the
					// commission Stripe carved out was never recorded on our side.
					serviceFeeCents: money.serviceFee,
					tipCents: money.tip,
					// The tip slice of the charge, not the whole tab: the covered
					// orders report the rest.
					chargedCents: isTipPayment ? money.chargedToDiner : money.tip,
					netToRestaurantCents: money.netToRestaurant,
					items: [] as (typeof orderRows)[number]["items"],
				};
			})
		);

		const rows = [...orderRows, ...tipRows].sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));

		return [rows, null];
	},
});

/**
 * Internal export query: returns denormalized order rows for a given calendar
 * year bucketed by `orderServiceDateKey` (the business-day key, which is
 * already timezone-aware). Orders without a service-date key (drafts /
 * never-paid) are excluded — by design, exports are for finalized business
 * data only.
 */
export const internalListOrdersForExportYear = internalQuery({
	args: {
		actingUserId: v.string(),
		restaurantId: v.id(TABLE.RESTAURANTS),
		year: v.number(),
	},
	handler: async (ctx, args) => {
		const [restaurant, aerr] = await requireRestaurantManagerOrAbove(
			ctx,
			args.actingUserId,
			args.restaurantId
		);
		if (aerr) throw new Error("Unauthorized");

		const yearPrefix = `${args.year}-`;
		const orders = await ctx.db
			.query(TABLE.ORDERS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		// Cash orders (`markOrderPaidInPerson`) never go through `confirmPayment`,
		// so they carry no `orderServiceDateKey` — without a fallback they would
		// be silently missing from the export even though they are paid revenue.
		// The key is derived exactly the way `confirmPayment` would have.
		const serviceDateKeyOf = (order: Doc<"orders">): string | undefined =>
			order.orderServiceDateKey ??
			(order.paidAt !== undefined
				? getOrderServiceDateKey(
						order.paidAt,
						restaurant.timezone,
						restaurant.orderDayStartMinutesFromMidnight
					)
				: undefined);

		const filtered = orders.filter((o) => serviceDateKeyOf(o)?.startsWith(yearPrefix));

		const tableNumberCache = new Map<string, number>();
		const memberEmailCache = new Map<string, string>();

		const denormRows = await Promise.all(
			filtered.map(async (order) => {
				let tableNumber: number | null = null;
				if (tableNumberCache.has(order.tableId)) {
					tableNumber = tableNumberCache.get(order.tableId) ?? null;
				} else {
					const table = await ctx.db.get(order.tableId);
					if (table) {
						tableNumber = table.tableNumber;
						tableNumberCache.set(order.tableId, table.tableNumber);
					}
				}

				let serverDisplay = "";
				if (order.attributedMemberId) {
					if (memberEmailCache.has(order.attributedMemberId)) {
						serverDisplay = memberEmailCache.get(order.attributedMemberId) ?? "";
					} else {
						const member = await ctx.db.get(order.attributedMemberId);
						if (member) {
							const memberUserId = member.userId;
							if (memberUserId) {
								const userRole = await ctx.db
									.query(TABLE.USER_ROLES)
									.withIndex("by_user", (q) => q.eq("userId", memberUserId))
									.first();
								serverDisplay = userRole?.email ?? memberUserId;
							} else {
								serverDisplay = member.employeeAccountId ? String(member.employeeAccountId) : "—";
							}
						}
						memberEmailCache.set(order.attributedMemberId, serverDisplay);
					}
				}

				const items = await ctx.db
					.query(TABLE.ORDER_ITEMS)
					.withIndex("by_order", (q) => q.eq("orderId", order._id))
					.collect();

				const ITEM_PREVIEW_LIMIT = 5;
				// 86'd lines stay in the export, flagged: the diner ordered them and
				// may ask about them, but `totalAmountCents` already excludes them.
				const preview = items
					.slice(0, ITEM_PREVIEW_LIMIT)
					.map(
						(it) =>
							`${it.quantity}× ${it.menuItemName}${it.cancelledAt !== undefined ? " (cancelled)" : ""}`
					);
				const remaining = items.length - preview.length;
				const itemsSummary =
					remaining > 0 ? `${preview.join(", ")}, +${remaining} more` : preview.join(", ");

				return {
					id: order._id as string,
					orderServiceDateKey: serviceDateKeyOf(order) ?? "",
					dailyOrderNumber: order.dailyOrderNumber ?? null,
					tableNumber,
					status: order.status,
					paymentState: order.paymentState ?? "",
					/** "stripe" | "staff" — "staff" is a cash order with no payments row. */
					settledBy: order.settledBy ?? "",
					submittedAt: order.submittedAt ?? null,
					paidAt: order.paidAt ?? null,
					serverDisplay,
					itemsSummary,
					totalAmountCents: order.totalAmount,
					specialInstructions: order.specialInstructions ?? "",
				};
			})
		);

		return denormRows;
	},
});
