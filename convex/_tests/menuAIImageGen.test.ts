/**
 * AI menu image generation (workstream B).
 *
 * `fetch` is stubbed in every test that reaches the action: this suite must
 * never call OpenRouter.
 */
import { convexTest } from "convex-test";
import { Blob as NodeBlob } from "node:buffer";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { hardDeleteRestaurantDataTyped } from "../restaurantPurge";
import schema from "../schema";
import {
	MENU_AI_IMAGE_DEFAULT_MONTHLY_LIMIT_PER_ORG,
	MENU_AI_IMAGE_DRAFT_STATUS,
	MENU_AI_IMAGE_JOB_STATUS,
	MENU_ITEM_IMAGE_SOURCE,
	TABLE,
} from "../constants";

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
const OUTSIDER = "user_outsider";

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
		await t.run(async (ctx) =>
			ctx.db.patch(jobId, {
				status: MENU_AI_IMAGE_JOB_STATUS.FAILED,
				error: "provider_error",
			})
		);

		await t.action(internal.menuAIImageGenActions.generate, { jobId });

		expect(fetchMock).not.toHaveBeenCalled();
		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.error).toBe("provider_error");
	});

	it("marks the job failed with item_missing when its menu item is gone", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const jobId = await insertQueuedJob(t, ids);
		await t.run(async (ctx) => ctx.db.delete(ids.menuItemId));

		await t.action(internal.menuAIImageGenActions.generate, { jobId });

		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe(MENU_AI_IMAGE_JOB_STATUS.FAILED);
		expect(job?.error).toBe("item_missing");
		expect(fetchMock).not.toHaveBeenCalled();
		expect(await storedFileCount(t)).toBe(0);
	});

	it("leaves a finished job untouched when invoked again", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const jobId = await insertQueuedJob(t, ids);
		await t.run(async (ctx) =>
			ctx.db.patch(jobId, { status: MENU_AI_IMAGE_JOB_STATUS.DONE, costUsd: 0.04 })
		);

		await t.action(internal.menuAIImageGenActions.generate, { jobId });

		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe(MENU_AI_IMAGE_JOB_STATUS.DONE);
		expect(job?.costUsd).toBe(0.04);
		expect(job?.error).toBeUndefined();
	});
});

function asManager(t: T) {
	return t.withIdentity({ subject: MANAGER });
}

