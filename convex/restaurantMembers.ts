import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
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
import { appendAuditEvent, stampUpdated } from "./_util/audit";
import {
	fetchUserRoleRecord,
	fetchUserRoleRecordsByUserId,
	getCurrentUserId,
	getRestaurantMembership,
	isAdmin,
	isRestaurantDocumentOwner,
	requireRestaurantManagerOrAbove,
	requireRestaurantOwnerOrAdmin,
	RoleErrorMessages,
} from "./_util/auth";
import {
	AUDIT_SYSTEM_USER_ID,
	INVITATION_STATUS,
	RESTAURANT_MEMBER_ROLE,
	TABLE,
	USER_ROLES,
} from "./constants";
import { assertCanManageInvitation } from "./invites";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

function orgIdString(organizationId: Id<"organizations">): string {
	return String(organizationId);
}

function unionRolesFromRows(rows: Doc<"userRoles">[]): Set<string> {
	const s = new Set<string>();
	for (const r of rows) {
		for (const role of r.roles ?? []) {
			s.add(role);
		}
	}
	return s;
}

function hasStaffRoleInUnion(union: Set<string>): boolean {
	return (
		union.has(USER_ROLES.OWNER) ||
		union.has(USER_ROLES.MANAGER) ||
		union.has(USER_ROLES.EMPLOYEE)
	);
}

function isOnlyAdminOrCustomer(union: Set<string>): boolean {
	if (union.size === 0) return false;
	for (const r of union) {
		if (r !== USER_ROLES.ADMIN && r !== USER_ROLES.CUSTOMER) {
			return false;
		}
	}
	return true;
}

function isOrgOwnerForRestaurantFromRows(
	rows: Doc<"userRoles">[],
	organizationId: Id<"organizations">
): boolean {
	const need = orgIdString(organizationId);
	return rows.some(
		(r) =>
			(r.roles ?? []).includes(USER_ROLES.OWNER) &&
			r.organizationId != null &&
			r.organizationId === need
	);
}

function mergeUserRoleRowsIntoMap(
	into: Map<string, { email: string | null; rows: Doc<"userRoles">[] }>,
	rows: Doc<"userRoles">[]
) {
	for (const r of rows) {
		const cur = into.get(r.userId) ?? { email: null as string | null, rows: [] as Doc<"userRoles">[] };
		cur.rows.push(r);
		if (r.email && !cur.email) {
			cur.email = r.email;
		}
		into.set(r.userId, cur);
	}
}

/** Hide member rows for platform identities that are only admin/customer (no staff roles, not doc owner, not org owner). */
function shouldExcludeMemberFromDirectory(args: {
	restaurant: Doc<"restaurants">;
	userId: string;
	roleRowsForUser: Doc<"userRoles">[];
}): boolean {
	const { restaurant, userId, roleRowsForUser } = args;
	if (isRestaurantDocumentOwner(restaurant, userId)) {
		return false;
	}
	if (isOrgOwnerForRestaurantFromRows(roleRowsForUser, restaurant.organizationId)) {
		return false;
	}
	const union = unionRolesFromRows(roleRowsForUser);
	if (hasStaffRoleInUnion(union)) {
		return false;
	}
	if (union.size === 0) {
		return false;
	}
	return isOnlyAdminOrCustomer(union);
}

async function assertCanManageMembership(
	ctx: { db: import("./_generated/server").MutationCtx["db"] },
	actorUserId: string,
	args: {
		organizationId: Id<"organizations">;
		targetRole: typeof RESTAURANT_MEMBER_ROLE.MANAGER | typeof RESTAURANT_MEMBER_ROLE.EMPLOYEE;
		restaurantId: Id<"restaurants">;
	}
): AsyncReturn<null, NotAuthorizedErrorObject> {
	if (await isAdmin(ctx, actorUserId)) {
		return [null, null];
	}

	const restaurantRow = await ctx.db.get(args.restaurantId);
	if (restaurantRow && isRestaurantDocumentOwner(restaurantRow, actorUserId)) {
		return [null, null];
	}

	const ur = await fetchUserRoleRecord(ctx, actorUserId);
	const roles = ur?.roles ?? [];

	if (roles.includes(USER_ROLES.OWNER) && ur?.organizationId === args.organizationId) {
		return [null, null];
	}

	if (args.targetRole === RESTAURANT_MEMBER_ROLE.EMPLOYEE) {
		const member = await getRestaurantMembership(ctx, actorUserId, args.restaurantId);
		if (member?.isActive && member.role === RESTAURANT_MEMBER_ROLE.MANAGER) {
			return [null, null];
		}
	}

	return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
}

