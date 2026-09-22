/**
 * Test-only files under `convex/` must stay out of the Convex bundle.
 *
 * A leading `_` on a directory buys nothing: Convex's bundler walks
 * `convex/_tests/**` like any other path. What it skips is a file whose
 * basename holds more than one dot — which is the real reason `*.test.ts`
 * never reaches a deployment. A helper named `stripeMock.ts` therefore gets
 * bundled, and because it imports `vitest`, `npx convex codegen` dies on it
 * with "Vitest failed to access its internal state". That is how this rule was
 * found (TAVLI-108).
 *
 * Ten Stripe PRs stack on this branch and will add fixtures of their own, so
 * the rule is enforced here rather than left to whoever next runs codegen.
 */
import { describe, expect, it } from "vitest";

/**
 * Every `.ts` file under `convex/_tests/`, keyed by path relative to this
 * directory. Lazy: the guard reads names, never module contents — importing a
 * fixture here would defeat the point.
 */
const testDirectoryFiles = import.meta.glob("./**/*.ts", { eager: false });

/**
 * Already on the deployment and harmless there: it imports no vitest, only
 * Convex APIs, so the bundler analyses it fine. Renaming it is a separate
 * change (it would touch every suite that enables the reservations flag), and
 * nothing is broken while it waits.
 */
const GRANDFATHERED = ["./helpers/reservationsFlag.ts"];

const RULE =
	"Convex bundles any file under convex/ whose basename has a single dot; " +
	"test-only helpers must be named *.fixture.ts / *.helper.ts";

describe("convex bundle safety", () => {
	it("names every test-only helper under convex/_tests so the bundler skips it", () => {
		const offenders = Object.keys(testDirectoryFiles)
			.filter((path) => !path.endsWith(".test.ts"))
			.filter((path) => !GRANDFATHERED.includes(path))
			.filter((path) => {
				const base = path.split("/").pop()!;
				return (base.match(/\./g) ?? []).length <= 1;
			});

		expect(offenders, RULE).toEqual([]);
	});

	it("globs the directory at all — an empty glob would pass vacuously", () => {
		expect(Object.keys(testDirectoryFiles).length).toBeGreaterThan(0);
	});
});
