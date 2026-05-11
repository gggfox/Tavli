/**
 * Dashboard layouts: per-(user, restaurant|portfolio) configurable widget grids.
 *
 * Layouts are personal: only the owner may read or mutate their own layouts;
 * an admin may read any. Restaurant-scoped layouts require active staff
 * membership at that restaurant. Portfolio layouts (no `restaurantId`) require
 * the user to have at least one active restaurant membership in the system.
 *
 * `config.widgets[].options` is opaque on the server (`v.any()`); validation
 * happens via per-widget Zod schemas in the frontend `widgets/registry.ts`.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedError,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import {
	getCurrentUserId,
	isAdmin,
	requireRestaurantStaffAccess,
} from "./_util/auth";
import { TABLE } from "./constants";

type LayoutDoc = Doc<typeof TABLE.DASHBOARD_LAYOUTS>;

const MAX_NAME_LENGTH = 80;
const MAX_LAYOUTS_PER_USER = 50;

const scopeKindValidator = v.union(
	v.literal("restaurant"),
	v.literal("portfolio")
);

const widgetValidator = v.object({
	instanceId: v.string(),
	widgetType: v.string(),
	gridPosition: v.object({
		x: v.number(),
		y: v.number(),
		w: v.number(),
		h: v.number(),
	}),
	options: v.any(),
	dateRangeOverride: v.optional(
		v.object({
			kind: v.string(),
			custom: v.optional(v.object({ from: v.number(), to: v.number() })),
		})
	),
});

const configValidator = v.object({
	globalDateRange: v.string(),
	customRange: v.optional(v.object({ from: v.number(), to: v.number() })),
	compareToPrev: v.boolean(),
	widgets: v.array(widgetValidator),
});

type LayoutAccessErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject;

/**
 * Verify the current user has access to a layout's scope. Restaurant scope
 * requires active staff membership; portfolio scope requires at least one
 * active membership anywhere (admins always pass).
 */
async function assertScopeAccess(
	ctx: { db: import("./_generated/server").DatabaseReader },
	userId: string,
	scopeKind: "restaurant" | "portfolio",
	restaurantId: Id<"restaurants"> | undefined
): AsyncReturn<true, NotAuthorizedErrorObject | NotFoundErrorObject> {
	if (scopeKind === "restaurant") {
		if (!restaurantId) {
			return [
				null,
				new NotAuthorizedError("ERROR_DASHBOARD_RESTAURANT_REQUIRED").toObject(),
			];
		}
		const [, accessErr] = await requireRestaurantStaffAccess(
			ctx,
			userId,
			restaurantId
		);
		if (accessErr) return [null, accessErr];
		return [true, null];
	}

	if (await isAdmin(ctx, userId)) return [true, null];

	const anyMembership = await ctx.db
		.query(TABLE.RESTAURANT_MEMBERS)
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.filter((q) => q.eq(q.field("isActive"), true))
		.first();
	if (anyMembership) return [true, null];

	return [
		null,
		new NotAuthorizedError("ERROR_DASHBOARD_PORTFOLIO_NO_MEMBERSHIP").toObject(),
	];
}

function validateName(
	name: string
): UserInputValidationErrorObject | null {
	const trimmed = name.trim();
	if (!trimmed) {
		return new UserInputValidationError({
			fields: [{ field: "name", message: "ERROR_DASHBOARD_NAME_REQUIRED" }],
		}).toObject();
	}
	if (trimmed.length > MAX_NAME_LENGTH) {
		return new UserInputValidationError({
			fields: [{ field: "name", message: "ERROR_DASHBOARD_NAME_TOO_LONG" }],
		}).toObject();
	}
	return null;
}

/**
 * List the current user's layouts for a given scope. Restaurant scope returns
 * layouts for that restaurant only; portfolio scope returns the user's
 * portfolio layouts (no `restaurantId`).
 */
