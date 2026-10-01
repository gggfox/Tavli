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

function sourceFiles(dir: string, acc: string[] = [], pattern = /\.tsx$/): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sourceFiles(full, acc, pattern);
		else if (pattern.test(entry.name)) acc.push(full);
	}
	return acc;
}

/** App code that ships: `.ts`/`.tsx`, minus tests, generated routes and demo scaffolds. */
function shippedCode(): string[] {
	return sourceFiles(SRC, [], /\.tsx?$/).filter(
		(file) =>
			!/\.test\.tsx?$/.test(file) &&
			!file.endsWith("routeTree.gen.ts") &&
			!file.includes(join("routes", "demo"))
	);
}

/**
 * Every custom property the app defines: declared in a stylesheet, written into
 * CSS from code (the restaurant branding builds `--brand-*: …` strings), set on
 * an element with `style.setProperty("--…")`, or passed as a style-object key.
 */
function definedCustomProperties(): Set<string> {
	const names = new Set<string>();
	const declare = (text: string) => {
		for (const match of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) names.add(match[1]);
		for (const match of text.matchAll(/setProperty\(\s*["'`](--[a-zA-Z0-9-]+)/g))
			names.add(match[1]);
		for (const match of text.matchAll(/["'`](--[a-zA-Z0-9-]+)["'`]\s*\]?\s*:/g))
			names.add(match[1]);
	};
	for (const file of sourceFiles(SRC, [], /\.css$/)) declare(readFileSync(file, "utf-8"));
	for (const file of shippedCode()) declare(readFileSync(file, "utf-8"));
	return names;
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

	it("defines every custom property that code reads with var(--…)", () => {
		// The same silent failure one level down: a declaration whose `var()`
		// cannot resolve is dropped by the browser. `--destructive` (never
		// defined; the token is `--color-destructive`) left the reservation
		// timeline's double-booking block with no fill and no red border, and
		// `--bg-muted`, `--border-hover` and `--text-faint` did the same to a
		// focused calendar day, a hover border and a status colour. A fallback
		// (`var(--x, white)`) is not an excuse either: it hard-codes a colour
		// that ignores the theme and the restaurant's branding.
		const defined = definedCustomProperties();
		const offenders: string[] = [];

		for (const file of shippedCode()) {
			const contents = readFileSync(file, "utf-8");
			// `var(--x)` in styles and arbitrary classes, and Tailwind v4's
			// `ring-(--x)` shorthand for the same thing.
			const references = [
				...contents.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g),
				...contents.matchAll(/[a-z]-\((--[a-zA-Z0-9-]+)\)/g),
			];
			for (const match of references) {
				if (defined.has(match[1])) continue;
				offenders.push(`${file.replace(SRC, "src")}: ${match[1]}`);
			}
		}

		expect([...new Set(offenders)]).toEqual([]);
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
