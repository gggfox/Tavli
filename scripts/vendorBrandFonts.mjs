#!/usr/bin/env node
/**
 * Copy the curated brand fonts out of node_modules into `public/fonts/` (TAVLI-88).
 *
 *   node scripts/vendorBrandFonts.mjs
 *
 * **Why vendor at all**, rather than letting the diner's browser fetch from
 * Google: a `<link>` to `fonts.gstatic.com` is an out-of-bound request fired
 * from every diner's phone on an anonymous page — an extra connection on the
 * TTFB critical path, and the diner's IP handed to a third party for the
 * privilege. Self-hosting means the only origin the page talks to is ours.
 *
 * **Why a script**, rather than copying by hand once: the files are committed,
 * so a hand-copy leaves no record of where they came from or how to redo it.
 * `pnpm update` on a fontsource package would otherwise silently diverge from
 * what is checked in. Re-run this, then `measureFontMetrics.mjs`, whenever a
 * font package moves.
 *
 * Both subsets of each family are copied. `latin` covers U+0000-00FF, which
 * includes the whole Latin-1 Supplement — á é í ó ú ñ ü ¿ ¡ — so **Spanish
 * needs no `latin-ext`**, and neither does English. `latin-ext` is carried for
 * the Central- and Eastern-European characters that show up in dish names
 * (pierogi, gnocchi alla Kraków) and is declared behind a `unicode-range`, so a
 * browser downloads it only for a page that actually contains one.
 */
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public/fonts");

/** Per-request budget: the bytes a diner on an English or Spanish page pays. */
const LATIN_BUDGET_BYTES = 50 * 1024;

const FAMILIES = [
	{ id: "inter", pkg: "@fontsource-variable/inter", slug: "inter" },
	{ id: "fraunces", pkg: "@fontsource-variable/fraunces", slug: "fraunces" },
	{ id: "spaceGrotesk", pkg: "@fontsource-variable/space-grotesk", slug: "space-grotesk" },
];

mkdirSync(OUT, { recursive: true });

let overBudget = false;
for (const family of FAMILIES) {
	for (const subset of ["latin", "latin-ext"]) {
		const from = join(ROOT, "node_modules", family.pkg, "files", `${family.slug}-${subset}-wght-normal.woff2`);
		const to = join(OUT, `${family.slug}-${subset}.woff2`);
		copyFileSync(from, to);

		const bytes = statSync(to).size;
		const kb = (bytes / 1024).toFixed(1);
		if (subset === "latin" && bytes > LATIN_BUDGET_BYTES) {
			overBudget = true;
			console.error(`  ✗ ${family.slug}-${subset}.woff2  ${kb} KB — over the ${LATIN_BUDGET_BYTES / 1024} KB per-request budget`);
		} else {
			console.log(`  ✓ ${family.slug}-${subset}.woff2  ${kb} KB`);
		}
	}
}

if (overBudget) {
	console.error("\nA latin subset exceeds the per-request budget. Pick a lighter face or subset further.");
	process.exit(1);
}