export const list = query({
	args: {
		scopeKind: scopeKindValidator,
		restaurantId: v.optional(v.id(TABLE.RESTAURANTS)),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<LayoutDoc[], LayoutAccessErrors> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const [, scopeErr] = await assertScopeAccess(
			ctx,
			userId,
			args.scopeKind,
			args.restaurantId
		);
		if (scopeErr) return [null, scopeErr];

		if (args.scopeKind === "restaurant") {
			const rows = await ctx.db
				.query(TABLE.DASHBOARD_LAYOUTS)
				.withIndex("by_user_restaurant", (q) =>
					q.eq("userId", userId).eq("restaurantId", args.restaurantId)
				)
				.collect();
			rows.sort(
				(a, b) =>
					a.position - b.position || a._creationTime - b._creationTime
			);
			return [rows, null];
		}

		const rows = await ctx.db
			.query(TABLE.DASHBOARD_LAYOUTS)
			.withIndex("by_user_scopeKind", (q) =>
				q.eq("userId", userId).eq("scopeKind", "portfolio")
			)
			.collect();
		rows.sort(
			(a, b) => a.position - b.position || a._creationTime - b._creationTime
		);
		return [rows, null];
	},
});

/**
 * Fetch a single layout by id. Owner may read; admins may read any.
 */
export const get = query({
	args: {
		layoutId: v.id(TABLE.DASHBOARD_LAYOUTS),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<LayoutDoc, LayoutAccessErrors> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const layout = await ctx.db.get(args.layoutId);
		if (!layout) {
			return [null, new NotFoundError("Layout not found").toObject()];
		}

		if (layout.userId !== userId && !(await isAdmin(ctx, userId))) {
			return [
				null,
				new NotAuthorizedError("ERROR_DASHBOARD_LAYOUT_NOT_OWNER").toObject(),
			];
		}

		return [layout, null];
	},
});

type CreateErrors =
	| LayoutAccessErrors
	| UserInputValidationErrorObject;

/**
 * Create a new empty layout (or pre-populated via `config`) at the end of the
 * tab list for that scope.
 */
export const create = mutation({
	args: {
		scopeKind: scopeKindValidator,
		restaurantId: v.optional(v.id(TABLE.RESTAURANTS)),
		name: v.string(),
		config: v.optional(configValidator),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"dashboardLayouts">, CreateErrors> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const nameErr = validateName(args.name);
		if (nameErr) return [null, nameErr];

		const [, scopeErr] = await assertScopeAccess(
			ctx,
			userId,
			args.scopeKind,
			args.restaurantId
		);
		if (scopeErr) return [null, scopeErr];

		const existing =
			args.scopeKind === "restaurant"
				? await ctx.db
						.query(TABLE.DASHBOARD_LAYOUTS)
						.withIndex("by_user_restaurant", (q) =>
							q.eq("userId", userId).eq("restaurantId", args.restaurantId)
						)
						.collect()
				: await ctx.db
						.query(TABLE.DASHBOARD_LAYOUTS)
						.withIndex("by_user_scopeKind", (q) =>
							q.eq("userId", userId).eq("scopeKind", "portfolio")
						)
						.collect();

		if (existing.length >= MAX_LAYOUTS_PER_USER) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "layouts", message: "ERROR_DASHBOARD_TOO_MANY_LAYOUTS" }],
				}).toObject(),
			];
		}

		const nextPosition =
			existing.reduce((max, r) => Math.max(max, r.position), -1) + 1;

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.DASHBOARD_LAYOUTS, {
			userId,
			scopeKind: args.scopeKind,
			restaurantId:
				args.scopeKind === "restaurant" ? args.restaurantId : undefined,
			name: args.name.trim(),
			position: nextPosition,
			config: args.config ?? {
				globalDateRange: "week",
				compareToPrev: false,
				widgets: [],
			},
			createdAt: now,
			updatedAt: now,
		});
		return [id, null];
	},
});

type UpdateErrors = LayoutAccessErrors | UserInputValidationErrorObject;

/**
 * Patch an existing layout. Only the owner may update. Pass any subset of
 * `name` / `config` / `position` to update those fields.
 */
export const update = mutation({
	args: {
		layoutId: v.id(TABLE.DASHBOARD_LAYOUTS),
		name: v.optional(v.string()),
		position: v.optional(v.number()),
		config: v.optional(configValidator),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"dashboardLayouts">, UpdateErrors> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const layout = await ctx.db.get(args.layoutId);
		if (!layout) {
			return [null, new NotFoundError("Layout not found").toObject()];
		}
		if (layout.userId !== userId) {
			return [
				null,
				new NotAuthorizedError("ERROR_DASHBOARD_LAYOUT_NOT_OWNER").toObject(),
			];
		}

		const patch: Partial<LayoutDoc> = { updatedAt: Date.now() };
		if (args.name !== undefined) {
			const nameErr = validateName(args.name);
			if (nameErr) return [null, nameErr];
			patch.name = args.name.trim();
		}
		if (args.position !== undefined) {
			patch.position = args.position;
		}
		if (args.config !== undefined) {
			patch.config = args.config;
		}

		await ctx.db.patch(args.layoutId, patch);
		return [args.layoutId, null];
	},
});

