import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { TABLE } from "../constants";
import schema from "../schema";
import { consumeRateLimit, evaluateRateLimit, type RateLimitConfig } from "./rateLimit";

const modules = import.meta.glob("../**/*.ts");

describe("evaluateRateLimit (pure)", () => {
	const config: RateLimitConfig = { windowMs: 1000, max: 3 };

	it("opens a fresh window with count 1 when there is no prior state", () => {
		const d = evaluateRateLimit(null, 5_000, config);
		expect(d.allowed).toBe(true);
		expect(d.state).toEqual({ windowStart: 5_000, count: 1 });
		expect(d.retryAfterMs).toBe(0);
	});

	it("increments within an active window while under the cap", () => {
		const d = evaluateRateLimit({ windowStart: 5_000, count: 2 }, 5_500, config);
		expect(d.allowed).toBe(true);
		expect(d.state).toEqual({ windowStart: 5_000, count: 3 });
	});

	it("trips at the cap and leaves the stored counter untouched", () => {
		const prev = { windowStart: 5_000, count: 3 };
		const d = evaluateRateLimit(prev, 5_500, config);
		expect(d.allowed).toBe(false);
		expect(d.state).toEqual(prev);
		// 5000 + 1000 - 5500
		expect(d.retryAfterMs).toBe(500);
	});

	it("rolls over to a fresh window once the previous one has fully elapsed", () => {
		// At the cap, but the window has elapsed exactly -> fresh window, count 1.
		const d = evaluateRateLimit({ windowStart: 5_000, count: 3 }, 6_000, config);
		expect(d.allowed).toBe(true);
		expect(d.state).toEqual({ windowStart: 6_000, count: 1 });
	});

	it("does not mutate the previous state object", () => {
		const prev = { windowStart: 5_000, count: 1 };
		evaluateRateLimit(prev, 5_100, config);
		expect(prev).toEqual({ windowStart: 5_000, count: 1 });
	});
});

describe("consumeRateLimit (DB-backed)", () => {
	const config: RateLimitConfig = { windowMs: 1000, max: 2 };

	it("trips on the (max+1)th hit in a window, then resets after rollover", async () => {
		const t = convexTest(schema, modules);
		const key = "k:trip";

		const first = await t.run((ctx) => consumeRateLimit(ctx, key, config, 1_000));
		const second = await t.run((ctx) => consumeRateLimit(ctx, key, config, 1_100));
		const third = await t.run((ctx) => consumeRateLimit(ctx, key, config, 1_200));

		expect(first.allowed).toBe(true);
		expect(second.allowed).toBe(true);
		expect(third.allowed).toBe(false);

		// Exactly one row persists for the key, holding the last accepted state.
		const rows = await t.run((ctx) => ctx.db.query(TABLE.RATE_LIMITS).collect());
		expect(rows).toHaveLength(1);
		expect(rows[0]!.count).toBe(2);

		// Window elapsed -> fresh window, allowed again with count reset to 1.
		const afterRollover = await t.run((ctx) => consumeRateLimit(ctx, key, config, 2_200));
		expect(afterRollover.allowed).toBe(true);
		expect(afterRollover.state).toEqual({ windowStart: 2_200, count: 1 });
	});

	it("tracks distinct keys independently", async () => {
		const t = convexTest(schema, modules);

		await t.run((ctx) => consumeRateLimit(ctx, "k:a", config, 1_000));
		await t.run((ctx) => consumeRateLimit(ctx, "k:a", config, 1_000));
		const aThird = await t.run((ctx) => consumeRateLimit(ctx, "k:a", config, 1_000));
		expect(aThird.allowed).toBe(false); // key "a" is tripped

		const bFirst = await t.run((ctx) => consumeRateLimit(ctx, "k:b", config, 1_000));
		expect(bFirst.allowed).toBe(true); // key "b" is unaffected
		expect(bFirst.state.count).toBe(1);

		const rows = await t.run((ctx) => ctx.db.query(TABLE.RATE_LIMITS).collect());
		expect(rows).toHaveLength(2);
	});
});
