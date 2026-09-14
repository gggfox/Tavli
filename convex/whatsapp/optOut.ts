/**
 * Opt-out / opt-in keyword matching (WhatsApp Business Messaging Policy).
 *
 * Pure text logic, kept out of `processing.ts` for the same reason
 * `shortCode.ts` is: the inbound pipeline is a `"use node"` action, and the
 * matching rule deserves direct unit tests without the Twilio/LLM harness.
 *
 * The rule: a message revokes (or restores) consent only when the TRIMMED
 * MESSAGE IS the keyword — case- and accent-insensitive, trailing punctuation
 * tolerated. "alto" and "baja" are everyday Spanish words ("el volumen está
 * muy alto", "dar de baja mi reserva"), so a keyword buried in prose is
 * conversation, not consent — exactly the mistake a substring match would
 * make. Matched in `processing.ts` BEFORE the model, like
 * `extractConfirmationCode`: consent must never be a language-understanding
 * problem.
 */
import { WHATSAPP_OPT_IN_KEYWORDS, WHATSAPP_OPT_OUT_KEYWORDS } from "../constants";

export const OPT_KEYWORD = {
	OPT_OUT: "opt_out",
	OPT_IN: "opt_in",
} as const;

export type OptKeyword = (typeof OPT_KEYWORD)[keyof typeof OPT_KEYWORD];

/**
 * Punctuation that may wrap a keyword without changing what the diner meant.
 *
 * Stripped from BOTH ends. `¡` and `¿` are Spanish *opening* marks, so a
 * trailing-only strip never sees them — and "¡ALTO!" is exactly what a Mexican
 * diner sends, because iOS Spanish autocorrect inserts the opening mark for
 * them. Quotes are here for the same reason: someone echoing the word we told
 * them to send often quotes it.
 */
const EDGE_PUNCTUATION = /^[\s.,;:!?¡¿·…\-–—"'«»“”‘’]+|[\s.,;:!?¡¿·…\-–—"'«»“”‘’]+$/gu;

/**
 * Case-fold, strip accents, and drop punctuation at either end.
 *
 * Leading *words* are deliberately still NOT dropped — "por favor alto" stays
 * prose while "¡ALTO!" is the keyword. That distinction is the whole point:
 * only a message that IS the keyword opts someone out, and the asymmetry is
 * chosen on purpose. A missed opt-out is a WhatsApp policy violation; a false
 * positive only silences someone whose entire message was "¡alto!", which is
 * them saying stop anyway.
 */
function normalizeCandidate(body: string): string {
	return body
		.trim()
		.replace(EDGE_PUNCTUATION, "")
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toUpperCase();
}

/** Which consent transition, if any, this whole message is. */
export function matchOptKeyword(body: string): OptKeyword | null {
	const candidate = normalizeCandidate(body);
	if ((WHATSAPP_OPT_OUT_KEYWORDS as readonly string[]).includes(candidate)) {
		return OPT_KEYWORD.OPT_OUT;
	}
	if ((WHATSAPP_OPT_IN_KEYWORDS as readonly string[]).includes(candidate)) {
		return OPT_KEYWORD.OPT_IN;
	}
	return null;
}
