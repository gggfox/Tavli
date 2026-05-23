import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, SHIFT_STATUS, USER_ROLES } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface SeedOut {
	orgId: Id<"organizations">;
	restaurantId: Id<"restaurants">;
	managerMember: Id<"restaurantMembers">;
	employeeMember: Id<"restaurantMembers">;
	otherEmployeeMember: Id<"restaurantMembers">;
}

async function seedTeam(t: ReturnType<typeof convexTest>): Promise<SeedOut> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const orgId = await ctx.db.insert("organizations", {
			name: "Shift Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-user",
			organizationId: orgId,
			name: "Shift R",
			slug: "shift-r",
			currency: "USD",
			timezone: "UTC",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("userRoles", {
			userId: "owner-user",
			roles: [USER_ROLES.OWNER],
			organizationId: orgId,
			createdAt: now,
			updatedAt: now,
		});
		const managerMember = await ctx.db.insert("restaurantMembers", {
			userId: "manager-user",
			restaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const employeeMember = await ctx.db.insert("restaurantMembers", {
			userId: "employee-user",
			restaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const otherEmployeeMember = await ctx.db.insert("restaurantMembers", {
			userId: "other-employee-user",
			restaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		return {
			orgId,
			restaurantId,
			managerMember,
			employeeMember,
			otherEmployeeMember,
		};
	});
}

describe("shifts createShift authorization", () => {
	it("allows manager to create a shift for an employee", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeMember } = await seedTeam(t);

		const startsAt = Date.now() + 24 * HOUR;
		const endsAt = startsAt + 8 * HOUR;
		const authed = t.withIdentity({ subject: "manager-user" });
		const [id, err] = await authed.mutation(api.shifts.createShift, {
			memberId: employeeMember,
			restaurantId,
			startsAt,
			endsAt,
			shiftRole: "server",
		});
		expect(err).toBeNull();
		expect(id).toBeTruthy();
	});

	it("denies manager creating a shift for another manager", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerMember, orgId } = await seedTeam(t);

		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("restaurantMembers", {
				userId: "manager-2",
				restaurantId,
				organizationId: orgId,
				role: RESTAURANT_MEMBER_ROLE.MANAGER,
				isActive: true,
				createdAt: now,
				updatedAt: now,
			});
		});
		const startsAt = Date.now() + 24 * HOUR;
		const authed = t.withIdentity({ subject: "manager-user" });
		const [id, err] = await authed.mutation(api.shifts.createShift, {
			memberId: managerMember,
			restaurantId,
			startsAt,
			endsAt: startsAt + 4 * HOUR,
		});
		expect(id).toBeNull();
		expect(err && "name" in err && err.name).toBe("NOT_AUTHORIZED");
	});

	it("allows org owner to create a shift for a manager", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerMember } = await seedTeam(t);

		const startsAt = Date.now() + 24 * HOUR;
		const authed = t.withIdentity({ subject: "owner-user" });
		const [id, err] = await authed.mutation(api.shifts.createShift, {
			memberId: managerMember,
			restaurantId,
			startsAt,
			endsAt: startsAt + 4 * HOUR,
		});
		expect(err).toBeNull();
		expect(id).toBeTruthy();
	});

	it("rejects overlapping shifts for the same member", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeMember } = await seedTeam(t);

		const startsAt = Date.now() + 24 * HOUR;
		const authed = t.withIdentity({ subject: "manager-user" });
		const [, err1] = await authed.mutation(api.shifts.createShift, {
			memberId: employeeMember,
			restaurantId,
			startsAt,
			endsAt: startsAt + 4 * HOUR,
		});
		expect(err1).toBeNull();

		const [id, err2] = await authed.mutation(api.shifts.createShift, {
			memberId: employeeMember,
			restaurantId,
			startsAt: startsAt + HOUR,
			endsAt: startsAt + 5 * HOUR,
		});
		expect(id).toBeNull();
		expect(err2 && "name" in err2 && err2.name).toBe("VALIDATION_ERROR");
	});
});

describe("shifts updateShift", () => {
	it("detaches the shift from its template on edit", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeMember, orgId } = await seedTeam(t);

		const templateId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert("shiftTemplates", {
				memberId: employeeMember,
				restaurantId,
				organizationId: orgId,
				dayOfWeek: 0,
				startMinutesFromMidnight: 9 * 60,
				durationMinutes: 8 * 60,
				activeFromYmd: "2026-01-01",
				isActive: true,
				createdBy: "owner-user",
				createdAt: now,
				updatedAt: now,
			});
		});

		const startsAt = Date.now() + 24 * HOUR;
		const shiftId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert("shifts", {
				memberId: employeeMember,
				restaurantId,
				startsAt,
				endsAt: startsAt + 8 * HOUR,
				status: SHIFT_STATUS.SCHEDULED,
				templateId,
				createdBy: "system",
				createdAt: now,
				updatedAt: now,
			});
		});

		const authed = t.withIdentity({ subject: "manager-user" });
		const [, err] = await authed.mutation(api.shifts.updateShift, {
			shiftId,
			startsAt: startsAt + HOUR,
			endsAt: startsAt + 6 * HOUR,
		});
		expect(err).toBeNull();

		const updated = await t.run(async (ctx) => ctx.db.get(shiftId));
		expect(updated?.templateId).toBeUndefined();
		expect(updated?.startsAt).toBe(startsAt + HOUR);
	});
});

