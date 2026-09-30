/**
 * When a menu item counts as priced — shared by the backend (ordering, the
 * WhatsApp menu) and the frontend (the diner menu, the menu editor's warning),
 * so all of them agree on which dishes a diner may see and order.
 *
 * `basePrice` is integer minor units and is required by the schema, so a dish
 * with no price is stored as `0`: that is what the AI menu import writes for
 * an item the source document shows without a price. A `0` price therefore
 * means "not priced yet", not "free" — shown to diners it read as `$0.00` and
 * could be ordered for nothing. Negative and non-finite values (`NaN`,
 * `Infinity`) are malformed data and are treated the same way.
 *
 * A genuinely free extra belongs in an option group (options may cost `0`),
 * not as a dish on the menu.
 */
export function hasListedPrice(basePrice: number | null | undefined): boolean {
	return typeof basePrice === "number" && Number.isFinite(basePrice) && basePrice > 0;
}

/**
 * The note older AI imports appended to an item's description when the source
 * menu showed no price (`"(price not listed)"`), in English regardless of the
 * menu's language. Unpriced items are now flagged in the menu editor instead,
 * so the note is stripped on import and by `migrations/stripPriceNotListedNote`.
 */
const PRICE_NOT_LISTED_NOTE = /\s*\(\s*price not listed\s*\)\s*/gi;

/**
 * `description` without the price-not-listed note, trimmed. Returns
 * `undefined` when nothing else was there, so an item whose whole description
 * was the note ends up with no description rather than an empty string.
 */
export function stripPriceNotListedNote(description: string | undefined): string | undefined {
	if (description === undefined) return undefined;
	const cleaned = description.replace(PRICE_NOT_LISTED_NOTE, " ").trim();
	return cleaned.length > 0 ? cleaned : undefined;
}
