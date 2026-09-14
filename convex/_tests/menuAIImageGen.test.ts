/**
 * AI menu image generation (workstream B).
 *
 * `fetch` is stubbed in every test that reaches the action: this suite must
 * never call OpenRouter.
 */
import { convexTest } from "convex-test";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
// `api`/`internal` and an OUTSIDER user are unused by this task's purge test;
// later tasks (generation action, review mutations) will need them when they
// extend this file.
import type { Id } from "../_generated/dataModel";
import { hardDeleteRestaurantDataTyped } from "../restaurantPurge";
import schema from "../schema";
import { MENU_AI_IMAGE_DRAFT_STATUS, MENU_AI_IMAGE_JOB_STATUS, TABLE } from "../constants";

const modules = import.meta.glob("../**/*.ts");
type T = ReturnType<typeof convexTest>;

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
