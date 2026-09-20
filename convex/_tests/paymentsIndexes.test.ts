/**
 * Structural guard for the `payments` indexes the stuck-payment sweep needs.
 *
 * The sweep (TAVLI-106) walks payments left in `processing` past a cutoff. It
 * must do that as a single bounded index range — a `filter` over the whole
 * table would grow with payment volume and, past a few thousand rows, hit the
 * per-function document-read limits. This test fails if `by_status_updated`
 * is dropped or its field order is changed, which is exactly what would turn
 * that range back into a scan.
 */
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { TABLE } from "../constants";

/**
 * Index definitions via `defineTable(...).indexes` — the same serialized form
 * `npx convex dev` pushes. `indexes` is not in the public types, hence the
 * cast through unknown. Mirrors `tableValidatorJson` in the purge-coverage
 * tests.
 */
function tableIndexes(tableName: string): { indexDescriptor: string; fields: string[] }[] {
	const def = (
		schema.tables as unknown as Record<
			string,
			{ indexes: { indexDescriptor: string; fields: string[] }[] }
		>
	)[tableName];
	expect(def, `schema.ts has no table "${tableName}"`).toBeDefined();
	return def.indexes;
}

describe("payments indexes", () => {
	it("indexes (status, updatedAt) so the stuck-payment sweep is a bounded range", () => {
		const index = tableIndexes(TABLE.PAYMENTS).find(
			(i) => i.indexDescriptor === "by_status_updated"
		);
		expect(index, "payments is missing the by_status_updated index").toBeDefined();
		expect(index!.fields).toEqual(["status", "updatedAt"]);
	});

	it("does not put the optional `kind` between status and updatedAt", () => {
		// (status, kind, updatedAt) would order rows by kind first, so a sweep
		// covering both order and tip payments would need one range per kind
		// value — and legacy rows, whose `kind` is undefined, would sort ahead
		// of every named kind in a fourth range that is easy to forget.
		const descriptors = tableIndexes(TABLE.PAYMENTS).map((i) => i.indexDescriptor);
		expect(descriptors).not.toContain("by_status_kind_updated");
	});
});
