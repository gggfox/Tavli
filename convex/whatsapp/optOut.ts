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
 * Case-fold, strip accents, and drop trailing punctuation — leading words are
 * deliberately NOT dropped, so "por favor alto" stays prose while "ALTO!!" is
 * still the keyword.
 */
function normalizeCandidate(body: string): string {
	return (
		body
			.trim()
			// Trailing punctuation/whitespace only: "Alta." is a keyword, "alto ahí" is not.
			.replace(/[\s.,;:!?¡¿·…\-–—]+$/u, "")
			.normalize("NFD")
			.replace(/\p{M}/gu, "")
			.toUpperCase()
	);
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
