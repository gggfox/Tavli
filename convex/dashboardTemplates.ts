/**
 * Dashboard templates: per-restaurant published layouts that any staff member
 * may clone into their own layout collection.
 *
 * - `list` is gated by staff access at the restaurant.
 * - `publish` / `update` / `unpublish` require manager-or-above.
 * - `cloneToLayout` writes a new owned `dashboardLayouts` row for the caller;
 *   later edits to the template do NOT propagate to clones.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import {
	getCurrentUserId,
	requireRestaurantManagerOrAbove,
	requireRestaurantStaffAccess,
} from "./_util/auth";
import { TABLE } from "./constants";

type TemplateDoc = Doc<typeof TABLE.DASHBOARD_TEMPLATES>;

const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 280;
const MAX_LAYOUTS_PER_USER = 50;

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

type TemplateAccessErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject;

function validateName(name: string): UserInputValidationErrorObject | null {
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

function validateDescription(
	description: string | undefined
): UserInputValidationErrorObject | null {
	if (description === undefined) return null;
	if (description.length > MAX_DESCRIPTION_LENGTH) {
		return new UserInputValidationError({
			fields: [{ field: "description", message: "ERROR_DASHBOARD_DESCRIPTION_TOO_LONG" }],
		}).toObject();
	}
	return null;
}

/**
 * List templates published for the given restaurant. Any staff member at
 * the restaurant may read.
 */
export const list = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
	},
	handler: async function (ctx, args): AsyncReturn<TemplateDoc[], TemplateAccessErrors> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const [, accessErr] = await requireRestaurantStaffAccess(ctx, userId, args.restaurantId);
		if (accessErr) return [null, accessErr];

		const rows = await ctx.db
			.query(TABLE.DASHBOARD_TEMPLATES)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		rows.sort((a, b) => b.updatedAt - a.updatedAt);
		return [rows, null];
	},
});

/**
 * Publish a new template to the restaurant's gallery. Manager-or-above only.
 */
export const publish = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.string(),
		description: v.optional(v.string()),
		config: configValidator,
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"dashboardTemplates">, TemplateAccessErrors | UserInputValidationErrorObject> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const [, accessErr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (accessErr) return [null, accessErr];

		const nameErr = validateName(args.name);
		if (nameErr) return [null, nameErr];

		const descriptionErr = validateDescription(args.description);
		if (descriptionErr) return [null, descriptionErr];

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.DASHBOARD_TEMPLATES, {
			restaurantId: args.restaurantId,
			publishedBy: userId,
			name: args.name.trim(),
			description: args.description?.trim() || undefined,
			config: args.config,
			createdAt: now,
			updatedAt: now,
		});
		return [id, null];
	},
});

/**
 * Patch an existing template. Manager-or-above at the template's restaurant.
 */
export const update = mutation({
	args: {
		templateId: v.id(TABLE.DASHBOARD_TEMPLATES),
		name: v.optional(v.string()),
		description: v.optional(v.string()),
		config: v.optional(configValidator),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"dashboardTemplates">, TemplateAccessErrors | UserInputValidationErrorObject> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const template = await ctx.db.get(args.templateId);
		if (!template) {
			return [null, new NotFoundError("Template not found").toObject()];
		}

		const [, accessErr] = await requireRestaurantManagerOrAbove(ctx, userId, template.restaurantId);
		if (accessErr) return [null, accessErr];

		const patch: Partial<TemplateDoc> = { updatedAt: Date.now() };
		if (args.name !== undefined) {
			const nameErr = validateName(args.name);
			if (nameErr) return [null, nameErr];
			patch.name = args.name.trim();
		}
		if (args.description !== undefined) {
			const descriptionErr = validateDescription(args.description);
			if (descriptionErr) return [null, descriptionErr];
			patch.description = args.description.trim() || undefined;
		}
		if (args.config !== undefined) {
			patch.config = args.config;
		}

		await ctx.db.patch(args.templateId, patch);
		return [args.templateId, null];
	},
});

/**
 * Remove a published template. Manager-or-above at the template's restaurant.
 * Existing clones are unaffected (clones are independent layouts).
 */
export const unpublish = mutation({
	args: {
		templateId: v.id(TABLE.DASHBOARD_TEMPLATES),
	},
	handler: async function (ctx, args): AsyncReturn<true, TemplateAccessErrors> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const template = await ctx.db.get(args.templateId);
		if (!template) {
			return [null, new NotFoundError("Template not found").toObject()];
		}

		const [, accessErr] = await requireRestaurantManagerOrAbove(ctx, userId, template.restaurantId);
		if (accessErr) return [null, accessErr];

		await ctx.db.delete(args.templateId);
		return [true, null];
	},
});

/**
 * Clone a template into a new restaurant-scoped layout owned by the current
 * user. The clone is independent: later edits to the source template do not
 * propagate. Caller must have staff access at the template's restaurant.
 */
export const cloneToLayout = mutation({
	args: {
		templateId: v.id(TABLE.DASHBOARD_TEMPLATES),
		name: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"dashboardLayouts">, TemplateAccessErrors | UserInputValidationErrorObject> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const template = await ctx.db.get(args.templateId);
		if (!template) {
			return [null, new NotFoundError("Template not found").toObject()];
		}

		const [, accessErr] = await requireRestaurantStaffAccess(ctx, userId, template.restaurantId);
		if (accessErr) return [null, accessErr];

		const requestedName = args.name ?? template.name;
		const nameErr = validateName(requestedName);
		if (nameErr) return [null, nameErr];

		const peers = await ctx.db
			.query(TABLE.DASHBOARD_LAYOUTS)
			.withIndex("by_user_restaurant", (q) =>
				q.eq("userId", userId).eq("restaurantId", template.restaurantId)
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

		const nextPosition = peers.reduce((max, r) => Math.max(max, r.position), -1) + 1;
		const now = Date.now();

		const id = await ctx.db.insert(TABLE.DASHBOARD_LAYOUTS, {
			userId,
			scopeKind: "restaurant",
			restaurantId: template.restaurantId,
			name: requestedName.trim(),
			position: nextPosition,
			config: template.config,
			createdAt: now,
			updatedAt: now,
		});
		return [id, null];
	},
});
