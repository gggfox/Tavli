import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
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
import { appendAuditEvent, stampUpdated } from "./_util/audit";
import {
	generatePin,
	getCurrentUserId,
	hashPin,
	requireRestaurantManagerOrAbove,
} from "./_util/auth";
import { RESTAURANT_MEMBER_ROLE, TABLE } from "./constants";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;
type CreateResult = { employeeAccountId: Id<"employeeAccounts">; memberId: Id<"restaurantMembers">; pin: string };

export const createEmployeeAccount = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		firstName: v.string(),
		paternalLastname: v.string(),
		maternalLastname: v.string(),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<CreateResult, AuthErrors | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [actorId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const [restaurant, accessErr] = await requireRestaurantManagerOrAbove(ctx, actorId, args.restaurantId);
		if (accessErr) return [null, accessErr];

		if (!args.firstName.trim() || !args.paternalLastname.trim() || !args.maternalLastname.trim()) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "name", message: "All name fields are required" }],
				}).toObject(),
			];
		}

		const pin = generatePin();
		const pinHash = hashPin(pin);
		const now = Date.now();

		const employeeAccountId = await ctx.db.insert(TABLE.EMPLOYEE_ACCOUNTS, {
			restaurantId: args.restaurantId,
			organizationId: restaurant.organizationId,
			firstName: args.firstName.trim(),
			paternalLastname: args.paternalLastname.trim(),
			maternalLastname: args.maternalLastname.trim(),
			pinHash,
			pinSetAt: now,
			pinResetCount: 0,
			failedPinAttempts: 0,
			createdAt: now,
			updatedAt: now,
			updatedBy: actorId,
		});

		const memberId = await ctx.db.insert(TABLE.RESTAURANT_MEMBERS, {
			employeeAccountId,
			restaurantId: args.restaurantId,
			organizationId: restaurant.organizationId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			isActive: true,
			addedBy: actorId,
			createdAt: now,
			updatedAt: now,
			updatedBy: actorId,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.EMPLOYEE_ACCOUNTS,
			aggregateId: employeeAccountId,
			eventType: "employeeAccounts.created",
			payload: {
				restaurantId: args.restaurantId,
				memberId,
				firstName: args.firstName.trim(),
				paternalLastname: args.paternalLastname.trim(),
			},
			userId: actorId,
		});

		return [{ employeeAccountId, memberId, pin }, null];
	},
});

export const updateEmployeeAccount = mutation({
	args: {
		employeeAccountId: v.id(TABLE.EMPLOYEE_ACCOUNTS),
		firstName: v.optional(v.string()),
		paternalLastname: v.optional(v.string()),
		maternalLastname: v.optional(v.string()),
		photoStorageId: v.optional(v.id("_storage")),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"employeeAccounts">, AuthErrors | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [actorId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const account = await ctx.db.get(args.employeeAccountId);
		if (!account || account.removedAt != null) {
			return [null, new NotFoundError("Employee account not found").toObject()];
		}

		const [, accessErr] = await requireRestaurantManagerOrAbove(ctx, actorId, account.restaurantId);
		if (accessErr) return [null, accessErr];

		const patch: Record<string, unknown> = {};
		if (args.firstName !== undefined) {
			if (!args.firstName.trim()) {
				return [null, new UserInputValidationError({ fields: [{ field: "firstName", message: "Required" }] }).toObject()];
			}
			patch.firstName = args.firstName.trim();
		}
		if (args.paternalLastname !== undefined) {
			if (!args.paternalLastname.trim()) {
				return [null, new UserInputValidationError({ fields: [{ field: "paternalLastname", message: "Required" }] }).toObject()];
			}
			patch.paternalLastname = args.paternalLastname.trim();
		}
		if (args.maternalLastname !== undefined) {
			if (!args.maternalLastname.trim()) {
				return [null, new UserInputValidationError({ fields: [{ field: "maternalLastname", message: "Required" }] }).toObject()];
			}
			patch.maternalLastname = args.maternalLastname.trim();
		}
		if (args.photoStorageId !== undefined) {
			patch.photoStorageId = args.photoStorageId;
		}

		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(args.employeeAccountId, {
				...patch,
				...stampUpdated(actorId),
			});
		}

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.EMPLOYEE_ACCOUNTS,
			aggregateId: args.employeeAccountId,
			eventType: "employeeAccounts.updated",
			payload: patch,
			userId: actorId,
		});

		return [args.employeeAccountId, null];
	},
});