describe("startGeneration", () => {
	it("creates attempt 1 as queued, schedules the action, and reports what is left this month", async () => {
		// `finishInProgressScheduledFunctions` does not wait for a scheduled
		// function whose real setTimeout has not fired yet; fake timers let us
		// run it to completion deterministically.
		vi.useFakeTimers();
		try {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => okImageResponse())
			);
			vi.stubEnv("OPENROUTER_API_KEY", "test-key");
			const t = convexTest(schema, modules);
			const ids = await seed(t);

			const [result, error] = await asManager(t).mutation(api.menuAIImageGen.startGeneration, {
				menuItemId: ids.menuItemId,
			});
			expect(error).toBeNull();
			expect(result?.attempt).toBe(1);
			expect(result?.remainingThisMonth).toBe(MENU_AI_IMAGE_DEFAULT_MONTHLY_LIMIT_PER_ORG - 1);

			await t.finishAllScheduledFunctions(vi.runAllTimers);
			const job = await t.run(async (ctx) => ctx.db.get(result!.jobId));
			expect(job?.status).toBe(MENU_AI_IMAGE_JOB_STATUS.DONE);
			expect(job?.organizationId).toBe(ids.organizationId);
		} finally {
			vi.useRealTimers();
		}
	});

	it("refuses an outsider", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const [, error] = await t
			.withIdentity({ subject: OUTSIDER })
			.mutation(api.menuAIImageGen.startGeneration, { menuItemId: ids.menuItemId });
		expect(error).not.toBeNull();
	});

	it("refuses while an attempt is in flight, but recovers from a stale one", async () => {
		// Pin Date.now() to NOW: the staleness check compares real time against
		// the job's stored timestamps, so the clock must match the fixture data
		// rather than drift with the real wall clock.
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		try {
			const t = convexTest(schema, modules);
			const ids = await seed(t);
			const runningId = await insertQueuedJob(t, ids, { status: "running" });

			const [, error] = await asManager(t).mutation(api.menuAIImageGen.startGeneration, {
				menuItemId: ids.menuItemId,
			});
			expect(error?.name).toBe("AI_IMAGE_GENERATION_IN_PROGRESS");

			// Age the running job past the stale threshold; the next click proceeds.
			await t.run(async (ctx) =>
				ctx.db.patch(runningId, {
					startedAt: NOW - 11 * 60 * 1000,
					createdAt: NOW - 11 * 60 * 1000,
				})
			);
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => okImageResponse())
			);
			vi.stubEnv("OPENROUTER_API_KEY", "test-key");
			const [result, error2] = await asManager(t).mutation(api.menuAIImageGen.startGeneration, {
				menuItemId: ids.menuItemId,
			});
			expect(error2).toBeNull();
			expect(result?.attempt).toBe(2);
			const stale = await t.run(async (ctx) => ctx.db.get(runningId));
			expect(stale?.status).toBe(MENU_AI_IMAGE_JOB_STATUS.FAILED);
			expect(stale?.error).toBe("timeout");
			await t.finishAllScheduledFunctions(vi.runAllTimers);
		} finally {
			vi.useRealTimers();
		}
	});

	it("supersedes a pending draft and deletes its blob when regenerating", async () => {
		vi.useFakeTimers();
		try {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => okImageResponse())
			);
			vi.stubEnv("OPENROUTER_API_KEY", "test-key");
			const t = convexTest(schema, modules);
			const ids = await seed(t);
			const { draftId } = await insertJobAndDraft(t, ids, "pending");
			expect(await storedFileCount(t)).toBe(1);

			const [result] = await asManager(t).mutation(api.menuAIImageGen.startGeneration, {
				menuItemId: ids.menuItemId,
			});
			expect(result?.attempt).toBe(2);
			const draft = await t.run(async (ctx) => ctx.db.get(draftId));
			expect(draft?.status).toBe(MENU_AI_IMAGE_DRAFT_STATUS.SUPERSEDED);
			expect(await storedFileCount(t)).toBe(0);
			await t.finishAllScheduledFunctions(vi.runAllTimers);
		} finally {
			vi.useRealTimers();
		}
	});

	it("enforces the organization's monthly limit, ignoring failed attempts", async () => {
		vi.useFakeTimers();
		try {
			const t = convexTest(schema, modules);
			const ids = await seed(t, { monthlyLimit: 2 });
			await insertJobAndDraft(t, ids, "approved"); // done, counts
			await t.run(async (ctx) =>
				ctx.db.insert(TABLE.MENU_AI_IMAGE_GEN_JOBS, {
					restaurantId: ids.restaurantId,
					organizationId: ids.organizationId,
					menuItemId: ids.menuItemId,
					attempt: 2,
					status: MENU_AI_IMAGE_JOB_STATUS.FAILED,
					error: "provider_error",
					requestedBy: MANAGER,
					model: "m",
					retries: 0,
					createdAt: NOW,
					finishedAt: NOW,
				})
			);
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => okImageResponse())
			);
			vi.stubEnv("OPENROUTER_API_KEY", "test-key");

			// 1 counted + this one = 2 = limit → allowed, remaining 0.
			const [first, e1] = await asManager(t).mutation(api.menuAIImageGen.startGeneration, {
				menuItemId: ids.menuItemId,
			});
			expect(e1).toBeNull();
			expect(first?.remainingThisMonth).toBe(0);
			await t.finishAllScheduledFunctions(vi.runAllTimers);

			const [, e2] = await asManager(t).mutation(api.menuAIImageGen.startGeneration, {
				menuItemId: ids.menuItemId,
			});
			expect(e2?.name).toBe("AI_IMAGE_MONTHLY_LIMIT_REACHED");
		} finally {
			vi.useRealTimers();
		}
	});

	it("is switched off by a limit of 0", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t, { monthlyLimit: 0 });
		const [, error] = await asManager(t).mutation(api.menuAIImageGen.startGeneration, {
			menuItemId: ids.menuItemId,
		});
		expect(error?.name).toBe("AI_IMAGE_MONTHLY_LIMIT_REACHED");
	});

	it("does not count last month's jobs", async () => {
		vi.useFakeTimers();
		try {
			const t = convexTest(schema, modules);
			const ids = await seed(t, { monthlyLimit: 1 });
			await t.run(async (ctx) =>
				ctx.db.insert(TABLE.MENU_AI_IMAGE_GEN_JOBS, {
					restaurantId: ids.restaurantId,
					organizationId: ids.organizationId,
					menuItemId: ids.menuItemId,
					attempt: 1,
					status: MENU_AI_IMAGE_JOB_STATUS.DONE,
					requestedBy: MANAGER,
					model: "m",
					retries: 0,
					createdAt: Date.UTC(2020, 0, 15),
					finishedAt: Date.UTC(2020, 0, 15),
				})
			);
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => okImageResponse())
			);
			vi.stubEnv("OPENROUTER_API_KEY", "test-key");
			const [, error] = await asManager(t).mutation(api.menuAIImageGen.startGeneration, {
				menuItemId: ids.menuItemId,
			});
			expect(error).toBeNull();
			await t.finishAllScheduledFunctions(vi.runAllTimers);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("getItemGeneration", () => {
	it("reports the pending draft with a url, the attempt count, and what is left", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		await insertJobAndDraft(t, ids, "pending");

		const view = await asManager(t).query(api.menuAIImageGen.getItemGeneration, {
			menuItemId: ids.menuItemId,
		});
		expect(view.pendingDraft?.imageUrl).toMatch(/^https?:\/\//);
		expect(view.pendingDraft?.attempt).toBe(1);
		expect(view.attemptCount).toBe(1);
		expect(view.activeJob).toBeNull();
		expect(view.monthlyLimit).toBe(MENU_AI_IMAGE_DEFAULT_MONTHLY_LIMIT_PER_ORG);
		expect(view.remainingThisMonth).toBe(MENU_AI_IMAGE_DEFAULT_MONTHLY_LIMIT_PER_ORG - 1);
	});

	it("surfaces a recent failure so the panel can explain it", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const jobId = await insertQueuedJob(t, ids);
		await t.run(async (ctx) =>
			ctx.db.patch(jobId, {
				status: MENU_AI_IMAGE_JOB_STATUS.FAILED,
				error: "credits_exhausted",
				finishedAt: Date.now(),
			})
		);
		const view = await asManager(t).query(api.menuAIImageGen.getItemGeneration, {
			menuItemId: ids.menuItemId,
		});
		expect(view.activeJob).toMatchObject({ status: "failed", error: "credits_exhausted" });
	});

	it("refuses an outsider", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		await expect(
			t
				.withIdentity({ subject: OUTSIDER })
				.query(api.menuAIImageGen.getItemGeneration, { menuItemId: ids.menuItemId })
		).rejects.toThrow();
	});
});

