import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetBrandingNegativeCache, loadBranding } from "./brandingLoader";

/**
 * The loader sits before the first byte of every customer page, so its job is
 * as much about what it refuses to do as what it does: never throw, never hang,
 * and never let `/r/<random>` become a free Convex query.
 */

/**
 * A QueryClient whose `ensureQueryData` is whatever the test says.
 *
 * Stubbing at this seam rather than mocking Convex keeps the test about the
 * loader's *policy* — timeout, degradation, caching — instead of about
 * `convexQuery`'s internals.
 */
function clientReturning(impl: () => Promise<unknown>): {
	client: QueryClient;
	calls: () => number;
} {
	let calls = 0;
	const client = new QueryClient();
	client.ensureQueryData = (async () => {
		calls++;
		return impl();
	}) as QueryClient["ensureQueryData"];
	return { client, calls: () => calls };
}

const branded = { branding: { color: "#0f7b6c", fontStack: "X, sans-serif" } };

afterEach(() => {
	__resetBrandingNegativeCache();
	vi.useRealTimers();
});

describe("loadBranding", () => {
	it("returns the restaurant's branding", async () => {
		const { client } = clientReturning(async () => branded);
		await expect(loadBranding(client, "tacos")).resolves.toEqual({
			branding: branded.branding,
		});
	});

	it("returns unbranded for a restaurant with no branding set", async () => {
		const { client } = clientReturning(async () => ({ name: "Tacos" }));
		await expect(loadBranding(client, "tacos")).resolves.toEqual({ branding: null });
	});

	it("degrades to unbranded when the query throws", async () => {
		// A Convex blip must cost a diner mid-order their brand colour, never
		// their page.
		const { client } = clientReturning(async () => {
			throw new Error("convex is down");
		});
		await expect(loadBranding(client, "tacos")).resolves.toEqual({ branding: null });
	});

	it("degrades to unbranded when the query hangs", async () => {
		vi.useFakeTimers();
		const { client } = clientReturning(() => new Promise(() => {}));
		const promise = loadBranding(client, "tacos");
		await vi.advanceTimersByTimeAsync(1_500);
		await expect(promise).resolves.toEqual({ branding: null });
	});

	describe("negative cache", () => {
		it("does not re-query a slug already known to be missing", async () => {
			const { client, calls } = clientReturning(async () => null);

			await loadBranding(client, "nope");
			await loadBranding(client, "nope");
			await loadBranding(client, "nope");

			// Without this, `/r/<anything>` is one HTTP request in, one database
			// round-trip out, at whatever rate someone cares to send — the SSR
			// container as a Convex amplifier.
			expect(calls()).toBe(1);
		});

		it("still queries a different slug", async () => {
			const { client, calls } = clientReturning(async () => null);
			await loadBranding(client, "nope");
			await loadBranding(client, "also-nope");
			expect(calls()).toBe(2);
		});

		it("does NOT cache a timeout", async () => {
			// The bug this guards: if the timeout resolved `null` — the same
			// value Convex uses for "no such restaurant" — a real restaurant that
			// was briefly slow would be remembered as missing and served
			// unbranded for the whole TTL, with nothing anywhere to explain it.
			vi.useFakeTimers();
			let call = 0;
			const client = new QueryClient();
			client.ensureQueryData = (async () => {
				call++;
				// The first attempt never settles: that is what a hang is.
				if (call === 1) return new Promise(() => {});
				return branded;
			}) as QueryClient["ensureQueryData"];

			const first = loadBranding(client, "slow");
			await vi.advanceTimersByTimeAsync(1_500);
			await expect(first).resolves.toEqual({ branding: null });

			// The second attempt must go through and get the real branding.
			vi.useRealTimers();
			await expect(loadBranding(client, "slow")).resolves.toEqual({ branding: branded.branding });
			expect(call).toBe(2);
		});

		it("does not cache a thrown error either", async () => {
			let call = 0;
			const client = new QueryClient();
			client.ensureQueryData = (async () => {
				call++;
				if (call === 1) throw new Error("blip");
				return branded;
			}) as QueryClient["ensureQueryData"];

			await expect(loadBranding(client, "flaky")).resolves.toEqual({ branding: null });
			await expect(loadBranding(client, "flaky")).resolves.toEqual({ branding: branded.branding });
		});

		it("forgets a missing slug once its TTL expires", async () => {
			// A restaurant that goes live must not stay invisible for the life
			// of the SSR process.
			vi.useFakeTimers();
			let call = 0;
			const client = new QueryClient();
			client.ensureQueryData = (async () => {
				call++;
				return call === 1 ? null : branded;
			}) as QueryClient["ensureQueryData"];

			await loadBranding(client, "soon");
			await vi.advanceTimersByTimeAsync(61_000);
			await expect(loadBranding(client, "soon")).resolves.toEqual({ branding: branded.branding });
		});

		it("stays bounded under a flood of distinct slugs", async () => {
			// An unbounded map keyed by attacker-supplied strings is a slower
			// memory leak, not a defence. Past the limit the oldest entries are
			// evicted, so the earliest slug is queried again.
			const { client, calls } = clientReturning(async () => null);

			await loadBranding(client, "first");
			for (let i = 0; i < 600; i++) await loadBranding(client, `flood-${i}`);
			const before = calls();
			await loadBranding(client, "first");

			expect(calls()).toBe(before + 1);
		});
	});
});
