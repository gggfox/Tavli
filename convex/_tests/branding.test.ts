/**
 * Behaviour tests for the branding upload action (TAVLI-96).
 *
 * The interesting assertions here are the ones about what does *not* happen: a
 * rejected upload must leave no blob behind, and an unauthorized caller must be
 * refused before any bytes are stored. Both are invisible from the outside —
 * the caller sees an error either way — so they are checked by counting stored
 * files rather than by inspecting the response.
 */
import { Blob as NodeBlob } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { BRANDING_SLOT_SPECS } from "../brandingImageHelpers";

const modules = import.meta.glob("../**/*.ts");

/**
 * jsdom's `Blob` has no `arrayBuffer()`, and convex-test needs it to hash a
 * stored file. Real Convex actions run in a web-standard runtime where the
 * method exists, so this is a gap in the test environment rather than
 * something the action should work around — `setBrandingImage` constructs its
 * own Blob, so unlike the other suites there is no call site to swap.
 */
const jsdomBlob = globalThis.Blob;
beforeAll(() => {
	globalThis.Blob = NodeBlob as unknown as typeof globalThis.Blob;
});
afterAll(() => {
	globalThis.Blob = jsdomBlob;
});

const FIXTURES = join(__dirname, "fixtures/branding");
/**
 * Read a fixture into an ArrayBuffer allocated **in this realm**.
 *
 * `Buffer.buffer` hands back a Node-realm ArrayBuffer, and convex-test
 * validates `v.bytes()` with `value instanceof ArrayBuffer` against the jsdom
 * global — so the Node one is rejected as "Expected ArrayBuffer, got [object
 * ArrayBuffer]". Copying through a fresh Uint8Array fixes the realm.
 */
const bytesOf = (name: string): ArrayBuffer => {
	const buffer = readFileSync(join(FIXTURES, name));
	const copy = new Uint8Array(buffer.byteLength);
	copy.set(buffer);
	return copy.buffer;
};

const LOGO_PNG = bytesOf("logo-512.png");
const HEADER_DESKTOP = bytesOf("header-desktop-1600x900.webp");
const WRONG_SIZE = bytesOf("wrong-size-800x600.webp");

const NOW = 1_750_000_000_000;
const MANAGER = "manager-user";
const OUTSIDER = "outsider-user";

type T = ReturnType<typeof convexTest>;

async function seed(t: T) {
	return t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Org",
			slug: "org",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-1",
			organizationId,
			name: "Tacos",
			slug: "tacos",
			currency: "MXN",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		await ctx.db.insert("restaurantMembers", {
			userId: MANAGER,
			restaurantId,
			organizationId,
			role: "manager",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		return { organizationId, restaurantId };
	});
}

/** How many files exist in storage right now. */
async function storedFileCount(t: T): Promise<number> {
	return t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length);
}

describe("setBrandingImage", () => {
	it("stores a valid image and records its real dimensions", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seed(t);

		await t
			.withIdentity({ subject: MANAGER })
			.action(api.branding.setBrandingImage, { restaurantId, slot: "logo", bytes: LOGO_PNG });

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.brandingLogoStorageId).toBeDefined();
		// Dimensions come from the file's own header, not from the client and
		// not from the slot spec — that is what makes them safe for the
		// renderer to emit as width/height and rely on for CLS.
		expect(restaurant?.brandingLogoWidth).toBe(512);
		expect(restaurant?.brandingLogoHeight).toBe(512);
	});

	it("refuses an outsider, and stores nothing while refusing", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seed(t);
		const before = await storedFileCount(t);

		await expect(
			t
				.withIdentity({ subject: OUTSIDER })
				.action(api.branding.setBrandingImage, { restaurantId, slot: "logo", bytes: LOGO_PNG })
		).rejects.toThrow();

		// The real assertion. Authorizing *after* storing would also throw, and
		// would leave a blob nothing references and no purge can ever find —
		// one orphan per probe, from a caller with no rights at all.
		expect(await storedFileCount(t)).toBe(before);
	});

	it("refuses an anonymous caller", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seed(t);
		await expect(
			t.action(api.branding.setBrandingImage, { restaurantId, slot: "logo", bytes: LOGO_PNG })
		).rejects.toThrow();
		expect(await storedFileCount(t)).toBe(0);
	});

	it("rejects an SVG renamed to .png, leaving no blob", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seed(t);
		const svg = new TextEncoder().encode(
			'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
		);

		await expect(
			t.withIdentity({ subject: MANAGER }).action(api.branding.setBrandingImage, {
				restaurantId,
				slot: "logo",
				bytes: svg.buffer as ArrayBuffer,
			})
		).rejects.toThrow();

		expect(await storedFileCount(t)).toBe(0);
		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.brandingLogoStorageId).toBeUndefined();
	});

	it("rejects wrong dimensions, leaving no blob", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seed(t);

		await expect(
			t.withIdentity({ subject: MANAGER }).action(api.branding.setBrandingImage, {
				restaurantId,
				slot: "headerDesktop",
				bytes: WRONG_SIZE,
			})
		).rejects.toThrow();
		expect(await storedFileCount(t)).toBe(0);
	});

	it("deletes the blob it replaces, so a re-upload does not accumulate", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seed(t);
		const asManager = t.withIdentity({ subject: MANAGER });

		await asManager.action(api.branding.setBrandingImage, {
			restaurantId,
			slot: "logo",
			bytes: LOGO_PNG,
		});
		const first = await t.run(
			async (ctx) => (await ctx.db.get(restaurantId))?.brandingLogoStorageId
		);
		expect(await storedFileCount(t)).toBe(1);

		await asManager.action(api.branding.setBrandingImage, {
			restaurantId,
			slot: "logo",
			bytes: LOGO_PNG,
		});

		const second = await t.run(
			async (ctx) => (await ctx.db.get(restaurantId))?.brandingLogoStorageId
		);
		expect(second).not.toBe(first);
		// Still one file: a manager iterating on their logo ten times must not
		// leave nine orphans behind.
		expect(await storedFileCount(t)).toBe(1);
		expect(await t.run(async (ctx) => ctx.storage.getUrl(first as Id<"_storage">))).toBeNull();
	});

	it("keeps the four slots independent", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seed(t);
		const asManager = t.withIdentity({ subject: MANAGER });

		await asManager.action(api.branding.setBrandingImage, {
			restaurantId,
			slot: "logo",
			bytes: LOGO_PNG,
		});
		await asManager.action(api.branding.setBrandingImage, {
			restaurantId,
			slot: "headerDesktop",
			bytes: HEADER_DESKTOP,
		});

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		// A shared column between slots would make the second upload silently
		// orphan the first one's blob.
		expect(restaurant?.brandingLogoStorageId).toBeDefined();
		expect(restaurant?.brandingHeaderDesktopStorageId).toBeDefined();
		expect(restaurant?.brandingHeaderDesktopWidth).toBe(1600);
		expect(await storedFileCount(t)).toBe(2);
	});

	it("rejects a file that is valid for a different slot", async () => {
		// The desktop header is a real, well-formed WebP — just not 768x432.
		const t = convexTest(schema, modules);
		const { restaurantId } = await seed(t);

		await expect(
			t.withIdentity({ subject: MANAGER }).action(api.branding.setBrandingImage, {
				restaurantId,
				slot: "headerPhone",
				bytes: HEADER_DESKTOP,
			})
		).rejects.toThrow();
		expect(await storedFileCount(t)).toBe(0);
	});
});

