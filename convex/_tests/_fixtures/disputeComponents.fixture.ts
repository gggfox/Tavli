/**
 * Registering the dispute aggregate components with convex-test (TAVLI-102).
 *
 * `convex/convex.config.ts` mounts `@convex-dev/aggregate` three times — once
 * unnamed, once as `disputeFeesByMonth`, once as `disputeTotalsByRestaurant` —
 * and convex-test does not read `convex.config.ts`. A suite that touches any
 * mutation which records a dispute has to register them by hand, or the first
 * aggregate write fails with `Component "..." is not registered`.
 *
 * That is a footgun rather than a feature: any test that delivers a
 * `charge.dispute.*` event now needs this, including suites whose subject is
 * refunds and which only brush past a dispute. One helper, called in one line,
 * is what stops the next person rediscovering it from a stack trace inside the
 * component's B-tree.
 *
 * The `.fixture.ts` suffix is load-bearing — see `stripeMock.fixture.ts` for
 * why a single-dot basename under `_tests/` is bundled and pushed by Convex.
 */
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import aggregateComponent from "@convex-dev/aggregate/test";

/** Every aggregate instance `convex.config.ts` mounts, in the order it mounts them. */
export const AGGREGATE_COMPONENT_NAMES = [
	"aggregate",
	"disputeFeesByMonth",
	"disputeTotalsByRestaurant",
] as const;

/**
 * Register all three aggregate instances on a convex-test instance.
 *
 * Call immediately after `convexTest(schema, modules)`, before any mutation
 * runs — the component's storage is created lazily on first write, so a late
 * registration still fails.
 */
export function registerDisputeComponents(
	t: TestConvex<SchemaDefinition<GenericSchema, boolean>>
): void {
	for (const name of AGGREGATE_COMPONENT_NAMES) {
		aggregateComponent.register(t, name);
	}
}
