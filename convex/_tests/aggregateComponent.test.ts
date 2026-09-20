/**
 * The aggregate component mounts (TAVLI-108).
 *
 * `convex/convex.config.ts` registers `@convex-dev/aggregate`, and codegen
 * turns that registration into `components.aggregate` in `_generated/api`.
 * Nothing defines an aggregate yet, so the only thing worth asserting is the
 * plumbing: the component is installed, convex-test can register its schema
 * and modules, and a call into it returns the empty aggregate rather than
 * "Component ... is not registered".
 *
 * This is the test that fails first if the component is dropped from
 * `convex.config.ts`, if codegen is not re-run after a registration changes,
 * or if a `convex` upgrade parts ways with the component's peer range.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import aggregateComponent from "@convex-dev/aggregate/test";
import { components } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

describe("aggregate component", () => {
	it("is registered and answers an aggregate query with an empty tree", async () => {
		const t = convexTest(schema, modules);
		aggregateComponent.register(t);

		const total = await t.run(async (ctx) =>
			ctx.runQuery(components.aggregate.btree.aggregateBetween, {})
		);

		expect(total).toEqual({ count: 0, sum: 0 });
	});
});