export const listByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const [, accessErr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (accessErr) return [null, accessErr];

		const rows = await ctx.db
			.query(TABLE.RESTAURANT_MEMBERS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		return [rows, null];
	},
});

/** Org user directory for manager assignment (admin or org owner for this restaurant's org). */
export const listOrganizationUsersForRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const [restaurant, accessErr] = await requireRestaurantOwnerOrAdmin(
			ctx,
			userId,
			args.restaurantId
		);
		if (accessErr) return [null, accessErr];

		const userRoleRows = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_organizationId", (q) =>
				q.eq("organizationId", restaurant.organizationId)
			)
			.collect();

		const items = userRoleRows.map((r) => ({
			userId: r.userId,
			email: r.email ?? null,
		}));

		return [items, null];
	},
});

export const listTeamDirectory = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const [restaurant, accessErr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (accessErr) return [null, accessErr];

		const members = await ctx.db
			.query(TABLE.RESTAURANT_MEMBERS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		const orgUserRoles = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_organizationId", (q) =>
				q.eq("organizationId", restaurant.organizationId)
			)
			.collect();

		const roleRowsByUser = new Map<string, { email: string | null; rows: Doc<"userRoles">[] }>();
		mergeUserRoleRowsIntoMap(roleRowsByUser, orgUserRoles);

		const ensureUserRoleRows = async (uid: string) => {
			if (!roleRowsByUser.has(uid)) {
				const rows = await fetchUserRoleRecordsByUserId(ctx, uid);
				mergeUserRoleRowsIntoMap(roleRowsByUser, rows);
			}
		};

		for (const m of members) {
			await ensureUserRoleRows(m.userId);
		}
		if (restaurant.ownerId) {
			await ensureUserRoleRows(restaurant.ownerId);
		}

		const invitations = await ctx.db
			.query(TABLE.INVITATIONS)
			.withIndex("by_organization", (q) => q.eq("organizationId", restaurant.organizationId))
			.collect();

		const pending = invitations.filter((inv) => inv.status === INVITATION_STATUS.PENDING);

		const inviteRows: Array<{
			rowType: "invite";
			_id: (typeof pending)[number]["_id"];
			email: string;
			role: (typeof pending)[number]["role"];
		}> = [];

		for (const inv of pending) {
			const touchesRestaurant =
				inv.restaurantIds.includes(args.restaurantId) ||
				(inv.role === USER_ROLES.OWNER && inv.restaurantIds.length === 0);
			if (!touchesRestaurant) continue;

			const [, manageErr] = await assertCanManageInvitation(ctx, userId, inv);
			if (manageErr) continue;

			inviteRows.push({
				rowType: "invite",
				_id: inv._id,
				email: inv.email,
				role: inv.role,
			});
		}

		const memberRows: Array<{
			rowType: "member";
			_id: Id<"restaurantMembers">;
			userId: string;
			role: Doc<"restaurantMembers">["role"];
			isActive: boolean;
			email: string | null;
		}> = [];

		const listedMemberUserIds = new Set<string>();

		for (const m of members) {
			const pack = roleRowsByUser.get(m.userId);
			memberRows.push({
				rowType: "member",
				_id: m._id,
				userId: m.userId,
				role: m.role,
				isActive: m.isActive,
				email: pack?.email ?? null,
			});
			listedMemberUserIds.add(m.userId);
		}

		const syntheticRows: Array<
			| {
					rowType: "restaurantOwner";
					userId: string;
					role: typeof USER_ROLES.OWNER;
					isActive: true;
					email: string | null;
			  }
			| {
					rowType: "orgOwner";
					userId: string;
					role: typeof USER_ROLES.OWNER;
					isActive: true;
					email: string | null;
			  }
		> = [];

		const ownerId = restaurant.ownerId;
		if (ownerId && !listedMemberUserIds.has(ownerId)) {
			const pack = roleRowsByUser.get(ownerId);
			const roleRowsForUser = pack?.rows ?? [];
			if (
				!shouldExcludeMemberFromDirectory({
					restaurant,
					userId: ownerId,
					roleRowsForUser,
				})
			) {
				syntheticRows.push({
					rowType: "restaurantOwner",
					userId: ownerId,
					role: USER_ROLES.OWNER,
					isActive: true,
					email: pack?.email ?? null,
				});
				listedMemberUserIds.add(ownerId);
			}
		}

		const orgIdStr = orgIdString(restaurant.organizationId);
		for (const r of orgUserRoles) {
			if (!(r.roles ?? []).includes(USER_ROLES.OWNER)) continue;
			if (r.organizationId !== orgIdStr) continue;
			if (listedMemberUserIds.has(r.userId)) continue;
			const pack = roleRowsByUser.get(r.userId);
			const roleRowsForUser = pack?.rows ?? [];
			if (
				shouldExcludeMemberFromDirectory({
					restaurant,
					userId: r.userId,
					roleRowsForUser,
				})
			) {
				continue;
			}
			syntheticRows.push({
				rowType: "orgOwner",
				userId: r.userId,
				role: USER_ROLES.OWNER,
				isActive: true,
				email: pack?.email ?? null,
			});
			listedMemberUserIds.add(r.userId);
		}

		const directorySortKey = (
			row:
				| (typeof memberRows)[number]
				| (typeof syntheticRows)[number]
				| (typeof inviteRows)[number]
		) => {
			if (row.rowType === "invite") return row.email;
			const email = "email" in row ? row.email : null;
			return email ?? row.userId;
		};

		const combined = [...memberRows, ...syntheticRows, ...inviteRows].sort((a, b) =>
			directorySortKey(a).localeCompare(directorySortKey(b), undefined, { sensitivity: "base" })
		);

		return [combined, null];
	},
});

