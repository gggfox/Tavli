/**
 * Structural guards for the branding half of `restaurants.ts` (TAVLI-88).
 *
 * These are not behaviour tests. They defend one boundary: **images never
 * travel through `restaurants.update`.** Branding images go
 * bytes-through-`setBrandingImage`, which authorizes before it touches the
 * bytes and validates magic bytes server-side. A client-supplied
 * `Id<"_storage">` on a patch mutation is the cross-tenant blob-delete
 * primitive TAVLI-68 documents on `menuItems`: a caller who manages restaurant
 * A points it at a blob belonging to restaurant B, and the replace path — which
 * deletes the *previous* blob — deletes B's file.
 *
 * The boundary is easy to erode by accident. Someone adding a "logo" field to
 * the settings form reaches for the mutation the rest of that form already
 * uses, and nothing fails: the patch succeeds, the type checks, the UI works.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FunctionArgs } from "convex/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { BRAND_FONT_IDS } from "./_shared/brandFonts";

// ============================================================================
// Compile-time guard
//
// `tsconfig.json` includes `**/*.ts`, so `pnpm tsc --noEmit` typechecks this
// file: the assignment below stops compiling the moment an `Id<"_storage">`
// appears anywhere in the mutation's arguments. That failure lands in CI's
// typecheck rather than here, which is the point — it fires even if somebody
// deletes the runtime test underneath it.
// ============================================================================

type UpdateArgs = FunctionArgs<typeof api.restaurants.update>;

/**
 * Keys whose value is a storage id. Tested as `NonNullable<T[K]> extends
 * Id<"_storage">` and not the reverse: `Id` is `string & { __tableName }`, so
 * `Id<"_storage"> extends string` is true and the reverse direction would flag
 * every plain string argument on the mutation.
 */
type StorageIdKeys<T> = {
	[K in keyof T]-?: NonNullable<T[K]> extends Id<"_storage"> ? K : never;
}[keyof T];

/** `true` only while `update` is free of storage ids; otherwise `never`. */
type UpdateTakesNoStorageIds = [StorageIdKeys<UpdateArgs>] extends [never] ? true : never;

const _updateTakesNoStorageIds: UpdateTakesNoStorageIds = true;

describe("restaurants.update accepts no storage ids", () => {
	it("holds at the type level", () => {
		// The real assertion is the annotated constant above, checked by tsc.
		// This case exists so the guard is visible in the test report too.
		expect(_updateTakesNoStorageIds).toBe(true);
	});

	it("holds in the source, for a reader who runs only the tests", () => {
		const source = readFileSync(join(__dirname, "restaurants.ts"), "utf8");
		const start = source.indexOf("export const update = mutation({");
		expect(start, "restaurants.update not found — did it get renamed?").toBeGreaterThan(-1);

		// The args object ends where the handler begins.
		const handlerAt = source.indexOf("handler:", start);
		expect(handlerAt).toBeGreaterThan(start);
		const argsBlock = source.slice(start, handlerAt);

		expect(
			argsBlock.includes('v.id("_storage")'),
			'restaurants.update declared a v.id("_storage") argument. Branding images ' +
				"must go through setBrandingImage, which authorizes before touching the " +
				"bytes — see TAVLI-68 for what a client-supplied storageId costs."
		).toBe(false);
	});
});

/**
 * Extract the `v.union(...)` immediately following `marker`, balanced parens
 * included. Slicing to the next `"),"` instead lands inside `v.literal("inter")`
 * and silently truncates the declaration being checked — which would make these
 * guards pass on an empty string.
 */
function unionAfter(source: string, marker: string): string {
	const markerAt = source.indexOf(marker);
	if (markerAt === -1) return "";
	const open = source.indexOf("v.union(", markerAt);
	if (open === -1) return "";

	let depth = 0;
	for (let i = open + "v.union".length; i < source.length; i++) {
		if (source[i] === "(") depth++;
		else if (source[i] === ")") {
			depth--;
			if (depth === 0) return source.slice(open, i + 1);
		}
	}
	return "";
}

describe("the font union stays in sync with the registry", () => {
	it("declares exactly the registry's ids in the schema", () => {
		// The schema cannot import the registry's *values* into a `v.union` —
		// `v.literal` needs literal types — so the two are written out twice and
		// drift silently. A stored id the registry does not know resolves to the
		// system stack, so the failure mode is a manager picking a font and
		// getting nothing, with no error anywhere.
		const schema = readFileSync(join(__dirname, "schema.ts"), "utf8");
		const declaration = unionAfter(schema, "brandingFontId:");
		expect(declaration, "brandingFontId union not found in schema").not.toBe("");

		for (const id of BRAND_FONT_IDS) {
			expect(declaration, `schema is missing font id "${id}"`).toContain(`v.literal("${id}")`);
		}
		const literalCount = (declaration.match(/v\.literal\(/g) ?? []).length;
		expect(literalCount, "schema declares a font id the registry does not have").toBe(
			BRAND_FONT_IDS.length
		);
	});

	it("declares exactly the registry's ids on the update mutation", () => {
		const source = readFileSync(join(__dirname, "restaurants.ts"), "utf8");
		const declaration = unionAfter(source, "brandingFontId: v.optional(");
		expect(declaration, "brandingFontId union not found on restaurants.update").not.toBe("");

		for (const id of BRAND_FONT_IDS) {
			expect(declaration, `update mutation is missing font id "${id}"`).toContain(
				`v.literal("${id}")`
			);
		}
	});
});