describe("approveDraft / rejectDraft", () => {
	it("approve moves the blob onto the item, marks it generated, and supersedes an older approved draft", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const older = await insertJobAndDraft(t, ids, "approved"); // item currently shows this blob
		const newer = await insertJobAndDraft(t, ids, "pending");
		expect(await storedFileCount(t)).toBe(2);

		const [, error] = await asManager(t).mutation(api.menuAIImageGen.approveDraft, {
			draftId: newer.draftId,
		});
		expect(error).toBeNull();

		const { item, olderDraft, newerDraft } = await t.run(async (ctx) => ({
			item: await ctx.db.get(ids.menuItemId),
			olderDraft: await ctx.db.get(older.draftId),
			newerDraft: await ctx.db.get(newer.draftId),
		}));
		expect(item?.imageStorageId).toBe(newer.storageId);
		expect(item?.imageSource).toBe(MENU_ITEM_IMAGE_SOURCE.GENERATED);
		expect(newerDraft?.status).toBe(MENU_AI_IMAGE_DRAFT_STATUS.APPROVED);
		expect(newerDraft?.reviewedBy).toBe(MANAGER);
		expect(olderDraft?.status).toBe(MENU_AI_IMAGE_DRAFT_STATUS.SUPERSEDED);
		// The older blob was the item's image and is gone; the newer one is the item's now.
		expect(await storedFileCount(t)).toBe(1);
	});

	it("approve refuses a draft that is not pending", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const { draftId } = await insertJobAndDraft(t, ids, "approved");
		const [, error] = await asManager(t).mutation(api.menuAIImageGen.approveDraft, { draftId });
		expect(error?.name).toBe("CONFLICT");
	});

	it("reject deletes the blob and keeps the row", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const { draftId } = await insertJobAndDraft(t, ids, "pending");

		const [, error] = await asManager(t).mutation(api.menuAIImageGen.rejectDraft, { draftId });
		expect(error).toBeNull();
		const draft = await t.run(async (ctx) => ctx.db.get(draftId));
		expect(draft?.status).toBe(MENU_AI_IMAGE_DRAFT_STATUS.REJECTED);
		expect(await storedFileCount(t)).toBe(0);
	});
});

describe("imageSource on the upload paths", () => {
	it("update with an uploaded image marks the source uploaded, and removeImage clears it", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		await insertJobAndDraft(t, ids, "approved");
		const uploaded = await t.run(async (ctx) =>
			ctx.storage.store(new Blob([TINY_JPEG], { type: "image/jpeg" }))
		);

		const [, e1] = await asManager(t).mutation(api.menuItems.update, {
			itemId: ids.menuItemId,
			imageStorageId: uploaded,
		});
		expect(e1).toBeNull();
		let item = await t.run(async (ctx) => ctx.db.get(ids.menuItemId));
		expect(item?.imageSource).toBe(MENU_ITEM_IMAGE_SOURCE.UPLOADED);

		const [, e2] = await asManager(t).mutation(api.menuItems.removeImage, {
			itemId: ids.menuItemId,
		});
		expect(e2).toBeNull();
		item = await t.run(async (ctx) => ctx.db.get(ids.menuItemId));
		expect(item?.imageSource).toBeUndefined();
		expect(item?.imageStorageId).toBeUndefined();
	});
});

describe("organizations.updateOrganization aiImageMonthlyLimit", () => {
	it("lets an admin set it and refuses a manager", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const [, e1] = await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.organizations.updateOrganization, {
				id: ids.organizationId,
				aiImageMonthlyLimit: 250,
			});
		expect(e1).toBeNull();
		const org = await t.run(async (ctx) => ctx.db.get(ids.organizationId));
		expect(org?.aiImageMonthlyLimit).toBe(250);

		const [, e2] = await asManager(t).mutation(api.organizations.updateOrganization, {
			id: ids.organizationId,
			aiImageMonthlyLimit: 5,
		});
		expect(e2).not.toBeNull();
	});

	it("rejects a negative or non-integer limit", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const [, error] = await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.organizations.updateOrganization, {
				id: ids.organizationId,
				aiImageMonthlyLimit: -1,
			});
		expect(error?.name).toBe("VALIDATION_ERROR");
	});
});
