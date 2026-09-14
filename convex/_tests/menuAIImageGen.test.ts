/**
 * AI menu image generation (workstream B).
 *
 * `fetch` is stubbed in every test that reaches the action: this suite must
 * never call OpenRouter.
 */
import { convexTest } from "convex-test";
import { Blob as NodeBlob } from "node:buffer";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { hardDeleteRestaurantDataTyped } from "../restaurantPurge";
import schema from "../schema";
import { MENU_AI_IMAGE_DRAFT_STATUS, MENU_AI_IMAGE_JOB_STATUS, TABLE } from "../constants";

const modules = import.meta.glob("../**/*.ts");
type T = ReturnType<typeof convexTest>;

/**
 * jsdom's `Blob` has no `arrayBuffer()`, and convex-test needs it to hash a
 * stored file. Real Convex actions run in a web-standard runtime where the
 * method exists, so this is a gap in the test environment rather than
 * something the action should work around — `menuAIImageGenActions.generate`
 * constructs its own Blob, so unlike the setup helpers above there is no call
 * site here to swap (see `convex/_tests/branding.test.ts` for the same fix).
 */
const jsdomBlob = globalThis.Blob;
beforeAll(() => {
	globalThis.Blob = NodeBlob as unknown as typeof globalThis.Blob;
});
afterAll(() => {
	globalThis.Blob = jsdomBlob;
});

const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);
const MANAGER = "user_manager";
const ADMIN = "user_admin";

/** A 1x1 JPEG (SOF0 at 0xFFC0 with 1x1 dimensions), enough for the decoder and dimension reader. */
export const TINY_JPEG = new Uint8Array([
	0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff,
	0xd9,
]);

