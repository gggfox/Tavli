/**
 * Field-level purge guard for blobs hanging off the restaurants row (TAVLI-96).
 *
 * `restaurantPurgeCoverage.test.ts` is the table-level guard: it asserts every
 * table *referencing* restaurants is claimed by the purge. It cannot cover
 * this, and the reason is structural rather than an oversight — it filters
 * with `name !== TABLE.RESTAURANTS`, because the restaurants row is the thing
 * being purged rather than a reference to it. So a `v.id("_storage")` field
 * added to that row is invisible to it.
 *
 * The failure mode is silent and permanent. A branding blob is referenced by
 * exactly one column on exactly one row; delete the row without deleting the
 * blob and nothing anywhere can ever find the file again. No error, no
 * orphan-row report, a green suite, and storage that grows forever.
 *
 * This test walks the *schema validator* rather than a hand-kept list, so a
 * fifth image slot added next year is covered the moment it is declared.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRANDING_IMAGE_SLOTS, BRANDING_SLOT_SPECS } from "./brandingImageHelpers";
import schema from "./schema";
import { TABLE } from "./constants";

/** Validator JSON for a table, as `npx convex dev` serializes it. */
function tableValidatorJson(tableName: string): unknown {
	const def = (schema.tables as unknown as Record<string, { validator: { json: unknown } }>)[
		tableName
	];
	expect(def, `schema.ts has no table "${tableName}"`).toBeDefined();
	return def.validator.json;
}

/**
 * Every field name on a table whose validator is `v.id("_storage")`, including
 * optional ones (which the serializer wraps in a union with null).
 */
function storageFields(node: unknown, path: string[] = [], found: string[] = []): string[] {
	if (Array.isArray(node)) {
		for (const item of node) storageFields(item, path, found);
		return found;
	}
	if (node === null || typeof node !== "object") return found;
	const obj = node as Record<string, unknown>;

	if (obj.type === "id" && obj.tableName === "_storage" && path.length > 0) {
		found.push(path[path.length - 1]);
	}
	// `value` holds a field's validator under `{ type: "object", value: {...} }`.
	if (obj.type === "object" && obj.value && typeof obj.value === "object") {
		for (const [key, value] of Object.entries(obj.value as Record<string, unknown>)) {
			storageFields(value, [...path, key], found);
		}
		return found;
	}
	for (const value of Object.values(obj)) storageFields(value, path, found);
	return found;
}

const PURGE_SOURCE = readFileSync(join(__dirname, "restaurantPurge.ts"), "utf8");
const restaurantStorageFields = [...new Set(storageFields(tableValidatorJson(TABLE.RESTAURANTS)))];

describe("branding blobs are purged with the restaurant", () => {
	it("finds the storage fields it is supposed to be guarding", () => {
		// Self-check. If the validator-walk silently returned nothing, every
		// assertion below would pass vacuously and the guard would be theatre.
		expect(
			restaurantStorageFields.length,
			"the schema walk found no _storage fields on restaurants — the guard below would pass vacuously"
		).toBeGreaterThanOrEqual(BRANDING_IMAGE_SLOTS.length);
	});

	it("accounts for every _storage field declared on the restaurants row", () => {
		// Two ways to be covered, because the purge deletes branding blobs by
		// *iterating the slot registry* rather than naming columns — which is
		// the better implementation, since a fifth slot is then purged the day
		// it is declared, with no second edit to remember.
		//
		// So a field passes if the registry covers it, or if the purge names it
		// outright. Anything else is a blob with no route to deletion.
		const registryColumns = new Set(
			BRANDING_IMAGE_SLOTS.map((slot) => BRANDING_SLOT_SPECS[slot].columns.storageId)
		);

		for (const field of restaurantStorageFields) {
			const coveredByRegistry = registryColumns.has(field);
			const namedDirectly = PURGE_SOURCE.includes(field);
			expect(
				coveredByRegistry || namedDirectly,
				`restaurants.${field} is an _storage field with no route to deletion: it is neither a ` +
					`branding slot in BRANDING_SLOT_SPECS (which restaurantPurge.ts iterates) nor ` +
					`mentioned in restaurantPurge.ts. Deleting the row without deleting the blob ` +
					`orphans it permanently — nothing else references it, so nothing can ever find it ` +
					`again, and the existing table-level coverage guard skips the restaurants root.`
			).toBe(true);
		}
	});

	it("routes them through storage.delete, not merely a mention", () => {
		// The check above is satisfied by a comment. This one asserts the
		// purge actually walks the slots and deletes.
		expect(PURGE_SOURCE).toContain("BRANDING_IMAGE_SLOTS");
		expect(PURGE_SOURCE).toContain("ctx.storage.delete(storageId)");
	});

	it("counts the deletions, so the audit event does not under-report", () => {
		// `storageFilesDeleted` is the only record of what a purge removed —
		// deleting without incrementing makes the audit trail claim fewer
		// files than were destroyed.
		const loop = PURGE_SOURCE.slice(
			PURGE_SOURCE.indexOf("for (const slot of BRANDING_IMAGE_SLOTS)"),
			PURGE_SOURCE.indexOf("// Invitations can span")
		);
		expect(loop, "the branding purge loop was not found").not.toBe("");
		expect(loop).toContain("storageFilesDeleted++");
	});

	it("covers exactly the slots the helper declares", () => {
		// Catches the reverse drift: a slot removed from the registry but left
		// in the schema still holds blobs that need purging.
		const slotColumns = BRANDING_IMAGE_SLOTS.map(
			(slot) => BRANDING_SLOT_SPECS[slot].columns.storageId
		);
		for (const column of slotColumns) {
			expect(
				restaurantStorageFields,
				`${column} is a declared slot but not an _storage field in the schema`
			).toContain(column);
		}
	});
});
