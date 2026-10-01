/**
 * `menuImport.extractMenuFromDocument` refuses with stable codes, RETURNED as
 * result tuples: Convex replaces a thrown error's message with "Server Error"
 * in production, so a thrown code would never reach the import dialog.
 *
 * The model call is mocked; everything up to it (auth, storage, text
 * extraction) runs for real.
 */
import { Blob as NodeBlob } from "node:buffer";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, USER_ROLES } from "../constants";
import { MAX_PDF_BYTES } from "../menuImportPdfHelpers";
import schema from "../schema";

const hoisted = vi.hoisted(() => ({
	generateText: vi.fn(async (_args: unknown): Promise<{ text: string }> => ({ text: "" })),
}));
vi.mock("ai", () => ({ generateText: hoisted.generateText }));

const modules = import.meta.glob("../**/*.ts");

type T = ReturnType<typeof convexTest>;

async function seed(t: T): Promise<Id<"restaurants">> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const organizationId = await ctx.db.insert("organizations", {
			name: "Import Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-user",
			name: "Import Restaurant",
			slug: "import-restaurant",
			currency: "USD",
			organizationId,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("restaurantMembers", {
			userId: "manager-user",
			restaurantId,
			organizationId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
			isActive: true,
			addedBy: "owner-user",
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("userRoles", {
			userId: "admin-user",
			roles: [USER_ROLES.ADMIN],
			createdAt: now,
			updatedAt: now,
		});
		return restaurantId;
	});
}

/** jsdom's `Blob` has no `arrayBuffer()`, which convex-test's storage needs. */
async function store(t: T, contents: string | Uint8Array): Promise<Id<"_storage">> {
	return await t.run(async (ctx) => ctx.storage.store(new NodeBlob([contents]) as Blob));
}

const MENU_TEXT = "Tacos\nTaco al pastor $45";

describe("menuImport.extractMenuFromDocument", () => {
	const originalEnv = process.env.CONVEX_ENV;

	beforeEach(() => {
		// Production behaviour: development re-throws the model's own error.
		delete process.env.CONVEX_ENV;
		hoisted.generateText.mockReset();
	});

	afterEach(() => {
		if (originalEnv === undefined) delete process.env.CONVEX_ENV;
		else process.env.CONVEX_ENV = originalEnv;
	});

	it("returns NOT_AUTHENTICATED instead of throwing for an anonymous caller", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seed(t);
		const storageId = await store(t, MENU_TEXT);

		const [value, error] = await t.action(api.menuImport.extractMenuFromDocument, {
			storageId,
			filename: "menu.txt",
			restaurantId,
		});

		expect(value).toBeNull();
		expect(error?.name).toBe("NOT_AUTHENTICATED");
	});

	it("returns ERROR_MENU_IMPORT_FILE_NOT_FOUND when the upload is gone", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seed(t);
		const storageId = await store(t, MENU_TEXT);
		await t.run(async (ctx) => ctx.storage.delete(storageId));

		const [, error] = await t
			.withIdentity({ subject: "manager-user" })
			.action(api.menuImport.extractMenuFromDocument, {
				storageId,
				filename: "menu.txt",
				restaurantId,
			});

		expect(error).toMatchObject({ name: "NOT_FOUND", message: "ERROR_MENU_IMPORT_FILE_NOT_FOUND" });
	});

	it("returns ERROR_MENU_IMPORT_FILE_TOO_LARGE for an oversized PDF", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seed(t);
		const storageId = await store(t, new Uint8Array(MAX_PDF_BYTES + 1));

		const [, error] = await t
			.withIdentity({ subject: "manager-user" })
			.action(api.menuImport.extractMenuFromDocument, {
				storageId,
				filename: "menu.pdf",
				restaurantId,
			});

		expect(error).toMatchObject({
			name: "VALIDATION_ERROR",
			message: "file: ERROR_MENU_IMPORT_FILE_TOO_LARGE",
		});
	});

	it("returns ERROR_MENU_IMPORT_NO_TEXT for a document with no text", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seed(t);
		const storageId = await store(t, "  \n\t ");

		const [, error] = await t
			.withIdentity({ subject: "manager-user" })
			.action(api.menuImport.extractMenuFromDocument, {
				storageId,
				filename: "menu.txt",
				restaurantId,
			});

		expect(error).toMatchObject({
			name: "VALIDATION_ERROR",
			message: "file: ERROR_MENU_IMPORT_NO_TEXT",
		});
		expect(hoisted.generateText).not.toHaveBeenCalled();
	});

	it("returns ERROR_MENU_IMPORT_INVALID_RESPONSE when the model answers without a menu", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seed(t);
		const storageId = await store(t, MENU_TEXT);

		for (const text of ["Sorry, I can't help with that.", '{"categories": "nope"}']) {
			hoisted.generateText.mockResolvedValueOnce({ text });
			const [, error] = await t
				.withIdentity({ subject: "manager-user" })
				.action(api.menuImport.extractMenuFromDocument, {
					storageId,
					filename: "menu.txt",
					restaurantId,
				});

			expect(error).toMatchObject({
				name: "CONFLICT",
				message: "ERROR_MENU_IMPORT_INVALID_RESPONSE",
			});
		}
	});

	it("returns ERROR_MENU_IMPORT_UNAVAILABLE to a non-admin when the model call fails", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seed(t);
		const storageId = await store(t, MENU_TEXT);
		hoisted.generateText.mockRejectedValueOnce(
			Object.assign(new Error("Payment Required"), { statusCode: 402 })
		);

		const [, error] = await t
			.withIdentity({ subject: "manager-user" })
			.action(api.menuImport.extractMenuFromDocument, {
				storageId,
				filename: "menu.txt",
				restaurantId,
			});

		expect(error).toMatchObject({ name: "CONFLICT", message: "ERROR_MENU_IMPORT_UNAVAILABLE" });
	});

	it("tells an admin the credits ran out when OpenRouter answers 402", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seed(t);
		const storageId = await store(t, MENU_TEXT);
		hoisted.generateText.mockRejectedValueOnce(
			Object.assign(new Error("Payment Required"), { statusCode: 402 })
		);

		const [, error] = await t
			.withIdentity({ subject: "admin-user" })
			.action(api.menuImport.extractMenuFromDocument, {
				storageId,
				filename: "menu.txt",
				restaurantId,
			});

		expect(error).toMatchObject({
			name: "CONFLICT",
			message: "ERROR_MENU_IMPORT_CREDITS_EXHAUSTED",
		});
	});

	it("returns the extracted menu on success", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seed(t);
		const storageId = await store(t, MENU_TEXT);
		hoisted.generateText.mockResolvedValueOnce({
			text: 'Here you go: {"categories":[{"name":"Tacos","items":[{"name":"Taco al pastor","priceInCents":4500}]}]}',
		});

		const [value, error] = await t
			.withIdentity({ subject: "manager-user" })
			.action(api.menuImport.extractMenuFromDocument, {
				storageId,
				filename: "menu.txt",
				restaurantId,
			});

		expect(error).toBeNull();
		expect(value).toEqual({
			categories: [{ name: "Tacos", items: [{ name: "Taco al pastor", priceInCents: 4500 }] }],
		});
	});
});
