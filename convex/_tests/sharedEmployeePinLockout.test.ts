import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { hashPin } from "../_util/auth";
import { PIN_LOCKOUT, RESTAURANT_MEMBER_ROLE, TABLE, USER_ROLES } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const SHARED_SUBJECT = "user_2NNEqL2nrIRdJ1slkLWQabc123";
const KNOWN_PIN = "123456";
const WRONG_PIN = "000000";

async function seedOrganization(t: ReturnType<typeof convexTest>) {
	let organizationId: Id<"organizations">;
	await t.run(async (ctx) => {
		organizationId = await ctx.db.insert("organizations", {
			name: "Test Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return organizationId!;
}

async function seedSharedEmployeeContext(t: ReturnType<typeof convexTest>) {
	const orgId = await seedOrganization(t);
	await t.run(async (ctx) => {
		await ctx.db.insert("userRoles", {
			userId: "owner-pin-test",
			roles: [USER_ROLES.OWNER],
			organizationId: orgId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});

	const owner = t.withIdentity({ subject: "owner-pin-test" });
	const [restaurantId] = await owner.mutation(api.restaurants.create, {
		name: "PIN Lockout Test",
		slug: "pin-lockout-test",
		currency: "USD",
		organizationId: orgId,
	});
	await owner.mutation(api.restaurants.setSharedEmployeeSubject, {
		restaurantId: restaurantId!,
		clerkSubject: SHARED_SUBJECT,
	});

	let employeeAccountId: Id<"employeeAccounts">;
	await t.run(async (ctx) => {
		const now = Date.now();
		employeeAccountId = await ctx.db.insert(TABLE.EMPLOYEE_ACCOUNTS, {
			restaurantId: restaurantId!,
			organizationId: orgId,
			firstName: "Ana",
			paternalLastname: "Lopez",
			maternalLastname: "Garcia",
			pinHash: hashPin(KNOWN_PIN),
			pinSetAt: now,
			pinResetCount: 0,
			failedPinAttempts: 0,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert(TABLE.RESTAURANT_MEMBERS, {
			employeeAccountId,
			restaurantId: restaurantId!,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			isActive: true,
			addedBy: "owner-pin-test",
			createdAt: now,
			updatedAt: now,
		});
	});

	const shared = t.withIdentity({ subject: SHARED_SUBJECT });
	return { restaurantId: restaurantId!, employeeAccountId: employeeAccountId!, shared };
}

async function getAccount(
	t: ReturnType<typeof convexTest>,
	employeeAccountId: Id<"employeeAccounts">
) {
	return t.run(async (ctx) => ctx.db.get(employeeAccountId));
}

describe("sharedEmployee PIN lockout", () => {
	it("increments failedPinAttempts on PIN-gated read mutations", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeAccountId, shared } = await seedSharedEmployeeContext(t);

		const [, err] = await shared.mutation(api.sharedEmployee.getOwnTipsWithPin, {
			restaurantId,
			employeeAccountId,
			pin: WRONG_PIN,
			fromBusinessDate: "2026-01-01",
			toBusinessDate: "2026-01-31",
		});

		expect(err).toMatchObject({ name: "NOT_AUTHORIZED", message: "ERROR_INVALID_PIN" });
		const account = await getAccount(t, employeeAccountId);
		expect(account!.failedPinAttempts).toBe(1);
		expect(account!.lastPinAttemptAt).toBeDefined();
	});

	it("locks the account after max failed attempts on read mutations", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeAccountId, shared } = await seedSharedEmployeeContext(t);

		for (let i = 0; i < PIN_LOCKOUT.MAX_ATTEMPTS; i++) {
			const [, err] = await shared.mutation(api.sharedEmployee.getOwnAttendanceWithPin, {
				restaurantId,
				employeeAccountId,
				pin: WRONG_PIN,
				fromMs: 0,
				toMs: Date.now(),
			});
			expect(err).toMatchObject({ name: "NOT_AUTHORIZED" });
		}

		const account = await getAccount(t, employeeAccountId);
		expect(account!.failedPinAttempts).toBe(PIN_LOCKOUT.MAX_ATTEMPTS);
		expect(account!.lockedUntil).toBeDefined();

		const [, lockedErr] = await shared.mutation(api.sharedEmployee.getOwnScheduleWithPin, {
			restaurantId,
			employeeAccountId,
			pin: KNOWN_PIN,
			fromMs: 0,
			toMs: Date.now(),
		});
		expect(lockedErr).toMatchObject({ name: "NOT_AUTHORIZED", message: "ERROR_PIN_LOCKED" });
	});

	it("clears failure counters after a successful PIN verification", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeAccountId, shared } = await seedSharedEmployeeContext(t);

		await shared.mutation(api.sharedEmployee.getOwnTipsWithPin, {
			restaurantId,
			employeeAccountId,
			pin: WRONG_PIN,
			fromBusinessDate: "2026-01-01",
			toBusinessDate: "2026-01-31",
		});

		const [data, err] = await shared.mutation(api.sharedEmployee.getOwnTipsWithPin, {
			restaurantId,
			employeeAccountId,
			pin: KNOWN_PIN,
			fromBusinessDate: "2026-01-01",
			toBusinessDate: "2026-01-31",
		});

		expect(err).toBeNull();
		expect(data).toEqual({ totalCents: 0, perDay: [] });
		const account = await getAccount(t, employeeAccountId);
		expect(account!.failedPinAttempts).toBe(0);
		expect(account!.lockedUntil).toBeUndefined();
		expect(account!.lastPinAttemptAt).toBeUndefined();
	});

	it("resets attempt count after the lockout window elapses (TAVLI-22)", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeAccountId, shared } = await seedSharedEmployeeContext(t);
		const staleAttemptAt = Date.now() - PIN_LOCKOUT.WINDOW_MS - 1;

		await t.run(async (ctx) => {
			await ctx.db.patch(employeeAccountId, {
				failedPinAttempts: PIN_LOCKOUT.MAX_ATTEMPTS - 1,
				lastPinAttemptAt: staleAttemptAt,
			});
		});

		await shared.mutation(api.sharedEmployee.getOwnTipsWithPin, {
			restaurantId,
			employeeAccountId,
			pin: WRONG_PIN,
			fromBusinessDate: "2026-01-01",
			toBusinessDate: "2026-01-31",
		});

		const account = await getAccount(t, employeeAccountId);
		expect(account!.failedPinAttempts).toBe(1);
		expect(account!.lockedUntil).toBeUndefined();
	});

	it("increments lockout on selfClockInWithPin failures", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeAccountId, shared } = await seedSharedEmployeeContext(t);

		const [, err] = await shared.mutation(api.sharedEmployee.selfClockInWithPin, {
			restaurantId,
			employeeAccountId,
			pin: WRONG_PIN,
		});

		expect(err).toMatchObject({ name: "NOT_AUTHORIZED", message: "ERROR_INVALID_PIN" });
		const account = await getAccount(t, employeeAccountId);
		expect(account!.failedPinAttempts).toBe(1);
	});
});
