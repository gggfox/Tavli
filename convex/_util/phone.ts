/**
 * Canonical E.164 for customer contact phone numbers.
 *
 * A phone number is the whole identity of a reservation customer (ADR-011), and
 * `findUpcomingByPhone` resolves a booking through an exact index match on
 * `contact.phone`. Three sources write that field in three spellings — staff
 * type `811 490 6208`, the public form takes whatever is pasted, and WhatsApp
 * delivers `+5218114906208` — so without a single stored form the same human is
 * several unrelated customers, and the assistant can only ever find the
 * bookings it made itself.
 *
 * **Normalize confidently or not at all.** Every path here either produces a
 * number we are sure of or returns the input untouched. A mangled number is
 * strictly worse than an unmatched one: an unmatched number still reaches the
 * customer when staff ring it, and a wrong one reaches a stranger.
 *
 * Deliberately not a full libphonenumber. That library is ~150 kB of metadata
 * for a problem this product currently has in two countries, and the failure
 * mode here is "left alone", not "wrong".
 */

/**
 * Countries we can place a national number in, keyed by IANA timezone — the
 * only geographic field a Restaurant carries.
 *
 * A timezone that is not listed means we do not know the country, so a national
 * number from that restaurant is stored as typed rather than guessed at.
 */
const REGION_BY_TIMEZONE: Record<string, { callingCode: string; nationalDigits: number }> = {
	// Mexico
	"America/Mexico_City": { callingCode: "52", nationalDigits: 10 },
	"America/Monterrey": { callingCode: "52", nationalDigits: 10 },
	"America/Cancun": { callingCode: "52", nationalDigits: 10 },
	"America/Merida": { callingCode: "52", nationalDigits: 10 },
	"America/Tijuana": { callingCode: "52", nationalDigits: 10 },
	"America/Chihuahua": { callingCode: "52", nationalDigits: 10 },
	"America/Hermosillo": { callingCode: "52", nationalDigits: 10 },
	"America/Mazatlan": { callingCode: "52", nationalDigits: 10 },
	"America/Matamoros": { callingCode: "52", nationalDigits: 10 },
	"America/Ojinaga": { callingCode: "52", nationalDigits: 10 },
	"America/Bahia_Banderas": { callingCode: "52", nationalDigits: 10 },
	// United States & Canada (NANP)
	"America/New_York": { callingCode: "1", nationalDigits: 10 },
	"America/Chicago": { callingCode: "1", nationalDigits: 10 },
	"America/Denver": { callingCode: "1", nationalDigits: 10 },
	"America/Phoenix": { callingCode: "1", nationalDigits: 10 },
	"America/Los_Angeles": { callingCode: "1", nationalDigits: 10 },
	"America/Anchorage": { callingCode: "1", nationalDigits: 10 },
	"Pacific/Honolulu": { callingCode: "1", nationalDigits: 10 },
	"America/Toronto": { callingCode: "1", nationalDigits: 10 },
	"America/Vancouver": { callingCode: "1", nationalDigits: 10 },
	"America/Edmonton": { callingCode: "1", nationalDigits: 10 },
	"America/Winnipeg": { callingCode: "1", nationalDigits: 10 },
	"America/Halifax": { callingCode: "1", nationalDigits: 10 },
};

/** Matches `DEFAULT_RESTAURANT_TIMEZONE`, for restaurants that never set one. */
const FALLBACK_TIMEZONE = "America/Mexico_City";

/** E.164 allows 15 digits; below 8 nothing dialable exists. */
const MIN_E164_DIGITS = 8;
const MAX_E164_DIGITS = 15;

/**
 * WhatsApp reports Mexican mobiles with a legacy `1` after the country code
 * (`+52 1 811 490 6208`), a carrier-era marker Mexico dropped for dialling in
 * 2019. Applied to any `+52 1` + 10 digits, whatever the restaurant's country,
 * because the artifact travels with the number and not with the reader.
 *
 * Argentina is the mirror case and is deliberately untouched: WhatsApp reports
 * its mobiles as `+54 9 …` and there the `9` IS required internationally.
 */
function stripMexicanMobileOne(e164: string): string {
	const match = /^\+521(\d{10})$/.exec(e164);
	return match ? `+52${match[1]}` : e164;
}

function isPlausibleE164(e164: string): boolean {
	const digits = e164.slice(1);
	return digits.length >= MIN_E164_DIGITS && digits.length <= MAX_E164_DIGITS;
}

/**
 * Canonical form of a contact phone, or the input unchanged when it cannot be
 * placed confidently.
 *
 * `timezone` is the restaurant's IANA timezone, used only to decide which
 * country a *national* number belongs to. Numbers that already carry a country
 * code ignore it.
 */
export function normalizeContactPhone(raw: string, timezone: string | undefined): string {
	const trimmed = raw.trim();
	if (!trimmed) return "";

	// Keep only what could be part of a number. Anything else (letters, an
	// extension, a note staff typed in the field) makes this unplaceable.
	const compact = trimmed.replace(/[\s().-]/g, "");
	if (!/^\+?\d+$/.test(compact)) return trimmed;

	// `00` is the international prefix in both countries we handle, and in most
	// others — normalize it to `+` before anything else looks at the number.
	const international = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;

	if (international.startsWith("+")) {
		const canonical = stripMexicanMobileOne(international);
		return isPlausibleE164(canonical) ? canonical : trimmed;
	}

	// A national number. We can only prepend a country code if we know which
	// country the restaurant is in, and if the number is the length that country
	// actually uses — otherwise we would be inventing digits.
	const region = REGION_BY_TIMEZONE[timezone ?? FALLBACK_TIMEZONE];
	if (!region || international.length !== region.nationalDigits) return trimmed;

	const canonical = stripMexicanMobileOne(`+${region.callingCode}${international}`);
	return isPlausibleE164(canonical) ? canonical : trimmed;
}
