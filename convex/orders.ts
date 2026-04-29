import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { getCurrentUserId, requireRestaurantStaffAccess, requireStaffRole } from "./_util/auth";
import { ORDER_PAYMENT_STATE, PAYMENT_STATUS, TABLE } from "./constants";

type StaffAuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

type NormalizedSelectedOption = {
	optionGroupId: Id<"optionGroups">;
	optionGroupName: string;
	optionId: Id<"options">;
	optionName: string;
	priceModifier: number;
};

const selectedOptionValidator = v.object({
	optionGroupId: v.id(TABLE.OPTION_GROUPS),
	optionGroupName: v.string(),
	optionId: v.id(TABLE.OPTIONS),
	optionName: v.string(),
	priceModifier: v.number(),
});

// ============================================================================
// Customer-facing (public, identified by sessionId)
// ============================================================================

export const createDraft = mutation({
	args: {
		sessionId: v.id(TABLE.SESSIONS),
		tableId: v.id(TABLE.TABLES),
	},
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (session?.status !== "active") {
			throw new NotFoundError("Active session not found");
		}

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
		const order = await ctx.db.get(args.orderId);
		if (order?.status !== "draft") {
			throw new NotFoundError("Draft order not found");
		}

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

		const order = await ctx.db.get(item.orderId);
		if (order?.status !== "draft") {
			throw new NotFoundError("Draft order not found");
		}

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

		const order = await ctx.db.get(item.orderId);
		if (order?.status !== "draft") {
			throw new NotFoundError("Draft order not found");
		}

		await ctx.db.delete(args.orderItemId);
		await invalidateActivePayment(ctx, order);
		await recalculateTotal(ctx, item.orderId);
	},
});

export const submitOrder = mutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		specialInstructions: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const order = await ctx.db.get(args.orderId);
		if (order?.status !== "draft") {
			throw new NotFoundError("Draft order not found");
		}

		const items = await ctx.db
			.query(TABLE.ORDER_ITEMS)
			.withIndex("by_order", (q) => q.eq("orderId", args.orderId))
			.collect();

		if (items.length === 0) {
			throw new UserInputValidationError({
				fields: [{ field: "items", message: "Order must have at least one item" }],
			});
		}

		if (args.specialInstructions) {
			await ctx.db.patch(args.orderId, {
				specialInstructions: args.specialInstructions,
				updatedAt: Date.now(),
			});
		}
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
	},
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment) {
			throw new Error(`Payment ${args.paymentId} not found`);
		}
		if (payment.status === PAYMENT_STATUS.SUCCEEDED) {
			return;
		}

		const order = await ctx.db.get(payment.orderId);
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
			console.warn(`Order ${order._id} is in status ${order.status}, skipping payment confirmation`);
			return;
		}

		const items = await ctx.db
			.query(TABLE.ORDER_ITEMS)
			.withIndex("by_order", (q) => q.eq("orderId", payment.orderId))
			.collect();

		if (items.length === 0) {
			throw new Error(`Order ${payment.orderId} has no items`);
		}

		const now = Date.now();
		await ctx.db.patch(payment._id, {
			status: PAYMENT_STATUS.SUCCEEDED,
			stripePaymentIntentId: args.stripePaymentIntentId,
			...(args.stripeChargeId !== undefined && { stripeChargeId: args.stripeChargeId }),
			succeededAt: now,
			updatedAt: now,
		});
		await ctx.db.patch(order._id, {
			status: "submitted",
			paymentState: ORDER_PAYMENT_STATE.PAID,
			stripePaymentIntentId: args.stripePaymentIntentId,
			paidAt: now,
			submittedAt: now,
			updatedAt: now,
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
		if (!payment) return;
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
	},
});

export const getOrderWithItems = query({
	args: { orderId: v.id(TABLE.ORDERS) },
	handler: async (ctx, args) => {
		const order = await ctx.db.get(args.orderId);
		if (!order) return null;

		const items = await ctx.db
			.query(TABLE.ORDER_ITEMS)
			.withIndex("by_order", (q) => q.eq("orderId", args.orderId))
			.collect();

		const activePayment = order.activePaymentId ? await ctx.db.get(order.activePaymentId) : null;

		return {
			...order,
			paymentState: order.paymentState ?? ORDER_PAYMENT_STATE.UNPAID,
			activePayment,
			items,
		};
	},
});

