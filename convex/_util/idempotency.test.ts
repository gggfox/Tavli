import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { ERROR_NAMES } from "../_shared/errors";
import { TABLE } from "../constants";
import schema from "../schema";
import { findExistingEventByKeyAndType } from "./idempotency";

const modules = import.meta.glob("../**/*.ts");

describe("findExistingEventByKeyAndType", () => {
	it("returns IDEMPOTENCY_KEY_CONFLICT when multiple events share the same key", async () => {
		const t = convexTest(schema, modules);
		const idempotencyKey = "dup-key";

		await t.run(async (ctx) => {
			const base = {
				eventType: "userRoles.created",
				aggregateType: TABLE.USER_ROLES,
				payload: {},
				userId: "admin",
				timestamp: 1,
				createdAt: 1,
				idempotencyKey,
			};
			await ctx.db.insert("allEvents", { ...base, aggregateId: "role-1" });
			await ctx.db.insert("allEvents", { ...base, aggregateId: "role-2" });
		});

		const [existing, error] = await t.run(async (ctx) =>
			findExistingEventByKeyAndType(ctx, TABLE.USER_ROLES, idempotencyKey)
		);

		expect(existing).toBeNull();
		expect(error?.name).toBe(ERROR_NAMES.IDEMPOTENCY_KEY_CONFLICT);
	});

	it("returns the event when exactly one match exists", async () => {
		const t = convexTest(schema, modules);
		const idempotencyKey = "unique-key";

		await t.run(async (ctx) => {
			await ctx.db.insert("allEvents", {
				eventType: "userRoles.created",
				aggregateType: TABLE.USER_ROLES,
				aggregateId: "role-1",
				payload: {},
				userId: "admin",
				timestamp: 1,
				createdAt: 1,
				idempotencyKey,
			});
		});

		const [existing, error] = await t.run(async (ctx) =>
			findExistingEventByKeyAndType(ctx, TABLE.USER_ROLES, idempotencyKey)
		);

		expect(error).toBeNull();
		expect(existing?.aggregateId).toBe("role-1");
	});
});