export const resetEmployeePin = mutation({
	args: { employeeAccountId: v.id(TABLE.EMPLOYEE_ACCOUNTS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<{ pin: string }, AuthErrors | NotFoundErrorObject> {
		const [actorId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const account = await ctx.db.get(args.employeeAccountId);
		if (!account || account.removedAt != null) {
			return [null, new NotFoundError("Employee account not found").toObject()];
		}

		const [, accessErr] = await requireRestaurantManagerOrAbove(ctx, actorId, account.restaurantId);
		if (accessErr) return [null, accessErr];

		const pin = generatePin();
		const pinHash = hashPin(pin);
		const now = Date.now();

		await ctx.db.patch(args.employeeAccountId, {
			pinHash,
			pinSetAt: now,
			pinResetCount: account.pinResetCount + 1,
			failedPinAttempts: 0,
			lockedUntil: undefined,
			...stampUpdated(actorId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.EMPLOYEE_ACCOUNTS,
			aggregateId: args.employeeAccountId,
			eventType: "employeeAccounts.pinReset",
			payload: { resetCount: account.pinResetCount + 1 },
			userId: actorId,
		});

		return [{ pin }, null];
	},
});

export const removeEmployeeAccount = mutation({
	args: { employeeAccountId: v.id(TABLE.EMPLOYEE_ACCOUNTS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<null, AuthErrors | NotFoundErrorObject> {
		const [actorId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const account = await ctx.db.get(args.employeeAccountId);
		if (!account) {
			return [null, new NotFoundError("Employee account not found").toObject()];
		}
		if (account.removedAt != null) {
			return [null, null];
		}

		const [, accessErr] = await requireRestaurantManagerOrAbove(ctx, actorId, account.restaurantId);
		if (accessErr) return [null, accessErr];

		const now = Date.now();

		await ctx.db.patch(args.employeeAccountId, {
			removedAt: now,
			removedBy: actorId,
			...stampUpdated(actorId),
		});

		const memberRow = await ctx.db
			.query(TABLE.RESTAURANT_MEMBERS)
			.withIndex("by_employee_account", (q) => q.eq("employeeAccountId", args.employeeAccountId))
			.first();

		if (memberRow) {
			await ctx.db.patch(memberRow._id, {
				isActive: false,
				removedAt: now,
				removedBy: actorId,
				...stampUpdated(actorId),
			});
		}

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.EMPLOYEE_ACCOUNTS,
			aggregateId: args.employeeAccountId,
			eventType: "employeeAccounts.removed",
			payload: { memberId: memberRow?._id },
			userId: actorId,
		});

		return [null, null];
	},
});

export const getEmployeePhotoUploadUrl = mutation({
	args: {},
	handler: async (ctx) => {
		const [, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		return [await ctx.storage.generateUploadUrl(), null];
	},
});

export const getByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const [, accessErr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (accessErr) return [null, accessErr];

		const accounts = await ctx.db
			.query(TABLE.EMPLOYEE_ACCOUNTS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		return [accounts.filter((a) => a.removedAt == null), null];
	},
});

export const getById = query({
	args: { employeeAccountId: v.id(TABLE.EMPLOYEE_ACCOUNTS) },
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const account = await ctx.db.get(args.employeeAccountId);
		if (!account || account.removedAt != null) {
			return [null, new NotFoundError("Employee account not found").toObject()];
		}

		const [, accessErr] = await requireRestaurantManagerOrAbove(ctx, userId, account.restaurantId);
		if (accessErr) return [null, accessErr];

		return [account, null];
	},
});
