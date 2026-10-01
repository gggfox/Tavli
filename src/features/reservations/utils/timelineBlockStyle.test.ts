import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	getStatusToneStyle,
	type StatusTone,
} from "@/global/components/StatusFilterChips/statusPalette";
import { getTimelineBlockStyle } from "./timelineBlockStyle";

/** Every custom property the app's stylesheets define. */
function definedCustomProperties(): Set<string> {
	const dir = join(__dirname, "../../../global/styles");
	const names = new Set<string>();
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".css"))) {
		const css = readFileSync(join(dir, file), "utf8");
		for (const match of css.matchAll(/(--[\w-]+)\s*:/g)) names.add(match[1]);
	}
	return names;
}

/** `var(--x)` references in a style's values, fallbacks included. */
function referencedCustomProperties(style: object): string[] {
	return Object.values(style).flatMap((value) =>
		[...String(value).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1])
	);
}

const TONES: StatusTone[] = ["info", "warning", "urgent", "success", "danger", "neutral"];

describe("getTimelineBlockStyle", () => {
	const defined = definedCustomProperties();

	it.each(
		TONES.flatMap((tone) =>
			[false, true].flatMap((isColliding) =>
				[false, true].map((isDimmed) => ({ tone, isColliding, isDimmed }))
			)
		)
	)(
		"only references theme variables that exist ($tone, colliding: $isColliding, dimmed: $isDimmed)",
		({ tone, isColliding, isDimmed }) => {
			// An undefined variable makes the browser drop the whole declaration:
			// that is how the double-booking highlight lost its fill and border.
			const style = getTimelineBlockStyle({
				palette: getStatusToneStyle(tone),
				isColliding,
				isDimmed,
			});
			const missing = referencedCustomProperties(style).filter((name) => !defined.has(name));
			expect(missing).toEqual([]);
		}
	);

	it("draws a double booking in the danger palette whatever the status", () => {
		const danger = getStatusToneStyle("danger");
		const style = getTimelineBlockStyle({
			palette: getStatusToneStyle("success"),
			isColliding: true,
			isDimmed: false,
		});
		expect(style.backgroundColor).toBe(danger.tintedBg);
		expect(style.borderColor).toBe(danger.fg);
		// Full-contrast text, not red on red.
		expect(style.color).toBe("var(--color-foreground)");
	});

	it("gives a cancelled or no-show block a neutral border, not its status colour", () => {
		const style = getTimelineBlockStyle({
			palette: getStatusToneStyle("danger"),
			isColliding: false,
			isDimmed: true,
		});
		expect(style.borderColor).toBe("var(--color-border)");
	});
});
