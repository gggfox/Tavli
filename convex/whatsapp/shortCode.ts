/**
 * Restaurant short code — the deep-link router (ADR 012).
 *
 * Tavli is the sender on one shared WhatsApp number, so the Twilio "To" no
 * longer identifies anybody. What identifies the restaurant is a six-character
 * code carried in the wa.me prefilled text: `VRN-8F3`.
 *
 * Three properties are load-bearing, and each is tested:
 *
 * 1. **It reads like a booking reference, not a URL fragment.** WhatsApp drops
 *    the prefilled text straight into the diner's message box, visible and
 *    editable, so `?text=` has to look like something a person would send. That
 *    is why this is not the restaurant slug.
 * 2. **It survives editing.** The code is pulled back out of a sentence with a
 *    hyphen, a space, or nothing between the halves, in any case.
 * 3. **It never matches an ordinary word.** Every code carries a digit, so
 *    "quiero" and "cuenta" — both a 3+3 shape — are not candidates. Without
 *    that rule every message would hit the router table.
 *
 * It is a ROUTER, not a secret: see the note in `constants.ts`. Guessing one
 * reaches a restaurant's public assistant, which is exactly what the printed QR
 * on its tables offers anyway.
 */
import {
	WHATSAPP_SHORT_CODE_MAX_CANDIDATES,
	WHATSAPP_SHORT_CODE_PREFIX_LENGTH,
	WHATSAPP_SHORT_CODE_SUFFIX_ALPHABET,
	WHATSAPP_SHORT_CODE_SUFFIX_LENGTH,
	type WhatsappLocale,
} from "../constants";
import { getBotCopy } from "./copy";

const LETTERS = WHATSAPP_SHORT_CODE_SUFFIX_ALPHABET.replace(/[0-9]/g, "");
const DIGITS = WHATSAPP_SHORT_CODE_SUFFIX_ALPHABET.replace(/[^0-9]/g, "");
const VOWELS = new Set(["A", "E", "I", "O", "U"]);
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Separator characters the prefilled text decorates the code with. */
const DECORATION = "·•|–—-";

/**
 * Abbreviate a restaurant name: its initial, then its consonants.
 *
 * "Vernáculo" → `VRN`, "Taquería El Sol" → `TQR`. Consonants because that is
 * how people already shorten a name on a whiteboard, and because vowels carry
 * almost no distinguishing information across a list of restaurants.
 *
 * Diacritics are folded rather than dropped — "Ñoño" is an N, not a gap.
 * Returns fewer than `WHATSAPP_SHORT_CODE_PREFIX_LENGTH` characters (possibly
 * none) when the name has too few letters; `generateShortCode` pads.
 */
export function deriveShortCodePrefix(name: string): string {
	const letters = name
		.normalize("NFD")
		.replace(COMBINING_MARKS, "")
		.toUpperCase()
		.replace(/[^A-Z]/g, "");
	if (!letters) return "";

	let prefix = letters[0];
	for (let i = 1; i < letters.length && prefix.length < WHATSAPP_SHORT_CODE_PREFIX_LENGTH; i++) {
		if (!VOWELS.has(letters[i])) prefix += letters[i];
	}
	return prefix;
}

function pick(alphabet: string, random: () => number): string {
	const index = Math.min(alphabet.length - 1, Math.floor(random() * alphabet.length));
	return alphabet[index];
}

/**
 * Mint a code for a restaurant. `random` is injectable so the generator is
 * testable; callers pass `Math.random`, which is the right amount of ceremony
 * for a router.
 *
 * The suffix is forced to carry at least one digit. That is not entropy — it is
 * what keeps `extractShortCodeCandidates` from firing on Spanish prose.
 */
export function generateShortCode(name: string, random: () => number = Math.random): string {
	let prefix = deriveShortCodePrefix(name);
	while (prefix.length < WHATSAPP_SHORT_CODE_PREFIX_LENGTH) {
		prefix += pick(LETTERS, random);
	}

	const suffix: string[] = [];
	for (let i = 0; i < WHATSAPP_SHORT_CODE_SUFFIX_LENGTH; i++) {
		suffix.push(pick(WHATSAPP_SHORT_CODE_SUFFIX_ALPHABET, random));
	}
	if (!suffix.some((c) => DIGITS.includes(c))) {
		const position = Math.min(suffix.length - 1, Math.floor(random() * suffix.length));
		suffix[position] = pick(DIGITS, random);
	}

	return prefix + suffix.join("");
}

