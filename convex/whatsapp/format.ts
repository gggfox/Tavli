/**
 * Markdown → WhatsApp text conversion.
 *
 * WhatsApp is not Markdown: bold is `*one asterisk*` (not `**two**`), italic is
 * `_underscores_`, strikethrough is `~one tilde~`, and there is no heading,
 * inline-code or `[label](url)` syntax at all — unsupported markers are shown to
 * the customer verbatim, which is exactly what a stray `### Carnes` did before
 * this module existed.
 *
 * `llm.ts` already tells the model to write WhatsApp syntax; this is the
 * deterministic backstop for when it slips back into Markdown anyway. Pure and
 * synchronous, so it unit-tests without a deployment.
 */

import { WHATSAPP_MAX_INBOUND_BODY_CHARS, WHATSAPP_MAX_OUTBOUND_BODY_CHARS } from "../constants";

/** Blank-line runs longer than this read as a gap in a chat bubble. */
const MAX_CONSECUTIVE_NEWLINES = 2;

/**
 * Truncate to `maxChars` *code points*.
 *
 * `String.prototype.slice` counts UTF-16 code units, so slicing mid-surrogate
 * splits an emoji into a lone surrogate — which Twilio rejects and which would
 * corrupt the stored body. Menu replies are full of emoji, so iterate code
 * points instead.
 */
function truncateCodePoints(text: string, maxChars: number): string {
	const chars = Array.from(text);
	if (chars.length <= maxChars) return text;
	return chars.slice(0, maxChars).join("");
}

/**
 * Defensive bound on inbound customer text before it is stored or replayed to
 * the model. Enforces `WHATSAPP_MAX_INBOUND_BODY_CHARS`, which was declared but
 * never applied — an unbounded body can dominate the prompt and push the system
 * prompt out of the model's attention.
 */
export function clampInboundBody(raw: string): string {
	return truncateCodePoints(raw, WHATSAPP_MAX_INBOUND_BODY_CHARS);
}

/**
 * Bound an outbound reply to what Twilio will accept, breaking at the last
 * whitespace inside the limit so a reply never ends mid-word, and marking the
 * cut with an ellipsis. Applied before the send so the delivered message and
 * the stored row are identical.
 */
export function clampOutboundBody(text: string, limit = WHATSAPP_MAX_OUTBOUND_BODY_CHARS): string {
	const chars = Array.from(text);
	if (chars.length <= limit) return text;

	// Reserve one code point for the ellipsis.
	const budget = limit - 1;
	const clipped = chars.slice(0, budget).join("");
	const lastBreak = clipped.search(/\s+\S*$/);
	// Only honour a word boundary that keeps most of the budget; otherwise a
	// single long token would collapse the reply to almost nothing.
	const body = lastBreak > budget / 2 ? clipped.slice(0, lastBreak) : clipped;
	return `${body.trimEnd()}…`;
}

/**
 * Convert model output to WhatsApp-safe text. Idempotent: already-converted
 * text passes through unchanged, so it is safe to apply on a retry path.
 */
export function toWhatsappText(input: string): string {
	if (!input) return "";

	// Keep ``` blocks verbatim — WhatsApp renders them as monospace, and their
	// contents must not be read as emphasis.
	const segments = input.replace(/\r\n?/g, "\n").split(/(```[\s\S]*?```)/g);
	const converted = segments
		.map((segment) => (segment.startsWith("```") ? segment : convertSegment(segment)))
		.join("");

	return converted.replace(/\n{3,}/g, "\n".repeat(MAX_CONSECUTIVE_NEWLINES)).trim();
}

function convertSegment(segment: string): string {
	return segment
		.split("\n")
		.map(convertBlockLine)
		.filter((line): line is string => line !== null)
		.join("\n");
}