describe("clearBrandingImage", () => {
	it("clears the columns and deletes the blob", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seed(t);
		const asManager = t.withIdentity({ subject: MANAGER });

		await asManager.action(api.branding.setBrandingImage, {
			restaurantId,
			slot: "logo",
			bytes: LOGO_PNG,
		});
		await asManager.action(api.branding.clearBrandingImage, { restaurantId, slot: "logo" });

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.brandingLogoStorageId).toBeUndefined();
		expect(restaurant?.brandingLogoWidth).toBeUndefined();
		expect(restaurant?.brandingLogoHeight).toBeUndefined();
		expect(await storedFileCount(t)).toBe(0);
	});

	it("refuses an outsider", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seed(t);
		await t.withIdentity({ subject: MANAGER }).action(api.branding.setBrandingImage, {
			restaurantId,
			slot: "logo",
			bytes: LOGO_PNG,
		});

		await expect(
			t
				.withIdentity({ subject: OUTSIDER })
				.action(api.branding.clearBrandingImage, { restaurantId, slot: "logo" })
		).rejects.toThrow();
		expect(await storedFileCount(t)).toBe(1);
	});
});

describe("getBrandingImages", () => {
	it("resolves urls for the manager, who is handed ids and cannot render them", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seed(t);
		const asManager = t.withIdentity({ subject: MANAGER });

		await asManager.action(api.branding.setBrandingImage, {
			restaurantId,
			slot: "logo",
			bytes: LOGO_PNG,
		});

		const images = await asManager.query(api.branding.getBrandingImages, { restaurantId });
		expect(images.logo?.url).toEqual(expect.any(String));
		expect(images.logo).toMatchObject({ width: 512, height: 512 });
		expect(images.headerDesktop).toBeUndefined();
	});

	it("refuses an outsider", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seed(t);
		await expect(
			t.withIdentity({ subject: OUTSIDER }).query(api.branding.getBrandingImages, { restaurantId })
		).rejects.toThrow();
	});

	it("reports a slot as empty when its blob is gone", async () => {
		// A column pointing at a deleted blob must read as "no image", not as
		// a broken <img> the manager cannot explain or fix.
		const t = convexTest(schema, modules);
		const { restaurantId } = await seed(t);
		const asManager = t.withIdentity({ subject: MANAGER });

		await asManager.action(api.branding.setBrandingImage, {
			restaurantId,
			slot: "logo",
			bytes: LOGO_PNG,
		});
		await t.run(async (ctx) => {
			const restaurant = await ctx.db.get(restaurantId);
			await ctx.storage.delete(restaurant!.brandingLogoStorageId!);
		});

		const images = await asManager.query(api.branding.getBrandingImages, { restaurantId });
		expect(images.logo).toBeUndefined();
	});
});

describe("authorizeBrandingUpload", () => {
	it("refuses a soft-deleted restaurant", async () => {
		// Otherwise a restaurant in its 30-day retention window still accepts
		// uploads, and each one is a blob the purge will have to find later.
		const t = convexTest(schema, modules);
		const { restaurantId } = await seed(t);
		await t.run(async (ctx) => ctx.db.patch(restaurantId, { deletedAt: NOW }));

		const allowed = await t.run(async (ctx) =>
			ctx.runQuery(internal.branding.authorizeBrandingUpload, { restaurantId, userId: MANAGER })
		);
		expect(allowed).toBe(false);
	});
});

describe("slot specs are what the action enforces", () => {
	it("uses the same dimensions the tests assert", () => {
		// Guards against the specs drifting while these tests keep passing on
		// stale literals.
		expect(BRANDING_SLOT_SPECS.logo).toMatchObject({ width: 512, height: 512, format: "png" });
		expect(BRANDING_SLOT_SPECS.headerDesktop).toMatchObject({
			width: 1600,
			height: 900,
			format: "webp",
		});
	});
});
