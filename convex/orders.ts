import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { getCurrentUserId, requireOwnerOrStaffRole } from "./_util/auth";
import { TABLE } from "./constants";

type StaffAuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

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
	args: { sessionId: v.id(TABLE.SESSIONS) },
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (session?.status !== "active") {
			throw new NotFoundError("Active session not found");
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
			tableId: session.tableId,
			status: "draft",
			totalAmount: 0,
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

		const optionsTotal = args.selectedOptions.reduce((sum, o) => sum + o.priceModifier, 0);
		const lineTotal = (menuItem.basePrice + optionsTotal) * args.quantity;

		const itemId = await ctx.db.insert(TABLE.ORDER_ITEMS, {
			orderId: args.orderId,
			menuItemId: args.menuItemId,
			menuItemName,
			quantity: args.quantity,
			unitPrice: menuItem.basePrice,
			selectedOptions: args.selectedOptions,
			specialInstructions: args.specialInstructions,
			lineTotal,
			createdAt: Date.now(),
		});

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
		const selectedOptions = args.selectedOptions ?? item.selectedOptions;
		const optionsTotal = selectedOptions.reduce((sum, o) => sum + o.priceModifier, 0);
		const lineTotal = (item.unitPrice + optionsTotal) * quantity;

		await ctx.db.patch(args.orderItemId, {
			...(args.quantity !== undefined && { quantity: args.quantity }),
			...(args.selectedOptions !== undefined && { selectedOptions: args.selectedOptions }),
			...(args.specialInstructions !== undefined && {
				specialInstructions: args.specialInstructions,
			}),
			lineTotal,
		});

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

		const now = Date.now();
		await ctx.db.patch(args.orderId, {
			status: "submitted",
			specialInstructions: args.specialInstructions,
			submittedAt: now,
			updatedAt: now,
		});
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

		return { ...order, items };
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
	preparing: ["ready"],
	ready: ["served"],
	served: ["paid", "cancelled"],
};

export const updateStatus = mutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		newStatus: v.union(
			v.literal("preparing"),
			v.literal("ready"),
			v.literal("served"),
			v.literal("paid"),
			v.literal("cancelled")
		),
	},
	handler: async function (ctx, args): AsyncReturn<string, StaffAuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerOrStaffRole(ctx, userId);
		if (error2) return [null, error2];

		const order = await ctx.db.get(args.orderId);
		if (!order) return [null, new NotFoundError("Order not found").toObject()];

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
			updatedAt: now,
			...(args.newStatus === "paid" && { paidAt: now }),
		});

		return [args.orderId, null];
	},
});

export const getActiveOrdersByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (ctx, args) {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerOrStaffRole(ctx, userId);
		if (error2) return [null, error2];

		const allOrders = await ctx.db
			.query(TABLE.ORDERS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		const activeOrders = allOrders.filter(
			(o) => !["draft", "paid", "cancelled"].includes(o.status)
		);

		const ordersWithItems = await Promise.all(
			activeOrders.map(async (order) => {
				const items = await ctx.db
					.query(TABLE.ORDER_ITEMS)
					.withIndex("by_order", (q) => q.eq("orderId", order._id))
					.collect();
				const table = await ctx.db.get(order.tableId);
				return { ...order, items, tableNumber: table?.tableNumber ?? 0 };
			})
		);

		return [ordersWithItems, null];
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