export const listByUser = query({
	args: { userId: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const [actorId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const targetUserId = args.userId ?? actorId;

		if (targetUserId !== actorId && !(await isAdmin(ctx, actorId))) {
			return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
		}

		const rows = await ctx.db
			.query(TABLE.RESTAURANT_MEMBERS)
			.withIndex("by_user", (q) => q.eq("userId", targetUserId))
			.collect();

		return [rows, null];
	},
});

export const addMember = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		userId: v.string(),
		role: v.union(
			v.literal(RESTAURANT_MEMBER_ROLE.MANAGER),
			v.literal(RESTAURANT_MEMBER_ROLE.EMPLOYEE)
		),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"restaurantMembers">, AuthErrors | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [actorId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return [null, new NotFoundError("Restaurant not found").toObject()];

		const [, permErr] = await assertCanManageMembership(ctx, actorId, {
			organizationId: restaurant.organizationId,
			targetRole: args.role,
			restaurantId: args.restaurantId,
		});
		if (permErr) return [null, permErr];

		const existing = await ctx.db
			.query(TABLE.RESTAURANT_MEMBERS)
			.withIndex("by_restaurant_user", (q) =>
				q.eq("restaurantId", args.restaurantId).eq("userId", args.userId)
			)
			.first();

		if (existing) {
			if (existing.isActive) {
				return [
					null,
					new UserInputValidationError({
						fields: [
							{ field: "userId", message: "User already has membership at this restaurant" },
						],
					}).toObject(),
				];
			}

			await ctx.db.patch(existing._id, {
				isActive: true,
				role: args.role,
				...stampUpdated(actorId),
			});

			await appendAuditEvent(ctx, {
				aggregateType: TABLE.RESTAURANT_MEMBERS,
				aggregateId: existing._id,
				eventType: "restaurantMembers.reactivated",
				payload: { restaurantId: args.restaurantId, userId: args.userId, role: args.role },
				userId: actorId,
			});

			return [existing._id, null];
		}

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.RESTAURANT_MEMBERS, {
			userId: args.userId,
			restaurantId: args.restaurantId,
			organizationId: restaurant.organizationId,
			role: args.role,
			isActive: true,
			addedBy: actorId,
			createdAt: now,
			updatedAt: now,
			updatedBy: actorId,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANT_MEMBERS,
			aggregateId: id,
			eventType: "restaurantMembers.created",
			payload: { restaurantId: args.restaurantId, userId: args.userId, role: args.role },
			userId: actorId,
		});

		return [id, null];
	},
});

