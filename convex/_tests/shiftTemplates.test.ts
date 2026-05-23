import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, SHIFT_STATUS, USER_ROLES } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

interface SeedOut {
	orgId: Id<"organizations">;
	restaurantId: Id<"restaurants">;
	employeeMember: Id<"restaurantMembers">;
	managerMember: Id<"restaurantMembers">;
}

async function seedTeam(t: ReturnType<typeof convexTest>): Promise<SeedOut> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const orgId = await ctx.db.insert("organizations", {
			name: "Template Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-user",
			organizationId: orgId,
			name: "Template R",
			slug: "template-r",
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
		return { orgId, restaurantId, employeeMember, managerMember };
	});
}

describe("shiftTemplates createShiftTemplate", () => {
	it("eagerly materializes shifts for the rolling horizon", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeMember } = await seedTeam(t);

		const authed = t.withIdentity({ subject: "manager-user" });
		const [templateId, err] = await authed.mutation(api.shiftTemplates.createShiftTemplate, {
			memberId: employeeMember,
			restaurantId,
			dayOfWeek: 0,
			startMinutesFromMidnight: 9 * 60,
			durationMinutes: 8 * 60,
			shiftRole: "server",
			activeFromYmd: "2026-01-01",
		});
		expect(err).toBeNull();
		expect(templateId).toBeTruthy();

		const linked = await t.run(async (ctx) =>
			ctx.db
				.query("shifts")
				.withIndex("by_template", (q) => q.eq("templateId", templateId!))
				.collect()
		);
		expect(linked.length).toBeGreaterThanOrEqual(1);
		for (const row of linked) {
			expect(row.status).toBe(SHIFT_STATUS.SCHEDULED);
			expect(row.shiftRole).toBe("server");
		}
	});

	it("denies a manager creating a template for another manager", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerMember } = await seedTeam(t);

		const authed = t.withIdentity({ subject: "manager-user" });
		const [, err] = await authed.mutation(api.shiftTemplates.createShiftTemplate, {
			memberId: managerMember,
			restaurantId,
			dayOfWeek: 2,
			startMinutesFromMidnight: 8 * 60,
			durationMinutes: 6 * 60,
			activeFromYmd: "2026-01-01",
		});
		expect(err && "name" in err && err.name).toBe("NOT_AUTHORIZED");
	});
});

describe("shiftTemplates materializeAllTemplates", () => {
	it("is idempotent — re-running does not duplicate slots", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeMember } = await seedTeam(t);

		const authed = t.withIdentity({ subject: "manager-user" });
		await authed.mutation(api.shiftTemplates.createShiftTemplate, {
			memberId: employeeMember,
			restaurantId,
			dayOfWeek: 3,
			startMinutesFromMidnight: 10 * 60,
			durationMinutes: 4 * 60,
			activeFromYmd: "2026-01-01",
		});

		const before = await t.run(async (ctx) => ctx.db.query("shifts").collect());
		const beforeCount = before.length;

		await t.mutation(internal.shiftTemplates.materializeAllTemplates, {});
		await t.mutation(internal.shiftTemplates.materializeAllTemplates, {});

		const after = await t.run(async (ctx) => ctx.db.query("shifts").collect());
		expect(after.length).toBe(beforeCount);
	});

	it("does not recreate a slot whose concrete shift was detached", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeMember } = await seedTeam(t);

		const authed = t.withIdentity({ subject: "manager-user" });
		const [templateId] = await authed.mutation(api.shiftTemplates.createShiftTemplate, {
			memberId: employeeMember,
			restaurantId,
			dayOfWeek: 5,
			startMinutesFromMidnight: 14 * 60,
			durationMinutes: 4 * 60,
			activeFromYmd: "2026-01-01",
		});
		expect(templateId).toBeTruthy();

		const linked = await t.run(async (ctx) =>
			ctx.db
				.query("shifts")
				.withIndex("by_template", (q) => q.eq("templateId", templateId!))
				.collect()
		);
		const target = linked[0];
		expect(target).toBeTruthy();

		await authed.mutation(api.shifts.updateShift, {
			shiftId: target._id,
			startsAt: target.startsAt + 60 * 60 * 1000,
			endsAt: target.endsAt + 60 * 60 * 1000,
		});

		const detached = await t.run(async (ctx) => ctx.db.get(target._id));
		expect(detached?.templateId).toBeUndefined();

		await t.mutation(internal.shiftTemplates.materializeAllTemplates, {});

		const all = await t.run(async (ctx) =>
			ctx.db
				.query("shifts")
				.withIndex("by_member_time", (q) => q.eq("memberId", employeeMember))
				.collect()
		);
		const overlapping = all.filter(
			(s) =>
				s.status !== SHIFT_STATUS.CANCELLED &&
				rangesOverlap(s.startsAt, s.endsAt, detached!.startsAt, detached!.endsAt)
		);
		expect(overlapping.length).toBe(1);
	});
});

describe("shiftTemplates deactivateShiftTemplate", () => {
	it("cancels future linked SCHEDULED shifts only — leaves PUBLISHED untouched", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeMember } = await seedTeam(t);

		const authed = t.withIdentity({ subject: "manager-user" });
		const [templateId] = await authed.mutation(api.shiftTemplates.createShiftTemplate, {
			memberId: employeeMember,
			restaurantId,
			dayOfWeek: 4,
			startMinutesFromMidnight: 11 * 60,
			durationMinutes: 6 * 60,
			activeFromYmd: "2026-01-01",
		});

		const linked = await t.run(async (ctx) =>
			ctx.db
				.query("shifts")
				.withIndex("by_template", (q) => q.eq("templateId", templateId!))
				.collect()
		);
		expect(linked.length).toBeGreaterThanOrEqual(1);

		const publishedTarget = linked[0];
		await t.run(async (ctx) => {
			await ctx.db.patch(publishedTarget._id, {
				status: SHIFT_STATUS.PUBLISHED,
				publishedAt: Date.now(),
			});
		});

		const [out, err] = await authed.mutation(api.shiftTemplates.deactivateShiftTemplate, {
			templateId: templateId!,
		});
		expect(err).toBeNull();
		expect(out).toBeTruthy();

		const after = await t.run(async (ctx) =>
			ctx.db
				.query("shifts")
				.withIndex("by_template", (q) => q.eq("templateId", templateId!))
				.collect()
		);
		const stillScheduled = after.filter((s) => s.status === SHIFT_STATUS.SCHEDULED);
		expect(stillScheduled.length).toBe(0);

		const stillPublished = after.find((s) => s._id === publishedTarget._id);
		expect(stillPublished?.status).toBe(SHIFT_STATUS.PUBLISHED);
	});
});

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
	return aStart < bEnd && bStart < aEnd;
}
