/**
 * ADR 007: the audit trail survives the restaurant hard purge, personal data
 * does not. Covers the two halves of that policy:
 *
 * 1. New `employeeAccounts.*` events reference ids only — no name fields.
 * 2. The purge deletes employee accounts (rows + photo blobs) and redacts the
 *    name fields that legacy events wrote into their payloads, while keeping
 *    the events themselves.
 */
import { Blob as NodeBlob } from "node:buffer";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { AUDIT_PAYLOAD_REDACTED, TABLE, USER_ROLES } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

// Keeps the schema's index types on `ctx.db` inside helpers; the bare
// `ReturnType<typeof convexTest>` erases them.
const makeTest = () => convexTest(schema, modules);
type TestT = ReturnType<typeof makeTest>;
type Authed = ReturnType<TestT["withIdentity"]>;

const OWNER = "purge-pii-owner";

async function seedRestaurant(t: TestT, slug: string) {
	const orgId = await t.run(async (ctx) => {
		return await ctx.db.insert("organizations", {
			name: "Purge PII Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	await t.run(async (ctx) => {
		await ctx.db.insert("userRoles", {
			userId: OWNER,
			roles: [USER_ROLES.OWNER],
			organizationId: orgId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});

	const authed = t.withIdentity({ subject: OWNER });
	const [restaurantId] = await authed.mutation(api.restaurants.create, {
		name: "Purge PII Test",
		slug,
		currency: "USD",
		organizationId: orgId,
	});
	return { orgId, restaurantId: restaurantId!, authed };
}

async function createEmployee(authed: Authed, restaurantId: Id<"restaurants">, firstName: string) {
	const [created, err] = await authed.mutation(api.employeeAccounts.createEmployeeAccount, {
		restaurantId,
		firstName,
		paternalLastname: "López",
		maternalLastname: "García",
	});
	expect(err).toBeNull();
	return created!;
}

/** Event shaped like the ones written before ADR 007 removed name fields. */
async function insertLegacyEvent(
	t: TestT,
	args: {
		eventType: string;
		employeeAccountId: Id<"employeeAccounts">;
		payload: unknown;
	}
) {
	await t.run(async (ctx) => {
		const now = Date.now();
		await ctx.db.insert(TABLE.ALL_EVENTS, {
			eventType: args.eventType,
			aggregateType: TABLE.EMPLOYEE_ACCOUNTS,
			aggregateId: args.employeeAccountId,
			payload: args.payload,
			userId: OWNER,
			timestamp: now,
			createdAt: now,
		});
	});
}

async function eventsForAccount(t: TestT, employeeAccountId: Id<"employeeAccounts">) {
	return await t.run(async (ctx) =>
		ctx.db
			.query(TABLE.ALL_EVENTS)
			.withIndex("by_aggregate", (q) =>
				q.eq("aggregateType", TABLE.EMPLOYEE_ACCOUNTS).eq("aggregateId", employeeAccountId)
			)
			.collect()
	);
}

async function softDeleteAndPurge(t: TestT, authed: Authed, restaurantId: Id<"restaurants">) {
	const [, delErr] = await authed.mutation(api.restaurants.softDelete, { restaurantId });
	expect(delErr).toBeNull();
	const result = await t.mutation(internal.restaurantPurge.purgeRestaurantInternal, {
		restaurantId,
	});
	expect(result.purged).toBe(true);
}

describe("restaurant purge: employee-account personal data (ADR 007)", () => {
	it("writes id-only payloads for new employeeAccounts events", async () => {
		const t = makeTest();
		const { restaurantId, authed } = await seedRestaurant(t, "purge-pii-new-events");
		const { employeeAccountId, memberId } = await createEmployee(authed, restaurantId, "Ana");

		const [, updateErr] = await authed.mutation(api.employeeAccounts.updateEmployeeAccount, {
			employeeAccountId,
			firstName: "Anita",
		});
		expect(updateErr).toBeNull();

		const events = await eventsForAccount(t, employeeAccountId);
		const created = events.find((e) => e.eventType === "employeeAccounts.created");
		const updated = events.find((e) => e.eventType === "employeeAccounts.updated");

		expect(created?.payload).toEqual({ restaurantId, memberId });
		expect(updated?.payload).toEqual({ updatedFields: ["firstName"] });
		// Accented names cannot collide with randomly generated id strings.
		for (const name of ["Anita", "López", "García"]) {
			expect(JSON.stringify(events)).not.toContain(name);
		}
	});

	it("deletes employee accounts, members, and the photo blob on purge", async () => {
		const t = makeTest();
		const { restaurantId, authed } = await seedRestaurant(t, "purge-pii-rows");
		const { employeeAccountId } = await createEmployee(authed, restaurantId, "Berta");

		const photoStorageId = await t.run(async (ctx) => {
			// jsdom's Blob lacks arrayBuffer(); node's satisfies convex-test.
			const blob = new NodeBlob(["fake-photo-bytes"]) as unknown as Blob;
			const id = await ctx.storage.store(blob);
			await ctx.db.patch(employeeAccountId, { photoStorageId: id });
			return id;
		});

		await softDeleteAndPurge(t, authed, restaurantId);

		const account = await t.run(async (ctx) => ctx.db.get(employeeAccountId));
		expect(account).toBeNull();

		const members = await t.run(async (ctx) =>
			ctx.db
				.query(TABLE.RESTAURANT_MEMBERS)
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
				.collect()
		);
		expect(members).toHaveLength(0);

		const photoUrl = await t.run(async (ctx) => ctx.storage.getUrl(photoStorageId));
		expect(photoUrl).toBeNull();
	});

	it("redacts name fields from legacy payloads but keeps the events", async () => {
		const t = makeTest();
		const { restaurantId, authed } = await seedRestaurant(t, "purge-pii-redaction");
		const { employeeAccountId, memberId } = await createEmployee(authed, restaurantId, "Carla");

		await insertLegacyEvent(t, {
			eventType: "employeeAccounts.created",
			employeeAccountId,
			payload: {
				restaurantId,
				memberId,
				firstName: "Carla",
				paternalLastname: "Mendoza",
			},
		});
		await insertLegacyEvent(t, {
			eventType: "employeeAccounts.updated",
			employeeAccountId,
			payload: { firstName: "Carlita", maternalLastname: "Ruiz" },
		});

		const [pinReset, pinErr] = await authed.mutation(api.employeeAccounts.resetEmployeePin, {
			employeeAccountId,
		});
		expect(pinErr).toBeNull();
		expect(pinReset?.pin).toBeTruthy();

		await softDeleteAndPurge(t, authed, restaurantId);

		const events = await eventsForAccount(t, employeeAccountId);
		expect(events.length).toBe(4); // clean created + legacy created + legacy updated + pinReset

		const legacyCreated = events.find(
			(e) =>
				e.eventType === "employeeAccounts.created" &&
				(e.payload as Record<string, unknown>).firstName !== undefined
		);
		expect(legacyCreated?.payload).toEqual({
			restaurantId,
			memberId,
			firstName: AUDIT_PAYLOAD_REDACTED,
			paternalLastname: AUDIT_PAYLOAD_REDACTED,
		});
		expect(legacyCreated?.piiRedactedAt).toEqual(expect.any(Number));

		const legacyUpdated = events.find((e) => e.eventType === "employeeAccounts.updated");
		expect(legacyUpdated?.payload).toEqual({
			firstName: AUDIT_PAYLOAD_REDACTED,
			maternalLastname: AUDIT_PAYLOAD_REDACTED,
		});
		expect(legacyUpdated?.piiRedactedAt).toEqual(expect.any(Number));

		// Events that never carried personal data are not rewritten.
		const cleanCreated = events.find(
			(e) =>
				e.eventType === "employeeAccounts.created" &&
				(e.payload as Record<string, unknown>).firstName === undefined
		);
		expect(cleanCreated?.payload).toEqual({ restaurantId, memberId });
		expect(cleanCreated?.piiRedactedAt).toBeUndefined();

		const pinResetEvent = events.find((e) => e.eventType === "employeeAccounts.pinReset");
		expect(pinResetEvent?.payload).toEqual({ resetCount: 1 });
		expect(pinResetEvent?.piiRedactedAt).toBeUndefined();

		for (const name of ["Carla", "Carlita", "Mendoza"]) {
			expect(JSON.stringify(events)).not.toContain(name);
		}
	});

	it("leaves other restaurants' employee events untouched", async () => {
		const t = makeTest();
		const { restaurantId: purgedId, authed } = await seedRestaurant(t, "purge-pii-a");
		const { restaurantId: keptId } = await seedRestaurant(t, "purge-pii-b");

		const purgedEmployee = await createEmployee(authed, purgedId, "Diego");
		const keptEmployee = await createEmployee(authed, keptId, "Rosa");

		await insertLegacyEvent(t, {
			eventType: "employeeAccounts.created",
			employeeAccountId: purgedEmployee.employeeAccountId,
			payload: { restaurantId: purgedId, firstName: "Diego" },
		});
		await insertLegacyEvent(t, {
			eventType: "employeeAccounts.created",
			employeeAccountId: keptEmployee.employeeAccountId,
			payload: { restaurantId: keptId, firstName: "Rosa" },
		});

		await softDeleteAndPurge(t, authed, purgedId);

		const keptAccount = await t.run(async (ctx) => ctx.db.get(keptEmployee.employeeAccountId));
		expect(keptAccount?.firstName).toBe("Rosa");

		const keptEvents = await eventsForAccount(t, keptEmployee.employeeAccountId);
		const keptLegacy = keptEvents.find(
			(e) => (e.payload as Record<string, unknown>).firstName !== undefined
		);
		expect(keptLegacy?.payload).toEqual({ restaurantId: keptId, firstName: "Rosa" });
		expect(keptLegacy?.piiRedactedAt).toBeUndefined();

		const purgedEvents = await eventsForAccount(t, purgedEmployee.employeeAccountId);
		expect(JSON.stringify(purgedEvents)).not.toContain("Diego");
	});
});
