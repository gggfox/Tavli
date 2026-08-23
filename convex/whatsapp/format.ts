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

import {
	WHATSAPP_CONFIRMATION_CODE_DIGITS,
	WHATSAPP_MAX_INBOUND_BODY_CHARS,
	WHATSAPP_MAX_OUTBOUND_BODY_CHARS,
} from "../constants";

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

/**
 * Remove anything shaped like a confirmation code from text the model wrote or
 * will be shown.
 *
 * The model never legitimately holds a code — codes travel only in the
 * server-composed notice — so a code-shaped token in its prose is fabricated,
 * and a code-shaped token in replayed history is a worked example it will
 * imitate. Both directions were observed: it reused a spent code a customer had
 * sent back, and it re-invented a fresh one from its own earlier fabrication.
 * The shape is the one `extractConfirmationCode` matches, so the two agree on
 * what a code looks like.
 *
 * Applied to the model's output before it is sent or stored, and to every
 * replayed message. Not applied to the notice lines, which carry the real code.
 */
export function redactConfirmationCodes(text: string): string {
	return tidyAfterRedaction(
		text.replace(new RegExp(`(?<!\\d)\\d{${WHATSAPP_CONFIRMATION_CODE_DIGITS}}(?!\\d)`, "g"), "")
	);
}

/**
 * Close the holes a redaction leaves behind, so the customer never sees the
 * seam. Shared by every redactor: the model wraps the thing it invented in
 * emphasis (`*281437*`, `*https://…*`), and with the middle gone the empty pair
 * would reach the customer as a stray `**`.
 */
function tidyAfterRedaction(text: string): string {
	return text
		.replace(/([*_~])\s*\1/g, "")
		.replace(/[ \t]{2,}/g, " ")
		.replace(/ ([.,;:!?)])/g, "$1")
		.trim();
}

/**
 * Link-shaped tokens the model can legitimately write, in the order they are
 * tried. A scheme or a `www.` prefix is unambiguous, so both are matched
 * case-insensitively.
 */
const SCHEME_URL = /(?<![A-Za-z0-9])(?:https?|ftp):\/\/[^\s<>]+/gi;
const WWW_URL = /(?<![A-Za-z0-9.])www\.[^\s<>]+/gi;

/**
 * Hosts a fabricated link is plausibly built from. Deliberately an allowlist,
 * not `[a-z]{2,}`: a generic suffix turns "tacos.Tenemos" — a missing space
 * after a period, which models produce constantly — into a "host" and eats two
 * real words.
 *
 * The allowlist is split by how a suffix behaves when it is NOT a suffix.
 * `PLAIN_TLDS` cannot begin a word in either of the bot's languages, so
 * "gracias.com" can only be a host. `WORD_SHAPED_TLDS` can: `es`, `me` and `us`
 * are among the most frequent words in Spanish and English, and `app`, `store`,
 * `online` and `tv` are ordinary nouns — so "postre.me" is far likelier to be a
 * missing space than a domain, and `BARE_HOST_URL` below demands corroboration
 * before it deletes one.
 */
const PLAIN_TLDS = "com|org|biz|io|co|ai|xyz|ly|gl|cc|mx|uk|ca";
const WORD_SHAPED_TLDS = "net|info|app|dev|me|link|page|site|online|store|shop|tv|es|us";
const LINK_TLDS = `${PLAIN_TLDS}|${WORD_SHAPED_TLDS}`;

/** One DNS label, and the port/path tail a host may carry. */
const HOST_LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?";
const HOST_TAIL = "(?::\\d{2,5})?(?:/[^\\s<>]*)?";
/** The tail that *proves* a host: an explicit port, a path, or both. */
const HOST_TAIL_REQUIRED = "(?::\\d{2,5}(?:/[^\\s<>]*)?|/[^\\s<>]*)";

/**
 * A bare host (`tavliai.com/r/x/es/menu`), with an optional port and path.
 *
 * The TLD is matched CASE-SENSITIVELY in lower case, which is what stops
 * "bueno.Me gusta" and "delicioso.Es lo mejor" from reading as hosts while
 * still catching "Tavli.com". The lookbehind keeps the match off the domain
 * half of an email address and off the tail of a longer host.
 *
 * Case alone is not enough, because the typo this guards against also occurs in
 * lower case: "el postre.me encanta" would otherwise lose *two* real words with
 * nothing left to mark the hole. So a `label.tld` pair whose TLD is word-shaped
 * is only read as a host when something corroborates it —
 *
 *   1. two or more labels before the TLD (`pedidos.taqueria.online`), or
 *   2. an explicit port or path (`postre.me/tacos`, `tavliai.es:8080`), or
 *   3. a TLD that cannot be a word at all (`tavliai.com`, `taqueria.mx`).
 *
 * A missing space after a period produces none of the three, and every link the
 * model has actually been seen to invent produces at least one. What slips
 * through is a bare `brand.<word-shaped-tld>` with no path — rare, and the far
 * cheaper error: an unhelpful link beats a mangled sentence, and the scheme and
 * `www.` forms above still strip unconditionally.
 */
const BARE_HOST_URL = new RegExp(
	`(?<![\\w@./-])(?:` +
		`(?:${HOST_LABEL}\\.){2,}(?:${LINK_TLDS})(?![A-Za-z0-9-])${HOST_TAIL}` +
		`|${HOST_LABEL}\\.(?:${LINK_TLDS})(?![A-Za-z0-9-])${HOST_TAIL_REQUIRED}` +
		`|${HOST_LABEL}\\.(?:${PLAIN_TLDS})(?![A-Za-z0-9-])${HOST_TAIL}` +
		`)`,
	"g"
);

/**
 * Trailing characters that belong to the sentence, not to the link, so they are
 * put back. The emphasis markers are here so that `*https://…*` gives its
 * closing `*` back and `tidyAfterRedaction` can collapse the now-empty pair —
 * dropping it instead would strand the opening one in the customer's message.
 */
const TRAILING_PUNCTUATION = /[.,;:!?)\]'"»…*_~]+$/;

function dropLink(match: string): string {
	return TRAILING_PUNCTUATION.exec(match)?.[0] ?? "";
}

/**
 * Remove anything link-shaped from text the model wrote.
 *
 * The model has **no legitimate URL to send**. Dish photos ride as Twilio media
 * attachments, and every real link — the menu page among them — is composed by
 * the server and appended as a notice, which the model never sees. So a
 * link-shaped token in its prose is invented by definition, and a customer who
 * taps it lands nowhere.
 *
 * This is the same structural move as `redactConfirmationCodes`, and for the
 * same reason: within one week the model fabricated a confirmation code, then
 * re-fabricated one from its own earlier output, through three separate paths.
 * Every fix that held was structural — strip it, do not replay it. Every fix
 * that was an instruction in the system prompt failed.
 *
 * Applied to the model's output only. Inbound customer text is left alone: a
 * diner pasting a link is real content, and stripping the model's output is
 * terminal anyway, so nothing fabricated can reach the customer regardless of
 * what sits in the history.
 */
export function redactUrls(text: string): string {
	return tidyAfterRedaction(
		text.replace(SCHEME_URL, dropLink).replace(WWW_URL, dropLink).replace(BARE_HOST_URL, dropLink)
	);
}