/**
 * Reorder layouts by providing the ordered list of layout ids in their
 * desired tab positions. Layouts not included in the list keep their relative
 * order at the end.
 */
export const reorder = mutation({
	args: {
		scopeKind: scopeKindValidator,
		restaurantId: v.optional(v.id(TABLE.RESTAURANTS)),
		orderedIds: v.array(v.id(TABLE.DASHBOARD_LAYOUTS)),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<true, LayoutAccessErrors> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const [, scopeErr] = await assertScopeAccess(
			ctx,
			userId,
			args.scopeKind,
			args.restaurantId
		);
		if (scopeErr) return [null, scopeErr];

		const now = Date.now();
		for (let i = 0; i < args.orderedIds.length; i += 1) {
			const id = args.orderedIds[i];
			const layout = await ctx.db.get(id);
			if (layout?.userId !== userId) continue;
			if (layout.scopeKind !== args.scopeKind) continue;
			if (
				args.scopeKind === "restaurant" &&
				layout.restaurantId !== args.restaurantId
			) {
				continue;
			}
			await ctx.db.patch(id, { position: i, updatedAt: now });
		}
		return [true, null];
	},
});

/**
 * Delete a layout. Only the owner may delete.
 */
export const remove = mutation({
	args: {
		layoutId: v.id(TABLE.DASHBOARD_LAYOUTS),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<true, LayoutAccessErrors> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const layout = await ctx.db.get(args.layoutId);
		if (!layout) {
			return [null, new NotFoundError("Layout not found").toObject()];
		}
		if (layout.userId !== userId) {
			return [
				null,
				new NotAuthorizedError("ERROR_DASHBOARD_LAYOUT_NOT_OWNER").toObject(),
			];
		}

		await ctx.db.delete(args.layoutId);
		return [true, null];
	},
});

/**
 * Duplicate an existing layout. The copy is owned by the current user (so
 * duplicating someone else's layout — e.g. via shared id from an admin —
 * fails unless they own it). The clone is appended at the end and gets
 * `name + " (copy)"` if no `name` is supplied.
 */
export const duplicate = mutation({
	args: {
		layoutId: v.id(TABLE.DASHBOARD_LAYOUTS),
		name: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"dashboardLayouts">, CreateErrors> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const source = await ctx.db.get(args.layoutId);
		if (!source) {
			return [null, new NotFoundError("Layout not found").toObject()];
		}
		if (source.userId !== userId) {
			return [
				null,
				new NotAuthorizedError("ERROR_DASHBOARD_LAYOUT_NOT_OWNER").toObject(),
			];
		}

		const requestedName = args.name ?? `${source.name} (copy)`;
		const nameErr = validateName(requestedName);
		if (nameErr) return [null, nameErr];

		const peers =
			source.scopeKind === "restaurant"
				? await ctx.db
						.query(TABLE.DASHBOARD_LAYOUTS)
						.withIndex("by_user_restaurant", (q) =>
							q.eq("userId", userId).eq("restaurantId", source.restaurantId)
						)
						.collect()
				: await ctx.db
						.query(TABLE.DASHBOARD_LAYOUTS)
						.withIndex("by_user_scopeKind", (q) =>
							q.eq("userId", userId).eq("scopeKind", "portfolio")
						)
						.collect();

		if (peers.length >= MAX_LAYOUTS_PER_USER) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "layouts", message: "ERROR_DASHBOARD_TOO_MANY_LAYOUTS" }],
				}).toObject(),
			];
		}

		const nextPosition =
			peers.reduce((max, r) => Math.max(max, r.position), -1) + 1;

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.DASHBOARD_LAYOUTS, {
			userId,
			scopeKind: source.scopeKind,
			restaurantId: source.restaurantId,
			name: requestedName.trim(),
			position: nextPosition,
			config: source.config,
			createdAt: now,
			updatedAt: now,
		});
		return [id, null];
	},
});