/** Returns `null` for lines that have no WhatsApp equivalent and are dropped. */
function convertBlockLine(line: string): string | null {
	// Horizontal rule. Checked before the list and emphasis rules so `***` is
	// not mistaken for a bullet or an unterminated bold marker.
	if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return null;

	// ATX heading → a bold line, the closest thing WhatsApp has. Any emphasis
	// the model already put inside the heading is stripped, otherwise the
	// asterisks nest and both markers render literally.
	const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
	if (heading) {
		const text = convertInline(heading[1]).replace(/\*/g, "").trim();
		return text ? `*${text}*` : null;
	}

	// Unordered list marker → a literal bullet, which needs no client support
	// and disambiguates `* item` from italic. Numbered lists are left alone;
	// WhatsApp renders those natively.
	return convertInline(line.replace(/^(\s*)[-*+][ \t]+/, "$1• ")).trimEnd();
}

function convertInline(text: string): string {
	return (
		text
			// The photo is sent as Twilio media, so keep only the alt text.
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
			// WhatsApp auto-links bare URLs but shows `[label](url)` as-is.
			.replace(/\[([^\]]*)\]\(\s*<?([^)\s]+)>?[^)]*\)/g, (_match, label: string, url: string) => {
				const trimmed = label.trim();
				return trimmed && trimmed !== url ? `${trimmed}: ${url}` : url;
			})
			.replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
			// Bold+italic first, before the narrower rules below eat its markers.
			.replace(/\*\*\*(?=\S)([^\n]*?\S)\*\*\*/g, "*_$1_*")
			.replace(/___(?=\S)([^\n]*?\S)___/g, "*_$1_*")
			// A lone `*text*` is deliberately left alone: it is already valid
			// WhatsApp (bold), so it leaks no raw markers. Rewriting it to
			// `_text_` would also demote every bold the prompt asked the model
			// for — and would make this function non-idempotent. Markdown italic
			// therefore arrives as bold, which keeps the emphasis either way.
			.replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "*$1*")
			.replace(/(?<![_\w])__(?=\S)([^\n]*?\S)__(?!\w)/g, "*$1*")
			.replace(/~~(?=\S)([^\n]*?\S)~~/g, "~$1~")
			// No inline monospace in WhatsApp (``` blocks are preserved upstream).
			.replace(/`([^`\n]+)`/g, "$1")
			// Markdown escapes are meaningless once the syntax is gone. Last, so
			// an escaped marker is never re-read as emphasis by the rules above.
			.replace(/\\([\\`*_{}[\]()#+\-.!~>|])/g, "$1")
	);
}

/**
 * Break a reply into consecutive WhatsApp messages.
 *
 * One message cannot hold a real menu — 64 items is several thousand
 * characters against a 1,600-character ceiling — so a single clamped send left
 * the assistant unable to answer "show me everything" no matter how it was
 * prompted. Splitting is the only thing that makes that request answerable.
 *
 * Breaks at a newline where possible so a dish and its price are never severed,
 * falls back to a space, and only cuts mid-token when a single run of text is
 * longer than the limit. `maxParts` bounds a runaway reply: the final part is
 * clamped and marked, so the customer sees that it stopped rather than assuming
 * they were shown everything.
 */
export function splitOutboundBody(text: string, limit: number, maxParts: number): string[] {
	const chars = Array.from(text);
	if (chars.length <= limit) return [text];

	const parts: string[] = [];
	let rest = text;

	while (Array.from(rest).length > limit && parts.length < maxParts - 1) {
		const window = Array.from(rest).slice(0, limit).join("");
		// Prefer the last line break, then the last space. `> limit / 2` keeps a
		// break from collapsing a part to almost nothing when an early newline is
		// the only candidate.
		let cut = window.lastIndexOf("\n");
		if (cut <= limit / 2) cut = window.lastIndexOf(" ");
		if (cut <= limit / 2) cut = limit;

		parts.push(window.slice(0, cut).trimEnd());
		rest = Array.from(rest)
			.slice(cut)
			.join("")
			.replace(/^[ \n]+/, "");
	}

	parts.push(clampOutboundBody(rest, limit));
	return parts.filter((p) => p.length > 0);
}
