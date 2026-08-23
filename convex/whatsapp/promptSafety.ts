/**
 * Prompt-injection defences for values that reach the model.
 *
 * Pure and runtime-agnostic on purpose: `llm.ts` is `"use node"`, but `menu.ts`
 * runs in Convex's default runtime and shapes the same untrusted menu strings,
 * so neither can own this.
 */
/**
 * Neutralize a staff- or import-authored string before it reaches the prompt.
 *
 * `restaurantName` is editable in the admin UI and is interpolated into the
 * *system* prompt, the highest-trust position available — a name containing
 * newlines and a fake "RULES:" block would read as instructions. Menu names and
 * descriptions are worse: they come from `menuImport.ts` parsing an uploaded PDF
 * with an LLM, so a poisoned document would reach every customer of that
 * restaurant. Both are data, so both get flattened to a single line, stripped of
 * control characters and delimiter markers, and length-capped.
 */
export function sanitizePromptValue(raw: string, maxChars: number): string {
	const flattened = Array.from(raw)
		.map((c) => {
			const code = c.codePointAt(0)!;
			// Newlines and tabs become spaces so a value cannot open what looks like a
			// new rule line. Other C0/C1 controls are dropped. Checked by code point
			// rather than a character class, which keeps this source ASCII and avoids
			// eslint's no-control-regex (same approach as `menu.ts`).
			if (code === 0x0a || code === 0x0d || code === 0x09) return " ";
			if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return "";
			// Angle brackets and backticks would let a value close our delimiter or
			// open a code fence.
			if (c === "<" || c === ">" || c === "`") return "";
			return c;
		})
		.join("")
		.replace(/\s{2,}/g, " ")
		.trim();
	return Array.from(flattened).slice(0, maxChars).join("");
}

export const MAX_RESTAURANT_NAME_PROMPT_CHARS = 80;
export const MAX_MENU_FIELD_PROMPT_CHARS = 200;
