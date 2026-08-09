import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tailwind resolves `bg-foo` against the `--color-foo` custom properties in
 * `theme.css`. A class naming a token that does not exist produces **no CSS at
 * all** — no error, no warning, just an element with no background. That is how
 * `bg-surface` reached production on three dialogs: the panels rendered fully
 * transparent over the page behind them and nothing failed.
 *
 * These tests pin the two halves of that failure: the tokens a class may name,
 * and the components that must actually carry a background.
 */

const SRC = join(process.cwd(), "src");
const THEME = join(SRC, "global/styles/theme.css");

/** Every `--color-*` custom property declared by the theme. */
function definedColorTokens(): Set<string> {
	const css = readFileSync(THEME, "utf-8");
	const tokens = new Set<string>();
	for (const match of css.matchAll(/--color-([a-z0-9-]+)\s*:/g)) tokens.add(match[1]);
	return tokens;
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sourceFiles(full, acc);
		else if (/\.tsx$/.test(entry.name)) acc.push(full);
	}
	return acc;
}

/**
 * Tailwind ships these without a theme token, so a class naming one is valid
 * even though `theme.css` never declares it: keywords, and the `bg-*` utilities
 * that set something other than colour (clipping, gradients, sizing, repeat).
 */
const BUILT_IN_BACKGROUNDS = new Set([
	"transparent",
	"current",
	"inherit",
	"white",
	"black",
	"none",
	"clip",
	"linear",
	"gradient",
	"radial",
	"conic",
	"cover",
	"contain",
	"center",
	"top",
	"bottom",
	"left",
	"right",
	"repeat",
	"fixed",
	"local",
	"scroll",
	"origin",
	"blend",
	"auto",
	"size",
	"position",
]);

/** `bg-blue-500`, `bg-amber-50` — Tailwind's own palette, not our tokens. */
function isPaletteShade(token: string): boolean {
	return /-\d+$/.test(token);
}

describe("theme tokens", () => {
	it("declares every colour that a bg-* class names", () => {
		const defined = definedColorTokens();
		const offenders: string[] = [];

		for (const file of sourceFiles(SRC)) {
			// TanStack's scaffold pages ship Tailwind demo markup we do not own.
			if (file.includes(join("routes", "demo"))) continue;
			const contents = readFileSync(file, "utf-8");
			// `(?<![-\w])` keeps the CSS variable `--bg-elevated` from reading as a
			// `bg-elevated` class.
			for (const match of contents.matchAll(/(?<![-\w])bg-([a-z][a-z0-9-]*)/g)) {
				const token = match[1];
				const [head] = token.split("-");
				if (BUILT_IN_BACKGROUNDS.has(token) || BUILT_IN_BACKGROUNDS.has(head)) continue;
				if (isPaletteShade(token)) continue;
				// `bg-primary/40`, `bg-warning-subtle` etc. resolve against the same
				// token list; the opacity suffix is stripped by the pattern already.
				if (defined.has(token)) continue;
				offenders.push(`${file.replace(SRC, "src")}: bg-${token}`);
			}
		}

		expect(offenders).toEqual([]);
	});

	it("gives every dialog panel an opaque background", () => {
		// A dialog renders in the top layer over arbitrary page content, so a
		// panel without a background is unreadable rather than merely plain.
		const panels = [
			"features/users/components/invites/InviteUserDialog.tsx",
			"features/users/components/invites/BulkInviteDialog.tsx",
			"features/menus/components/MenuImportDialog.tsx",
		];

		for (const panel of panels) {
			const contents = readFileSync(join(SRC, panel), "utf-8");
			expect(contents, panel).toMatch(/bg-background/);
		}
	});
});