export async function seed(t: T, opts: { monthlyLimit?: number } = {}) {
	return t.run(async (ctx) => {
		const organizationId = await ctx.db.insert(TABLE.ORGANIZATIONS, {
			name: "Org",
			slug: "org",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
			...(opts.monthlyLimit !== undefined && { aiImageMonthlyLimit: opts.monthlyLimit }),
		});
		const restaurantId = await ctx.db.insert(TABLE.RESTAURANTS, {
			ownerId: "owner-1",
			organizationId,
			name: "Vernaculo",
			slug: "vernaculo",
			currency: "MXN",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		await ctx.db.insert(TABLE.RESTAURANT_MEMBERS, {
			userId: MANAGER,
			restaurantId,
			organizationId,
			role: "manager",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		await ctx.db.insert(TABLE.USER_ROLES, {
			userId: ADMIN,
			roles: ["admin"],
			createdAt: NOW,
			updatedAt: NOW,
		});
		const menuId = await ctx.db.insert(TABLE.MENUS, {
			restaurantId,
			name: "Main",
			translations: {},
			isActive: true,
			displayOrder: 0,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const categoryId = await ctx.db.insert(TABLE.MENU_CATEGORIES, {
			menuId,
			restaurantId,
			name: "Carnes",
			translations: {},
			displayOrder: 0,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const menuItemId = await ctx.db.insert(TABLE.MENU_ITEMS, {
			categoryId,
			restaurantId,
			name: "Rib eye",
			description: "un delicioso corte de lomo de res",
			translations: {},
			basePrice: 100000,
			isAvailable: true,
			displayOrder: 0,
			createdAt: NOW,
			updatedAt: NOW,
		});
		return { organizationId, restaurantId, menuId, categoryId, menuItemId };
	});
}

export async function storedFileCount(t: T): Promise<number> {
	return t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length);
}

async function insertJobAndDraft(
	t: T,
	ids: {
		restaurantId: Id<"restaurants">;
		organizationId: Id<"organizations">;
		menuItemId: Id<"menuItems">;
	},
	draftStatus: "pending" | "approved"
) {
	return t.run(async (ctx) => {
		const storageId = await ctx.storage.store(
			new NodeBlob([TINY_JPEG], { type: "image/jpeg" }) as Blob
		);
		const jobId = await ctx.db.insert(TABLE.MENU_AI_IMAGE_GEN_JOBS, {
			restaurantId: ids.restaurantId,
			organizationId: ids.organizationId,
			menuItemId: ids.menuItemId,
			attempt: 1,
			status: MENU_AI_IMAGE_JOB_STATUS.DONE,
			requestedBy: MANAGER,
			model: "test/model",
			retries: 0,
			createdAt: NOW,
			finishedAt: NOW,
		});
		const draftId = await ctx.db.insert(TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS, {
			restaurantId: ids.restaurantId,
			menuItemId: ids.menuItemId,
			jobId,
			attempt: 1,
			storageId,
			prompt: "p",
			status: draftStatus,
			createdAt: NOW,
		});
		if (draftStatus === MENU_AI_IMAGE_DRAFT_STATUS.APPROVED) {
			await ctx.db.patch(ids.menuItemId, { imageStorageId: storageId, imageSource: "generated" });
		}
		return { jobId, draftId, storageId };
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("restaurant purge", () => {
	it("deletes jobs, drafts, and the blobs of pending drafts", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		await insertJobAndDraft(t, ids, "pending");
		await insertJobAndDraft(t, ids, "approved");
		expect(await storedFileCount(t)).toBe(2);

		await t.run(async (ctx) => {
			await hardDeleteRestaurantDataTyped(ctx, ids.restaurantId);
		});

		const rows = await t.run(async (ctx) => ({
			jobs: await ctx.db.query(TABLE.MENU_AI_IMAGE_GEN_JOBS).collect(),
			drafts: await ctx.db.query(TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS).collect(),
		}));
		expect(rows.jobs).toHaveLength(0);
		expect(rows.drafts).toHaveLength(0);
		// Pending blob deleted by the draft purge; approved blob deleted with the
		// item that owned it. Neither deleted twice.
		expect(await storedFileCount(t)).toBe(0);
	});
});

async function insertQueuedJob(
	t: T,
	ids: {
		restaurantId: Id<"restaurants">;
		organizationId: Id<"organizations">;
		menuItemId: Id<"menuItems">;
	},
	overrides: Partial<{ retries: number; status: "queued" | "running" }> = {}
) {
	return t.run(async (ctx) =>
		ctx.db.insert(TABLE.MENU_AI_IMAGE_GEN_JOBS, {
			restaurantId: ids.restaurantId,
			organizationId: ids.organizationId,
			menuItemId: ids.menuItemId,
			attempt: 1,
			status: overrides.status ?? MENU_AI_IMAGE_JOB_STATUS.QUEUED,
			requestedBy: MANAGER,
			model: "test/model",
			retries: overrides.retries ?? 0,
			createdAt: NOW,
		})
	);
}

function okImageResponse(cost = 0.04) {
	return new Response(
		JSON.stringify({
			created: 1,
			data: [{ b64_json: Buffer.from(TINY_JPEG).toString("base64"), media_type: "image/jpeg" }],
			usage: { cost },
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } }
	);
}

describe("generate action", () => {
	it("stores the image, records a pending draft with dimensions and cost, marks the job done", async () => {
		const fetchMock = vi.fn(async () => okImageResponse(0.04));
		vi.stubGlobal("fetch", fetchMock);
		vi.stubEnv("OPENROUTER_API_KEY", "test-key");
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const jobId = await insertQueuedJob(t, ids);

		await t.action(internal.menuAIImageGenActions.generate, { jobId });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("https://openrouter.ai/api/v1/images");
		const body = JSON.parse(String(init.body));
		expect(body).toMatchObject({
			model: "test/model",
			aspect_ratio: "4:3",
			output_format: "jpeg",
			n: 1,
		});
		expect(body.prompt).toContain("Rib eye");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");

		const { job, drafts } = await t.run(async (ctx) => ({
			job: await ctx.db.get(jobId),
			drafts: await ctx.db.query(TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS).collect(),
		}));
		expect(job?.status).toBe(MENU_AI_IMAGE_JOB_STATUS.DONE);
		expect(job?.costUsd).toBe(0.04);
		expect(drafts).toHaveLength(1);
		expect(drafts[0].status).toBe(MENU_AI_IMAGE_DRAFT_STATUS.PENDING);
		expect(drafts[0].width).toBe(1);
		expect(drafts[0].height).toBe(1);
		expect(drafts[0].prompt).toBe(body.prompt);
		expect(await storedFileCount(t)).toBe(1);
	});

	it("fails on 402 without retrying and stores nothing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("", { status: 402 }))
		);
		vi.stubEnv("OPENROUTER_API_KEY", "test-key");
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const jobId = await insertQueuedJob(t, ids);

		await t.action(internal.menuAIImageGenActions.generate, { jobId });

		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe(MENU_AI_IMAGE_JOB_STATUS.FAILED);
		expect(job?.error).toBe("credits_exhausted");
		expect(await storedFileCount(t)).toBe(0);
	});

	it("schedules a retry on 429 while retries remain, then fails when they run out", async () => {
		// `ctx.scheduler.runAfter` schedules the retry with a real setTimeout
		// under convex-test; fake timers let us fire it without an actual
		// multi-second wait, and must be active before the schedule call so
		// they are the timer implementation it captures.
		vi.useFakeTimers();
		try {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => new Response("", { status: 429 }))
			);
			vi.stubEnv("OPENROUTER_API_KEY", "test-key");
			const t = convexTest(schema, modules);
			const ids = await seed(t);
			const jobId = await insertQueuedJob(t, ids, { retries: 2 });

			await t.action(internal.menuAIImageGenActions.generate, { jobId });
			let job = await t.run(async (ctx) => ctx.db.get(jobId));
			expect(job?.status).toBe(MENU_AI_IMAGE_JOB_STATUS.RUNNING);
			expect(job?.retries).toBe(3);

			// The scheduled retry is the same action; run it and let it exhaust.
			await t.finishAllScheduledFunctions(vi.runAllTimers);
			job = await t.run(async (ctx) => ctx.db.get(jobId));
			expect(job?.status).toBe(MENU_AI_IMAGE_JOB_STATUS.FAILED);
			expect(job?.error).toBe("rate_limited");
		} finally {
			vi.useRealTimers();
		}
	});

	it("fails with invalid_response when the body has no image", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
		);
		vi.stubEnv("OPENROUTER_API_KEY", "test-key");
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const jobId = await insertQueuedJob(t, ids);

		await t.action(internal.menuAIImageGenActions.generate, { jobId });

		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.error).toBe("invalid_response");
		expect(await storedFileCount(t)).toBe(0);
	});

	it("does nothing for a job that is no longer runnable", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const jobId = await insertQueuedJob(t, ids);
		await t.run(async (ctx) => ctx.db.patch(jobId, { status: MENU_AI_IMAGE_JOB_STATUS.FAILED }));

		await t.action(internal.menuAIImageGenActions.generate, { jobId });

		expect(fetchMock).not.toHaveBeenCalled();
	});
});