export const updateRole = mutation({
	args: {
		memberId: v.id(TABLE.RESTAURANT_MEMBERS),
		role: v.union(
			v.literal(RESTAURANT_MEMBER_ROLE.MANAGER),
			v.literal(RESTAURANT_MEMBER_ROLE.EMPLOYEE)
		),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"restaurantMembers">, AuthErrors | NotFoundErrorObject> {
		const [actorId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const row = await ctx.db.get(args.memberId);
		if (!row) return [null, new NotFoundError("Membership not found").toObject()];

		const [, permErr] = await assertCanManageMembership(ctx, actorId, {
			organizationId: row.organizationId,
			targetRole: args.role,
			restaurantId: row.restaurantId,
		});
		if (permErr) return [null, permErr];

		await ctx.db.patch(args.memberId, {
			role: args.role,
			...stampUpdated(actorId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANT_MEMBERS,
			aggregateId: args.memberId,
			eventType: "restaurantMembers.role_updated",
			payload: { role: args.role },
			userId: actorId,
		});

		return [args.memberId, null];
	},
});

export const removeMember = mutation({
	args: { memberId: v.id(TABLE.RESTAURANT_MEMBERS) },
	handler: async function (ctx, args): AsyncReturn<null, AuthErrors | NotFoundErrorObject> {
		const [actorId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const row = await ctx.db.get(args.memberId);
		if (!row) return [null, new NotFoundError("Membership not found").toObject()];

		const [, permErr] = await assertCanManageMembership(ctx, actorId, {
			organizationId: row.organizationId,
			targetRole: row.role,
			restaurantId: row.restaurantId,
		});
		if (permErr) return [null, permErr];

		await ctx.db.patch(args.memberId, { isActive: false, ...stampUpdated(actorId) });

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANT_MEMBERS,
			aggregateId: args.memberId,
			eventType: "restaurantMembers.deactivated",
			payload: {},
			userId: actorId,
		});

		return [null, null];
	},
});

/** Idempotent backfill from userRoles (internal / admin). */
export const runBackfillRestaurantMembers = mutation({
	args: {},
	handler: async (ctx) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return { ok: false as const, error: err };
		if (!(await isAdmin(ctx, userId))) {
			return {
				ok: false as const,
				error: new NotAuthorizedError(RoleErrorMessages.ADMIN_REQUIRED).toObject(),
			};
		}

		let created = 0;
		const userRoleRows = await ctx.db.query(TABLE.USER_ROLES).collect();

		for (const ur of userRoleRows) {
			const orgId = ur.organizationId;
			if (!orgId) continue;

			const hasManager = ur.roles.includes(USER_ROLES.MANAGER);
			const hasEmployee = ur.roles.includes(USER_ROLES.EMPLOYEE);
			if (!hasManager && !hasEmployee) continue;

			const role = hasManager
				? RESTAURANT_MEMBER_ROLE.MANAGER
				: RESTAURANT_MEMBER_ROLE.EMPLOYEE;

			const restaurants = await ctx.db
				.query(TABLE.RESTAURANTS)
				.withIndex("by_organization", (q) => q.eq("organizationId", orgId as Id<"organizations">))
				.collect();

			for (const r of restaurants) {
				const existing = await ctx.db
					.query(TABLE.RESTAURANT_MEMBERS)
					.withIndex("by_restaurant_user", (q) =>
						q.eq("restaurantId", r._id).eq("userId", ur.userId)
					)
					.first();
				if (existing) continue;

				const now = Date.now();
				await ctx.db.insert(TABLE.RESTAURANT_MEMBERS, {
					userId: ur.userId,
					restaurantId: r._id,
					organizationId: r.organizationId,
					role,
					isActive: true,
					addedBy: AUDIT_SYSTEM_USER_ID,
					createdAt: now,
					updatedAt: now,
					updatedBy: AUDIT_SYSTEM_USER_ID,
				});
				created++;
			}
		}

		return { ok: true as const, created };
	},
});
