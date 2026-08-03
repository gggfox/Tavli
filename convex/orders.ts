import { v } from "convex/values";
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
	PAYMENT_STATUS,
	PREP_STATION,
	type PrepStation,
	TABLE,
} from "./constants";
import { allocateNextOrderNumber } from "./orderDayCounters";
import { getOrderResetPeriodKey, getOrderServiceDateKey } from "./orderServiceDate";
import { resolveAttributedMemberId } from "./_util/attribution";
import {
	assertPositiveIntegerQuantity,
	DASHBOARD_STATUS_VALIDATOR,
	getApplicableStations,
	invalidateActivePayment,
	loadOrderItemTranslations,
	normalizeSelectedOptions,
	PREP_STATION_VALIDATOR,
	recalculateTotal,
	resolvePrepStation,
	selectedOptionValidator,
	VALID_TRANSITIONS,
} from "./orderHelpers";

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
 * Sends a draft order to the kitchen/bar immediately (TAVLI-6). Payment moved
 * to the end of the visit: the order joins the session's tab balance as
 * `unpaid` and the whole tab is settled with one Stripe payment (or by staff
 * in person). Allocates the daily order number and server attribution here,
 * where the order becomes real for the restaurant.
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
 * Called by the Stripe webhook handler after payment_intent.succeeded.
 * Transitions a draft order to submitted and records payment info.
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
		if (order.totalAmount !== payment.amount) {
			console.warn(
				`Order ${order._id} total ${order.totalAmount} no longer matches payment ${payment.amount}`
			);
			return;
		}
		if (order.status !== "draft" && order.status !== "submitted") {
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

		const order = await ctx.db.get(payment.orderId);
		if (order?.activePaymentId === payment._id && order.status === "draft") {
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

		return {
			...order,
			paymentState: order.paymentState ?? ORDER_PAYMENT_STATE.UNPAID,
			activePayment: toDinerVisiblePayment(activePaymentRaw),
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

/** Used by Stripe actions to enforce diner ownership before payment intent creation. */
export const verifyDraftOrderOwnerInternal = internalQuery({
	args: {
		orderId: v.id(TABLE.ORDERS),
		userId: v.string(),
	},
	returns: v.union(v.id(TABLE.ORDERS), v.null()),
	handler: async (ctx, args) => {
		const order = await ctx.db.get(args.orderId);
		if (!order || order.status !== "draft") return null;
		const session = await ctx.db.get(order.sessionId);
		if (!session || session.status !== "active" || session.userId !== args.userId) {
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

		const [, restaurantError] = await requireRestaurantStaffAccess(ctx, userId, order.restaurantId);
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

		const allowedNext = VALID_TRANSITIONS[order.status];
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

const DEFAULT_DASHBOARD_STATUSES = ["submitted", "preparing", "ready"] as const;

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
	},
	handler: async function (ctx, args) {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, accessError] = await requireRestaurantStaffAccess(ctx, userId, args.restaurantId);
		if (accessError) return [null, accessError];

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
		const filteredOrders = ordersPerStatus.flat();

		const ordersWithItems = await Promise.all(
			filteredOrders.map(async (order) => {
				const items = await ctx.db
					.query(TABLE.ORDER_ITEMS)
					.withIndex("by_order", (q) => q.eq("orderId", order._id))
					.collect();
				const table = await ctx.db.get(order.tableId);
				return { ...order, items, tableNumber: table?.tableNumber ?? 0 };
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

		const [, restaurantError] = await requireRestaurantStaffAccess(ctx, userId, order.restaurantId);
		if (restaurantError) return [null, restaurantError];

		// A station can only mark itself ready while the order is in flight
		// (submitted / preparing). Once "ready"/"served"/"cancelled", the
		// per-station stamp is no longer meaningful.
		if (order.status !== "submitted" && order.status !== "preparing") {
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

		// `order.status` is narrowed to "submitted" | "preparing" by the
		// guard above, so flipping to "ready" is always a forward step
		// here when every applicable station has been stamped.
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

		const [, restaurantError] = await requireRestaurantStaffAccess(ctx, userId, order.restaurantId);
		if (restaurantError) return [null, restaurantError];

		// Once served or cancelled the order has left the stations' hands, and a
		// stamp on a still-`submitted` order is unreachable from the ticket UI.
		if (order.status !== "preparing" && order.status !== "ready") {
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
 * Scope in this version is deliberately the tab flow, where nothing has been
 * charged yet: the line leaves `Order.totalAmount`, so the diner is simply
 * billed less when the tab settles. Once a payment is in flight or settled,
 * returning money needs a partial refund, so 86 refuses and the whole-order
 * cancel-and-refund path stays the tool for that.
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
		if (order.status !== "submitted" && order.status !== "preparing") {
			throw new ConflictError("ERROR_ORDER_ITEM_NOT_CANCELLABLE");
		}

		const paymentState = order.paymentState;
		const isUnpaid =
			paymentState === undefined ||
			paymentState === ORDER_PAYMENT_STATE.UNPAID ||
			paymentState === ORDER_PAYMENT_STATE.FAILED;
		if (!isUnpaid) {
			throw new ConflictError("ERROR_ORDER_ITEM_CANCEL_PAID");
		}

		// A tab locked for payment has a balance snapshot in flight; shifting the
		// total underneath it would charge the diner an amount nobody agreed to.
		const session = await ctx.db.get(order.sessionId);
		if (session?.lockedForPaymentAt !== undefined) {
			throw new ConflictError("ERROR_ORDER_ITEM_CANCEL_TAB_LOCKED");
		}

		const now = Date.now();
		await ctx.db.patch(args.orderItemId, { cancelledAt: now, cancelledBy: userId });
		await recalculateTotal(ctx, item.orderId);

		const remainingItems = (
			await ctx.db
				.query(TABLE.ORDER_ITEMS)
				.withIndex("by_order", (q) => q.eq("orderId", item.orderId))
				.collect()
		).filter((it) => it.cancelledAt === undefined);

		if (remainingItems.length === 0) {
			await ctx.db.patch(item.orderId, {
				status: "cancelled",
				updatedAt: now,
				updatedBy: userId,
			});

			await appendAuditEvent(ctx, {
				aggregateType: TABLE.ORDERS,
				aggregateId: item.orderId,
				eventType: AUDIT_EVENT.ORDER_STATUS_CHANGED,
				restaurantId: order.restaurantId,
				payload: {
					restaurantId: order.restaurantId,
					fromStatus: order.status,
					toStatus: "cancelled",
					// 86 is blocked on paid orders, so there is never money to return.
					refundEligible: false,
					totalAmount: 0,
				},
				userId,
			});

			return [args.orderItemId, null];
		}

		// 86'ing the last line of the one station that had not stamped yet leaves
		// nobody to flip the order — the other stations are already done. Without
		// this the order would sit in "preparing" forever.
		if (order.status === "preparing") {
			const menuItemIds = Array.from(new Set(remainingItems.map((it) => it.menuItemId)));
			const menuItemDocs = await Promise.all(menuItemIds.map((id) => ctx.db.get(id)));
			const menuItemStationMap = new Map<string, PrepStation>();
			for (const doc of menuItemDocs) {
				if (doc) menuItemStationMap.set(doc._id, resolvePrepStation(doc));
			}

			const applicable = getApplicableStations(remainingItems, menuItemStationMap);
			const everyStationDone = Array.from(applicable).every((station) =>
				station === PREP_STATION.KITCHEN
					? order.kitchenReadyAt !== undefined
					: order.barReadyAt !== undefined
			);

			if (everyStationDone) {
				await ctx.db.patch(item.orderId, {
					status: "ready",
					updatedAt: now,
					updatedBy: userId,
				});
			}
		}

		return [args.orderItemId, null];
	},
});

export const getPaidOrdersByRestaurant = query({
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

		const allOrders = await ctx.db
			.query(TABLE.ORDERS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		const paidOrders = allOrders.filter((o) => {
			if (!o.paidAt) return false;
			if (args.from && o.paidAt < args.from) return false;
			if (args.to && o.paidAt > args.to) return false;
			return true;
		});

		const ordersWithItems = await Promise.all(
			paidOrders.map(async (order) => {
				const items = await ctx.db
					.query(TABLE.ORDER_ITEMS)
					.withIndex("by_order", (q) => q.eq("orderId", order._id))
					.collect();
				const table = await ctx.db.get(order.tableId);
				return { ...order, items, tableNumber: table?.tableNumber ?? 0 };
			})
		);

		const allItems = ordersWithItems.flatMap((o) => o.items);
		const { menuItemTranslations, optionTranslations, optionGroupTranslations } =
			await loadOrderItemTranslations(ctx, allItems);

		const enrichedOrders = ordersWithItems
			.map((order) => ({
				...order,
				items: order.items.map((item) => ({
					...item,
					menuItemTranslations: menuItemTranslations.get(item.menuItemId),
					selectedOptions: item.selectedOptions.map((selected) => ({
						...selected,
						optionTranslations: optionTranslations.get(selected.optionId),
						optionGroupTranslations: optionGroupTranslations.get(selected.optionGroupId),
					})),
				})),
			}))
			.sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));

		return [enrichedOrders, null];
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
		const [, aerr] = await requireRestaurantManagerOrAbove(
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

		const filtered = orders.filter((o) => o.orderServiceDateKey?.startsWith(yearPrefix));

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
					orderServiceDateKey: order.orderServiceDateKey ?? "",
					dailyOrderNumber: order.dailyOrderNumber ?? null,
					tableNumber,
					status: order.status,
					paymentState: order.paymentState ?? "",
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