export const getOrdersBySession = query({
	args: { sessionId: v.id(TABLE.SESSIONS) },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.ORDERS)
			.withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
			.collect();
	},
});

// ============================================================================
// Staff-facing (auth required)
// ============================================================================

const VALID_TRANSITIONS: Record<string, string[]> = {
	submitted: ["preparing", "cancelled"],
	preparing: ["ready", "cancelled"],
	ready: ["served", "cancelled"],
	served: ["cancelled"],
};

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
		const [, error2] = await requireStaffRole(ctx, userId);
		if (error2) return [null, error2];

		const order = await ctx.db.get(args.orderId);
		if (!order) return [null, new NotFoundError("Order not found").toObject()];

		const [, restaurantError] = await requireRestaurantStaffAccess(ctx, userId, order.restaurantId);
		if (restaurantError) return [null, restaurantError];

		const allowedNext = VALID_TRANSITIONS[order.status];
		if (!allowedNext?.includes(args.newStatus)) {
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
		await ctx.db.patch(args.orderId, {
			status: args.newStatus,
			...(args.newStatus === "cancelled" &&
				order.paymentState === ORDER_PAYMENT_STATE.PAID && {
					paymentState: ORDER_PAYMENT_STATE.REFUND_REQUESTED,
				}),
			updatedAt: now,
		});

		if (args.newStatus === "cancelled" && order.activePaymentId) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- types regenerate on `convex dev`
			await ctx.scheduler.runAfter(0, (internal as any).stripe.createRefund, {
				paymentId: order.activePaymentId,
			});
		}

		return [args.orderId, null];
	},
});

// Statuses the kitchen dashboard is allowed to surface. `draft` is excluded
// because drafts are pre-submission state and never belong on the dashboard.
const DASHBOARD_STATUS_VALIDATOR = v.union(
	v.literal("submitted"),
	v.literal("preparing"),
	v.literal("ready"),
	v.literal("served"),
	v.literal("cancelled")
);

const DEFAULT_DASHBOARD_STATUSES = ["submitted", "preparing", "ready"] as const;

export const getActiveOrdersByRestaurant = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		// When omitted, defaults to the active set (submitted/preparing/ready)
		// so existing callers keep behaving as before.
		statuses: v.optional(v.array(DASHBOARD_STATUS_VALIDATOR)),
	},
	handler: async function (ctx, args) {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireStaffRole(ctx, userId);
		if (error2) return [null, error2];

		const requestedStatuses =
			args.statuses && args.statuses.length > 0
				? Array.from(new Set(args.statuses))
				: [...DEFAULT_DASHBOARD_STATUSES];

		const allOrders = await ctx.db
			.query(TABLE.ORDERS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		const allowed = new Set<string>(requestedStatuses);
		const filteredOrders = allOrders.filter((o) => allowed.has(o.status));

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

		const enrichedOrders = ordersWithItems.map((order) => ({
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
		}));

		return [enrichedOrders, null];
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
		const [, error2] = await requireStaffRole(ctx, userId);
		if (error2) return [null, error2];

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

		const enrichedOrders = ordersWithItems.map((order) => ({
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
		}));

		const totalRevenue = paidOrders.reduce((sum, o) => sum + o.totalAmount, 0);

		return [
			{ orders: enrichedOrders, totalRevenue, orderCount: paidOrders.length },
			null,
		];
	},
});

// ============================================================================
// Helpers
// ============================================================================

async function recalculateTotal(
	ctx: { db: { query: any; patch: any; get: any } },
	orderId: string
) {
	const items = await ctx.db
		.query(TABLE.ORDER_ITEMS)
		.withIndex("by_order", (q: any) => q.eq("orderId", orderId))
		.collect();

	const total = items.reduce((sum: number, item: any) => sum + item.lineTotal, 0);

	await ctx.db.patch(orderId, { totalAmount: total, updatedAt: Date.now() });
}