describe("shifts cancelShift", () => {
	it("flips status to cancelled and detaches the template", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeMember, orgId } = await seedTeam(t);

		const templateId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert("shiftTemplates", {
				memberId: employeeMember,
				restaurantId,
				organizationId: orgId,
				dayOfWeek: 1,
				startMinutesFromMidnight: 12 * 60,
				durationMinutes: 4 * 60,
				activeFromYmd: "2026-01-01",
				isActive: true,
				createdBy: "owner-user",
				createdAt: now,
				updatedAt: now,
			});
		});

		const startsAt = Date.now() + 48 * HOUR;
		const shiftId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert("shifts", {
				memberId: employeeMember,
				restaurantId,
				startsAt,
				endsAt: startsAt + 4 * HOUR,
				status: SHIFT_STATUS.SCHEDULED,
				templateId,
				createdBy: "system",
				createdAt: now,
				updatedAt: now,
			});
		});

		const authed = t.withIdentity({ subject: "manager-user" });
		const [, err] = await authed.mutation(api.shifts.cancelShift, { shiftId });
		expect(err).toBeNull();

		const cancelled = await t.run(async (ctx) => ctx.db.get(shiftId));
		expect(cancelled?.status).toBe(SHIFT_STATUS.CANCELLED);
		expect(cancelled?.templateId).toBeUndefined();
	});
});

describe("shifts publishWeek", () => {
	it("flips only SCHEDULED shifts in the requested week to PUBLISHED", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeMember, otherEmployeeMember } = await seedTeam(t);

		const weekStartMs = Date.now() + 24 * HOUR;
		const weekEndMs = weekStartMs + 7 * DAY;

		const ids = await t.run(async (ctx) => {
			const now = Date.now();
			const inWeek = await ctx.db.insert("shifts", {
				memberId: employeeMember,
				restaurantId,
				startsAt: weekStartMs + HOUR,
				endsAt: weekStartMs + 5 * HOUR,
				status: SHIFT_STATUS.SCHEDULED,
				createdBy: "manager-user",
				createdAt: now,
				updatedAt: now,
			});
			const outOfWeek = await ctx.db.insert("shifts", {
				memberId: otherEmployeeMember,
				restaurantId,
				startsAt: weekEndMs + HOUR,
				endsAt: weekEndMs + 5 * HOUR,
				status: SHIFT_STATUS.SCHEDULED,
				createdBy: "manager-user",
				createdAt: now,
				updatedAt: now,
			});
			const alreadyCancelled = await ctx.db.insert("shifts", {
				memberId: employeeMember,
				restaurantId,
				startsAt: weekStartMs + 2 * HOUR,
				endsAt: weekStartMs + 6 * HOUR,
				status: SHIFT_STATUS.CANCELLED,
				createdBy: "manager-user",
				createdAt: now,
				updatedAt: now,
			});
			return { inWeek, outOfWeek, alreadyCancelled };
		});

		const authed = t.withIdentity({ subject: "manager-user" });
		const [result, err] = await authed.mutation(api.shifts.publishWeek, {
			restaurantId,
			weekStartMs,
		});
		expect(err).toBeNull();
		expect(result?.publishedCount).toBe(1);

		const inWeek = await t.run(async (ctx) => ctx.db.get(ids.inWeek));
		const outOfWeek = await t.run(async (ctx) => ctx.db.get(ids.outOfWeek));
		const alreadyCancelled = await t.run(async (ctx) => ctx.db.get(ids.alreadyCancelled));
		expect(inWeek?.status).toBe(SHIFT_STATUS.PUBLISHED);
		expect(outOfWeek?.status).toBe(SHIFT_STATUS.SCHEDULED);
		expect(alreadyCancelled?.status).toBe(SHIFT_STATUS.CANCELLED);
	});
});

describe("shifts listMyShifts", () => {
	it("returns only PUBLISHED shifts for the caller", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeMember, otherEmployeeMember } = await seedTeam(t);

		const fromMs = Date.now() + HOUR;
		const toMs = fromMs + 7 * DAY;

		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("shifts", {
				memberId: employeeMember,
				restaurantId,
				startsAt: fromMs + HOUR,
				endsAt: fromMs + 5 * HOUR,
				status: SHIFT_STATUS.PUBLISHED,
				createdBy: "manager-user",
				createdAt: now,
				updatedAt: now,
			});
			await ctx.db.insert("shifts", {
				memberId: employeeMember,
				restaurantId,
				startsAt: fromMs + 2 * DAY,
				endsAt: fromMs + 2 * DAY + 5 * HOUR,
				status: SHIFT_STATUS.SCHEDULED,
				createdBy: "manager-user",
				createdAt: now,
				updatedAt: now,
			});
			await ctx.db.insert("shifts", {
				memberId: otherEmployeeMember,
				restaurantId,
				startsAt: fromMs + HOUR,
				endsAt: fromMs + 5 * HOUR,
				status: SHIFT_STATUS.PUBLISHED,
				createdBy: "manager-user",
				createdAt: now,
				updatedAt: now,
			});
		});

		const authed = t.withIdentity({ subject: "employee-user" });
		const [rows, err] = await authed.query(api.shifts.listMyShifts, {
			restaurantId,
			fromMs,
			toMs,
		});
		expect(err).toBeNull();
		const list = rows as Doc<"shifts">[] | null;
		expect(list).toHaveLength(1);
		expect(list![0].status).toBe(SHIFT_STATUS.PUBLISHED);
		expect(list![0].memberId).toBe(employeeMember);
	});
});
