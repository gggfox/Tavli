import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { getCurrentUserId, requireAdminRole } from "./_util/auth";
import type { OrganizationDoc } from "./constants";
import { TABLE } from "./constants";

type AdminErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

type MutationErrors = AdminErrors | NotFoundErrorObject | UserInputValidationErrorObject;

export const getAllOrganizations = query({
	handler: async function (ctx): AsyncReturn<OrganizationDoc[], AdminErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [_, error2] = await requireAdminRole(ctx, userId);
		if (error2) return [null, error2];

		const organizations = await ctx.db.query(TABLE.ORGANIZATIONS).collect();
		return [organizations, null];
	},
});

export const getOrganization = query({
	args: { id: v.id(TABLE.ORGANIZATIONS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<OrganizationDoc, AdminErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [_, error2] = await requireAdminRole(ctx, userId);
		if (error2) return [null, error2];

		const org = await ctx.db.get(args.id);
		if (!org) {
			return [null, new NotFoundError("Organization not found").toObject()];
		}
		return [org, null];
	},
});

export const createOrganization = mutation({
	args: {
		name: v.string(),
		slug: v.optional(v.string()),
		description: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<string, MutationErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [_, error2] = await requireAdminRole(ctx, userId);
		if (error2) return [null, error2];

		if (!args.name.trim()) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "name", message: "Organization name is required" }],
				}).toObject(),
			];
		}

		const existing = await ctx.db
			.query(TABLE.ORGANIZATIONS)
			.withIndex("by_name", (q) => q.eq("name", args.name.trim()))
			.first();

		if (existing) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "name", message: "An organization with this name already exists" }],
				}).toObject(),
			];
		}

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.ORGANIZATIONS, {
			name: args.name.trim(),
			slug: args.slug?.trim() || undefined,
			description: args.description?.trim() || undefined,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});

		return [id, null];
	},
});

export const updateOrganization = mutation({
	args: {
		id: v.id(TABLE.ORGANIZATIONS),
		name: v.optional(v.string()),
		slug: v.optional(v.string()),
		description: v.optional(v.string()),
		isActive: v.optional(v.boolean()),
	},
	handler: async function (ctx, args): AsyncReturn<string, MutationErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [_, error2] = await requireAdminRole(ctx, userId);
		if (error2) return [null, error2];

		const org = await ctx.db.get(args.id);
		if (!org) {
			return [null, new NotFoundError("Organization not found").toObject()];
		}

		if (args.name !== undefined && !args.name.trim()) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "name", message: "Organization name is required" }],
				}).toObject(),
			];
		}

		const trimmedName = args.name?.trim();
		if (trimmedName && trimmedName !== org.name) {
			const existing = await ctx.db
				.query(TABLE.ORGANIZATIONS)
				.withIndex("by_name", (q) => q.eq("name", trimmedName))
				.first();

			if (existing) {
				return [
					null,
					new UserInputValidationError({
						fields: [{ field: "name", message: "An organization with this name already exists" }],
					}).toObject(),
				];
			}
		}

		const updates: Record<string, unknown> = { updatedAt: Date.now() };
		if (args.name !== undefined) updates.name = args.name.trim();
		if (args.slug !== undefined) updates.slug = args.slug.trim() || undefined;
		if (args.description !== undefined) updates.description = args.description.trim() || undefined;
		if (args.isActive !== undefined) updates.isActive = args.isActive;

		await ctx.db.patch(args.id, updates);
		return [args.id, null];
	},
});

export const deleteOrganization = mutation({
	args: { id: v.id(TABLE.ORGANIZATIONS) },
	handler: async function (ctx, args): AsyncReturn<null, MutationErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [_, error2] = await requireAdminRole(ctx, userId);
		if (error2) return [null, error2];

		const org = await ctx.db.get(args.id);
		if (!org) {
			return [null, new NotFoundError("Organization not found").toObject()];
		}

		const assignedUsers = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_organizationId", (q) => q.eq("organizationId", args.id))
			.collect();

		if (assignedUsers.length > 0) {
			return [
				null,
				new UserInputValidationError({
					fields: [
						{
							field: "id",
							message: `Cannot delete organization with ${assignedUsers.length} assigned user(s). Reassign them first.`,
						},
					],
				}).toObject(),
			];
		}

		await ctx.db.delete(args.id);
		return [null, null];
	},
});
