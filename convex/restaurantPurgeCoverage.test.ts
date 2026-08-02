/**
 * Structural guard for the restaurant hard-purge (TAVLI-66).
 *
 * Introspects `schema.ts` and asserts that every table linked to restaurants —
 * a `restaurantId` field anywhere in its validator, or any `v.id("restaurants")`
 * reference — is claimed by exactly one of the coverage lists in
 * `constants.ts`: deleted, patched, or exempt-with-reason. A new
 * restaurant-scoped table that nobody wires into the purge turns into a red
 * build here instead of silently orphaned rows (how `stripeDisputes` slipped
 * through for months).
 */
import { describe, expect, it } from "vitest";
import {
	RESTAURANT_PURGE_DELETED_TABLES,
	RESTAURANT_PURGE_EXEMPT_TABLES,
	RESTAURANT_PURGE_PATCHED_TABLES,
	TABLE,
} from "./constants";
import schema from "./schema";

/**
 * Validator JSON for a table via `defineTable(...).validator.json` — the same
 * serialized form `npx convex dev` pushes. `json` is not in the public types,
 * hence the cast through unknown.
 */
function tableValidatorJson(tableName: string): unknown {
	const def = (schema.tables as unknown as Record<string, { validator: { json: unknown } }>)[
		tableName
	];
	expect(def, `schema.ts has no table "${tableName}"`).toBeDefined();
	return def.validator.json;
}

/**
 * True when the validator JSON references restaurants: a field named
 * `restaurantId` at any nesting depth (covers plain fields, arrays of objects
 * like `userRoles.devSavedMembershipRoles`, and optional fields), or an id
 * validator pointing at the restaurants table under any field name (covers
 * `invitations.restaurantIds`).
 */
function referencesRestaurants(node: unknown): boolean {
	if (Array.isArray(node)) return node.some(referencesRestaurants);
	if (node === null || typeof node !== "object") return false;
	const obj = node as Record<string, unknown>;
	if (obj.type === "id" && obj.tableName === TABLE.RESTAURANTS) return true;
	return Object.entries(obj).some(
		([key, value]) => key === "restaurantId" || referencesRestaurants(value)
	);
}

const schemaTableNames = Object.keys(schema.tables);
const deletedTables: readonly string[] = RESTAURANT_PURGE_DELETED_TABLES;
const patchedTables: readonly string[] = RESTAURANT_PURGE_PATCHED_TABLES;
const exemptTables = Object.keys(RESTAURANT_PURGE_EXEMPT_TABLES);

describe("restaurant purge coverage", () => {
	it("accounts for every restaurant-linked table in schema.ts", () => {
		const linked = schemaTableNames.filter(
			(name) => name !== TABLE.RESTAURANTS && referencesRestaurants(tableValidatorJson(name))
		);
		// The guard only bites if detection works: the known link shapes must be found.
		expect(linked).toContain(TABLE.ORDERS);
		expect(linked).toContain(TABLE.INVITATIONS); // v.id("restaurants") inside an array
		expect(linked).toContain(TABLE.USER_ROLES); // nested string restaurantId

		const unaccounted = linked.filter(
			(name) =>
				!deletedTables.includes(name) &&
				!patchedTables.includes(name) &&
				!exemptTables.includes(name)
		);
		expect(
			unaccounted,
			`These tables carry restaurant-scoped data but the restaurant purge does not cover them. ` +
				`For each: add it to RESTAURANT_PURGE_DELETED_TABLES and implement its cascade in ` +
				`restaurantPurge.ts, add it to RESTAURANT_PURGE_PATCHED_TABLES with scoped patch logic, ` +
				`or document why it must survive in RESTAURANT_PURGE_EXEMPT_TABLES (convex/constants.ts).`
		).toEqual([]);
	});

	it("lists only real schema tables", () => {
		const unknown = [...deletedTables, ...patchedTables, ...exemptTables].filter(
			(name) => !schemaTableNames.includes(name)
		);
		expect(unknown, "purge coverage lists reference tables that no longer exist").toEqual([]);
	});

	it("keeps the coverage lists disjoint", () => {
		const all = [...deletedTables, ...patchedTables, ...exemptTables];
		const duplicates = all.filter((name, i) => all.indexOf(name) !== i);
		expect(duplicates, "a table may appear in only one purge coverage list").toEqual([]);
	});

	it("never lists the restaurants root itself", () => {
		// The restaurant row is deleted by executeHardPurge after the cascade, not
		// as a cascade entry.
		expect(deletedTables).not.toContain(TABLE.RESTAURANTS);
		expect(patchedTables).not.toContain(TABLE.RESTAURANTS);
		expect(exemptTables).not.toContain(TABLE.RESTAURANTS);
	});

	it("exempts every table only with a documented reason", () => {
		for (const [name, reason] of Object.entries(RESTAURANT_PURGE_EXEMPT_TABLES)) {
			expect(
				reason && reason.trim().length >= 20,
				`RESTAURANT_PURGE_EXEMPT_TABLES["${name}"] needs a real reason, not a placeholder`
			).toBe(true);
		}
	});
});