/** The canonical stored form: uppercase, no separator. */
export function normalizeShortCode(raw: string): string {
	return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** The form people read and retype: `VRN-8F3`. */
export function formatShortCode(code: string): string {
	const normalized = normalizeShortCode(code);
	return `${normalized.slice(0, WHATSAPP_SHORT_CODE_PREFIX_LENGTH)}-${normalized.slice(WHATSAPP_SHORT_CODE_PREFIX_LENGTH)}`;
}

const SHORT_CODE_SHAPE = new RegExp(
	`^[A-Z]{${WHATSAPP_SHORT_CODE_PREFIX_LENGTH}}[A-Z0-9]{${WHATSAPP_SHORT_CODE_SUFFIX_LENGTH}}$`
);

/** Whether a canonical string could be a code at all (shape only, no lookup). */
export function isShortCodeShape(code: string): boolean {
	return SHORT_CODE_SHAPE.test(code) && /[0-9]/.test(code.slice(WHATSAPP_SHORT_CODE_PREFIX_LENGTH));
}

const CANDIDATE_PATTERN = new RegExp(
	`\\b([A-Za-z]{${WHATSAPP_SHORT_CODE_PREFIX_LENGTH}})[-\\s]?([A-Za-z0-9]{${WHATSAPP_SHORT_CODE_SUFFIX_LENGTH}})\\b`,
	"g"
);

/**
 * Every code-shaped token in an inbound message, canonicalized and deduped.
 *
 * Returns a LIST rather than the first match on purpose: a message can contain
 * an accidental match ("Bar 4to · VRN-8F3"), and the router must let the
 * database decide which token is a route. That is also the line this feature
 * does not cross — Tavli never matches a restaurant *name* the diner typed
 * against every restaurant it knows, because that is an enumeration and
 * spoofing surface (ADR 012).
 */
export function extractShortCodeCandidates(body: string): string[] {
	const found = new Set<string>();
	for (const match of body.matchAll(CANDIDATE_PATTERN)) {
		const candidate = normalizeShortCode(`${match[1]}${match[2]}`);
		if (!isShortCodeShape(candidate)) continue;
		found.add(candidate);
		if (found.size >= WHATSAPP_SHORT_CODE_MAX_CANDIDATES) break;
	}
	return Array.from(found);
}

/**
 * Remove a code from a message body, along with the separator dot the deep link
 * decorated it with.
 *
 * Called only once the code has actually resolved to a restaurant, so a token
 * that merely looked like a code is left in the diner's words untouched. The
 * stored body and the model's context are both the stripped form: a routing
 * token is plumbing, and showing it to the model invites it to echo one back.
 */
export function stripShortCode(body: string, code: string): string {
	const normalized = normalizeShortCode(code);
	const prefix = normalized.slice(0, WHATSAPP_SHORT_CODE_PREFIX_LENGTH);
	const suffix = normalized.slice(WHATSAPP_SHORT_CODE_PREFIX_LENGTH);
	const pattern = new RegExp(`\\s*(?:[${DECORATION}]\\s*)?\\b${prefix}[-\\s]?${suffix}\\b`, "gi");
	// Only the horizontal gap the removed token left is tidied. A blanket `\s+`
	// collapse would flatten the line breaks in a diner's multi-line message,
	// which is their text, not our plumbing.
	return body
		.replace(pattern, " ")
		.replace(/[ \t]{2,}/g, " ")
		.replace(/[ \t]*\n[ \t]*/g, "\n")
		.trim();
}

/**
 * The sentence the wa.me link prefills. It has to read like something a person
 * would actually send, because WhatsApp shows it to the diner before they hit
 * send — a bare code would look like a scam.
 */
export function buildDeepLinkText(
	restaurantName: string,
	code: string,
	locale: WhatsappLocale
): string {
	return getBotCopy(locale).deepLinkPrefill(restaurantName, formatShortCode(code));
}

/**
 * The full `wa.me` entry point, or `null` when Tavli has no sender number
 * configured — a link to `wa.me/undefined` is worse than no link at all, so
 * every surface renders nothing instead.
 */
export function buildDeepLinkUrl(
	tavliNumber: string | undefined | null,
	restaurantName: string,
	code: string,
	locale: WhatsappLocale
): string | null {
	const digits = (tavliNumber ?? "").replace(/[^0-9]/g, "");
	if (!digits) return null;
	const text = buildDeepLinkText(restaurantName, code, locale);
	return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
