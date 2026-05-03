import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
	ABSENCE_REQUEST_STATUS,
	ABSENCE_TYPE,
	RESTAURANT_MEMBER_ROLE,
	USER_ROLES,
} from "../constants";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seedOrgRestaurant(t: ReturnType<typeof convexTest>): Promise<{
	orgId: Id<"organizations">;
	restaurantId: Id<"restaurants">;
}> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const orgId = await ctx.db.insert("organizations", {
			name: "Attendance Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-user",
			organizationId: orgId,
			name: "Attendance R",
			slug: "attendance-r",
			currency: "USD",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		await insertMenuForRestaurant(ctx, {
			restaurantId,
			name: "attendance-r",
			userId: "owner-user",
		});
		return { orgId, restaurantId };
	});
}

async function seedRestaurantMember(
	t: ReturnType<typeof convexTest>,
	args: {
		userId: string;
		restaurantId: Id<"restaurants">;
		organizationId: Id<"organizations">;
		role: typeof RESTAURANT_MEMBER_ROLE.EMPLOYEE | typeof RESTAURANT_MEMBER_ROLE.MANAGER;
	}
) {
	await t.run(async (ctx) => {
		const now = Date.now();
		await ctx.db.insert("restaurantMembers", {
			userId: args.userId,
			restaurantId: args.restaurantId,
			organizationId: args.organizationId,
			role: args.role,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
	});
}

async function seedUserRole(
	t: ReturnType<typeof convexTest>,
	args: { userId: string; roles: string[]; organizationId?: Id<"organizations"> }
) {
	await t.run(async (ctx) => {
		await ctx.db.insert("userRoles", {
			userId: args.userId,
			roles: args.roles as Array<"admin" | "owner" | "manager" | "customer" | "employee">,
			organizationId: args.organizationId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
}

describe("attendance", () => {
	it("listMyAbsencesForRestaurant returns only the caller's rows after requestAbsence", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgRestaurant(t);
		await seedRestaurantMember(t, {
			userId: "emp-a",
			restaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
		});
		await seedRestaurantMember(t, {
			userId: "emp-b",
			restaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
		});

		const authedA = t.withIdentity({ subject: "emp-a" });
		const [absenceId, reqErr] = await authedA.mutation(api.attendance.requestAbsence, {
			restaurantId,
			date: "2026-06-01",
			type: ABSENCE_TYPE.VACATION,
			reason: "Trip",
		});
		expect(reqErr).toBeNull();
		expect(absenceId).toBeTruthy();

		const [listA, errA] = await authedA.query(api.attendance.listMyAbsencesForRestaurant, {
			restaurantId,
		});
		expect(errA).toBeNull();
		const rowsA = listA as Doc<"absences">[] | null;
		expect(rowsA).toHaveLength(1);
		expect(rowsA![0].date).toBe("2026-06-01");
		expect(rowsA![0].type).toBe(ABSENCE_TYPE.VACATION);
		expect(rowsA![0].status).toBe(ABSENCE_REQUEST_STATUS.PENDING);

		const authedB = t.withIdentity({ subject: "emp-b" });
		const [listB, errB] = await authedB.query(api.attendance.listMyAbsencesForRestaurant, {
			restaurantId,
		});
		expect(errB).toBeNull();
		const rowsB = listB as Doc<"absences">[] | null;
		expect(rowsB).toHaveLength(0);
	});

	it("denies listAbsencesForRestaurant to non-manager members", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgRestaurant(t);
		await seedRestaurantMember(t, {
			userId: "emp-only",
			restaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
		});
		const authed = t.withIdentity({ subject: "emp-only" });
		const [rows, err] = await authed.query(api.attendance.listAbsencesForRestaurant, { restaurantId });
		expect(rows).toBeNull();
		expect(err && "name" in err && err.name).toBe("NOT_AUTHORIZED");
	});

	it("allows manager to list all absences including employees", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgRestaurant(t);
		await seedUserRole(t, { userId: "mgr", roles: [USER_ROLES.EMPLOYEE] });
		await seedRestaurantMember(t, {
			userId: "mgr",
			restaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
		});
		await seedRestaurantMember(t, {
			userId: "emp-x",
			restaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
		});

		const authedEmp = t.withIdentity({ subject: "emp-x" });
		await authedEmp.mutation(api.attendance.requestAbsence, {
			restaurantId,
			date: "2026-07-15",
			type: ABSENCE_TYPE.SICK,
		});

		const authedMgr = t.withIdentity({ subject: "mgr" });
		const [all, err] = await authedMgr.query(api.attendance.listAbsencesForRestaurant, { restaurantId });
		expect(err).toBeNull();
		const allRows = all as Doc<"absences">[] | null;
		expect(allRows?.some((a) => a.date === "2026-07-15" && a.type === ABSENCE_TYPE.SICK)).toBe(true);
	});
});