async function normalizeSelectedOptions(
	ctx: { db: { get: any } },
	restaurantId: Id<"restaurants">,
	selectedOptions: Array<{
		optionGroupId: Id<"optionGroups">;
		optionGroupName: string;
		optionId: Id<"options">;
		optionName: string;
		priceModifier: number;
	}>
): Promise<NormalizedSelectedOption[]> {
	const normalized: NormalizedSelectedOption[] = [];
	for (const selectedOption of selectedOptions) {
		const optionGroup = await ctx.db.get(selectedOption.optionGroupId);
		if (!optionGroup || optionGroup.restaurantId !== restaurantId) {
			throw new NotFoundError("Option group not found");
		}

		const option = await ctx.db.get(selectedOption.optionId);
		if (
			!option ||
			option.restaurantId !== restaurantId ||
			option.optionGroupId !== selectedOption.optionGroupId
		) {
			throw new NotFoundError("Option not found");
		}

		normalized.push({
			optionGroupId: selectedOption.optionGroupId,
			optionGroupName: optionGroup.name,
			optionId: selectedOption.optionId,
			optionName: option.name,
			priceModifier: option.priceModifier,
		});
	}

	return normalized;
}

/**
 * Loads `translations` maps for every menu item / option / option group
 * referenced by the given order items so the kitchen and payments
 * dashboards can localize names without depending on the snapshot being
 * perfect at order-placement time. The snapshot (`menuItemName`,
 * `optionName`, `optionGroupName`) remains the canonical fallback when the
 * source row has been deleted or has no translation.
 *
 * Batches `db.get` calls so the query is O(distinct entities) rather than
 * O(items). Returns three lookup maps; callers apply them when shaping the
 * per-item / per-option output.
 */
async function loadOrderItemTranslations(
	ctx: { db: { get: (id: Id<"menuItems"> | Id<"options"> | Id<"optionGroups">) => Promise<any> } },
	allItems: Array<{
		menuItemId: Id<"menuItems">;
		selectedOptions: Array<{
			optionGroupId: Id<"optionGroups">;
			optionId: Id<"options">;
		}>;
	}>
) {
	const menuItemIds = Array.from(new Set(allItems.map((i) => i.menuItemId)));
	const optionIds = Array.from(
		new Set(allItems.flatMap((i) => i.selectedOptions.map((o) => o.optionId)))
	);
	const optionGroupIds = Array.from(
		new Set(allItems.flatMap((i) => i.selectedOptions.map((o) => o.optionGroupId)))
	);

	const [menuItemDocs, optionDocs, optionGroupDocs] = await Promise.all([
		Promise.all(menuItemIds.map((id) => ctx.db.get(id))),
		Promise.all(optionIds.map((id) => ctx.db.get(id))),
		Promise.all(optionGroupIds.map((id) => ctx.db.get(id))),
	]);

	const menuItemTranslations = new Map<string, Record<string, { name?: string; description?: string }> | undefined>();
	for (const doc of menuItemDocs) {
		if (doc) menuItemTranslations.set(doc._id, doc.translations);
	}

	const optionTranslations = new Map<string, Record<string, { name?: string }> | undefined>();
	for (const doc of optionDocs) {
		if (doc) optionTranslations.set(doc._id, doc.translations);
	}

	const optionGroupTranslations = new Map<string, Record<string, { name?: string }> | undefined>();
	for (const doc of optionGroupDocs) {
		if (doc) optionGroupTranslations.set(doc._id, doc.translations);
	}

	return { menuItemTranslations, optionTranslations, optionGroupTranslations };
}

async function invalidateActivePayment(
	ctx: { db: { get: any; patch: any } },
	order: {
		_id: string;
		activePaymentId?: string;
		paymentState?: string;
		status: string;
	}
) {
	if (!order.activePaymentId || order.status !== "draft") {
		return;
	}

	const payment = await ctx.db.get(order.activePaymentId);
	if (
		payment &&
		payment.status !== PAYMENT_STATUS.SUCCEEDED &&
		payment.status !== PAYMENT_STATUS.SUPERSEDED &&
		payment.status !== PAYMENT_STATUS.CANCELLED
	) {
		await ctx.db.patch(order.activePaymentId, {
			status: PAYMENT_STATUS.SUPERSEDED,
			updatedAt: Date.now(),
		});
	}

	await ctx.db.patch(order._id, {
		paymentState: ORDER_PAYMENT_STATE.UNPAID,
		updatedAt: Date.now(),
	});
}
