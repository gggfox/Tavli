/**
 * Pure normalization and validation for a Restaurant's **Public profile** —
 * the diner-visible contact details: contact email, one phone number, and up
 * to five social links.
 *
 * Everything here normalizes on write and stores a canonical value. These
 * strings end up in `href` attributes on `/r/$slug`, a page anonymous diners
 * load, so the render surfaces must be able to interpolate them without any
 * further parsing or escaping. That means the checks below are a security
 * boundary, not a convenience: a stored value is treated as trusted by three
 * separate renderers (menu info block, receipt email, and the settings form).
 *
 * No imports on purpose — this module is exercised directly by unit tests and
 * imported by both `convex/restaurants.ts` and the settings form under `src/`
 * (the `feature → convex` direction the boundaries plugin allows).
 */

export const SOCIAL_PLATFORM = {
	INSTAGRAM: "instagram",
	FACEBOOK: "facebook",
	TIKTOK: "tiktok",
	X: "x",
	YOUTUBE: "youtube",
} as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORM)[keyof typeof SOCIAL_PLATFORM];

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
	SOCIAL_PLATFORM.INSTAGRAM,
	SOCIAL_PLATFORM.FACEBOOK,
	SOCIAL_PLATFORM.TIKTOK,
	SOCIAL_PLATFORM.X,
	SOCIAL_PLATFORM.YOUTUBE,
];

/**
 * Platform → the `restaurants` column that holds it. Typed as a literal union
 * rather than `string` because callers use it to index mutation args.
 */
export const SOCIAL_FIELD = {
	[SOCIAL_PLATFORM.INSTAGRAM]: "instagramUrl",
	[SOCIAL_PLATFORM.FACEBOOK]: "facebookUrl",
	[SOCIAL_PLATFORM.TIKTOK]: "tiktokUrl",
	[SOCIAL_PLATFORM.X]: "xUrl",
	[SOCIAL_PLATFORM.YOUTUBE]: "youtubeUrl",
} as const satisfies Record<SocialPlatform, string>;

export type SocialField = (typeof SOCIAL_FIELD)[SocialPlatform];

export const PUBLIC_PROFILE_ERROR = {
	SOCIAL_URL_INVALID: "ERROR_SOCIAL_URL_INVALID",
	SOCIAL_URL_WRONG_PLATFORM: "ERROR_SOCIAL_URL_WRONG_PLATFORM",
	SOCIAL_URL_SHORTLINK: "ERROR_SOCIAL_URL_SHORTLINK",
	SOCIAL_URL_INSECURE: "ERROR_SOCIAL_URL_INSECURE",
	PHONE_INVALID: "ERROR_INVALID_PHONE",
	PHONE_COUNTRY_CODE_REQUIRED: "ERROR_PHONE_COUNTRY_CODE_REQUIRED",
	WHATSAPP_WITHOUT_PHONE: "ERROR_WHATSAPP_WITHOUT_PHONE",
	SUPPORT_EMAIL_INVALID: "ERROR_INVALID_SUPPORT_EMAIL",
	ADDRESS_TOO_LONG: "ERROR_ADDRESS_TOO_LONG",
} as const;

export type PublicProfileErrorCode =
	(typeof PUBLIC_PROFILE_ERROR)[keyof typeof PUBLIC_PROFILE_ERROR];

export type NormalizeResult =
	| { readonly ok: true; readonly value: string }
	| { readonly ok: false; readonly code: PublicProfileErrorCode };

/** Diner-facing street address. Generous, but not a free-text dumping ground. */
export const MAX_ADDRESS_LENGTH = 240;

interface PlatformRule {
	/** Hosts accepted for this platform, after `www.`/`m.` are stripped. */
	readonly hosts: readonly string[];
	/** The host we store, regardless of which accepted host was pasted. */
	readonly canonicalHost: string;
	/**
	 * Shortlink hosts we reject rather than rewrite. These are opaque redirect
	 * namespaces — `fb.me/abc` does not mean `facebook.com/abc` — and since we
	 * only ever store the canonical form, guessing would silently point the
	 * restaurant's link at a different page or at nobody, unrecoverably.
	 */
	readonly shortlinkHosts: readonly string[];
	/** Accepted shape of `URL.pathname`, which is already percent-encoded. */
	readonly path: RegExp;
}

const PLATFORM_RULES: Record<SocialPlatform, PlatformRule> = {
	[SOCIAL_PLATFORM.INSTAGRAM]: {
		hosts: ["instagram.com", "instagr.am"],
		canonicalHost: "instagram.com",
		shortlinkHosts: [],
		path: /^\/[A-Za-z0-9._]{1,30}\/?$/,
	},
	[SOCIAL_PLATFORM.FACEBOOK]: {
		hosts: ["facebook.com"],
		canonicalHost: "facebook.com",
		shortlinkHosts: ["fb.me", "fb.com", "fb.watch"],
		// Pages, usernames, and the `pages/Name/12345` form.
		path: /^\/(?:pages\/[^/]+\/\d{1,25}|profile\.php|[A-Za-z0-9.-]{1,60})\/?$/,
	},
	[SOCIAL_PLATFORM.TIKTOK]: {
		hosts: ["tiktok.com"],
		canonicalHost: "tiktok.com",
		shortlinkHosts: ["vm.tiktok.com", "vt.tiktok.com"],
		path: /^\/@[A-Za-z0-9._]{1,24}\/?$/,
	},
	[SOCIAL_PLATFORM.X]: {
		// A restaurant that pasted a twitter.com link years ago keeps a working
		// link; the canonical rewrite means a diner never sees the dead brand.
		hosts: ["x.com", "twitter.com"],
		canonicalHost: "x.com",
		shortlinkHosts: ["t.co"],
		path: /^\/[A-Za-z0-9_]{1,15}\/?$/,
	},
	[SOCIAL_PLATFORM.YOUTUBE]: {
		hosts: ["youtube.com"],
		canonicalHost: "youtube.com",
		shortlinkHosts: ["youtu.be"],
		// Handles (@name), legacy /c/ and /user/, and /channel/UC…
		path: /^\/(?:@[A-Za-z0-9._-]{1,30}|c\/[A-Za-z0-9._-]{1,60}|user\/[A-Za-z0-9._-]{1,60}|channel\/UC[A-Za-z0-9_-]{20,30})\/?$/,
	},
};

function stripHostPrefix(host: string): string {
	const lower = host.toLowerCase();
	if (lower.startsWith("www.")) return lower.slice(4);
	if (lower.startsWith("m.")) return lower.slice(2);
	return lower;
}

/**
 * Normalize a pasted social link into the canonical `https://host/path` form we
 * store, or explain why it cannot be stored.
 *
 * An empty input is a successful clear — the caller decides what that means.
 */
export function normalizeSocialUrl(platform: SocialPlatform, raw: string): NormalizeResult {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return { ok: true, value: "" };

	const rule = PLATFORM_RULES[platform];

	// Accept what owners actually paste: a bare host, or a full URL. Anything
	// that already carries a scheme keeps it so we can reject non-http below
	// rather than silently prefixing `https://` onto `javascript:…`.
	const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;

	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		return { ok: false, code: PUBLIC_PROFILE_ERROR.SOCIAL_URL_INVALID };
	}

	if (url.protocol !== "https:" && url.protocol !== "http:") {
		return { ok: false, code: PUBLIC_PROFILE_ERROR.SOCIAL_URL_INSECURE };
	}
	// `https://instagram.com:pw@evil.com/` reads as Instagram to a human and
	// resolves to evil.com in a browser.
	if (url.username || url.password) {
		return { ok: false, code: PUBLIC_PROFILE_ERROR.SOCIAL_URL_INSECURE };
	}

	const host = stripHostPrefix(url.hostname);

	if (rule.shortlinkHosts.includes(host)) {
		return { ok: false, code: PUBLIC_PROFILE_ERROR.SOCIAL_URL_SHORTLINK };
	}
	if (!rule.hosts.includes(host)) {
		return { ok: false, code: PUBLIC_PROFILE_ERROR.SOCIAL_URL_WRONG_PLATFORM };
	}

	const path = url.pathname.replace(/\/+$/, "");
	// A bare platform homepage is the most likely paste mistake, and "our
	// Instagram" that lands on instagram.com is a broken promise.
	if (path.length === 0) return { ok: false, code: PUBLIC_PROFILE_ERROR.SOCIAL_URL_INVALID };
	if (!rule.path.test(url.pathname)) {
		return { ok: false, code: PUBLIC_PROFILE_ERROR.SOCIAL_URL_INVALID };
	}

	// Every query param is dropped — `?igshid=`, `?fbclid=`, `?_t=`, `?si=` leak
	// the diner's referral chain and were never meant to be published. The one
	// exception is the only param that identifies the destination rather than
	// tracking the visitor.
	let search = "";
	if (
		platform === SOCIAL_PLATFORM.FACEBOOK &&
		url.pathname.replace(/\/+$/, "") === "/profile.php"
	) {
		const id = url.searchParams.get("id");
		if (!id || !/^\d{1,25}$/.test(id)) {
			return { ok: false, code: PUBLIC_PROFILE_ERROR.SOCIAL_URL_INVALID };
		}
		search = `?id=${id}`;
	} else if (url.pathname.replace(/\/+$/, "") === "/profile.php") {
		return { ok: false, code: PUBLIC_PROFILE_ERROR.SOCIAL_URL_INVALID };
	}

	return { ok: true, value: `https://${rule.canonicalHost}${path}${search}` };
}

/**
 * Client-side paste sugar: turn `@handle` or a bare handle into something
 * `normalizeSocialUrl` accepts, so a manager can type what they know. Returns
 * the input untouched when it already looks like a URL.
 */
export function normalizeSocialInput(platform: SocialPlatform, raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return "";
	if (trimmed.includes("/") || trimmed.includes(".")) return trimmed;

	const handle = trimmed.replace(/^@/, "");
	if (handle.length === 0) return trimmed;

	switch (platform) {
		case SOCIAL_PLATFORM.TIKTOK:
			return `https://tiktok.com/@${handle}`;
		case SOCIAL_PLATFORM.YOUTUBE:
			return `https://youtube.com/@${handle}`;
		default:
			return `https://${PLATFORM_RULES[platform].canonicalHost}/${handle}`;
	}
}

/**
 * Normalize a restaurant phone to E.164 (`+` then 8–15 digits).
 *
 * Deliberately stricter than the reservation contact phone, which is free text
 * read by a human. This one is machine-consumed into a `tel:` and a `wa.me`
 * href — a number a person can read but `wa.me` cannot parse links a diner to
 * a stranger's WhatsApp, and nobody notices for months.
 *
 * The country code is never inferred. Defaulting to +52 would silently
 * mis-route every non-Mexican restaurant, so a national-format number gets its
 * own error code and the form can say the one thing that fixes it.
 */
export function normalizeRestaurantPhone(raw: string): NormalizeResult {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return { ok: true, value: "" };

	// Strip the separators people type. The escapes cover the non-breaking space
	// (U+00A0) and non-breaking hyphen (U+2011) that survive a copy-paste out of
	// a web page and would otherwise be invisible in a diff.
	const cleaned = trimmed.replace(/[\s\u00A0\u2011.()/-]/g, "");

	// `00` is the international prefix in most of the world; treat it as `+`.
	const withPlus = cleaned.startsWith("00") ? `+${cleaned.slice(2)}` : cleaned;

	if (!withPlus.startsWith("+")) {
		// Distinguish "you forgot the country code" from "this isn't a number".
		return /^\d{6,15}$/.test(withPlus)
			? { ok: false, code: PUBLIC_PROFILE_ERROR.PHONE_COUNTRY_CODE_REQUIRED }
			: { ok: false, code: PUBLIC_PROFILE_ERROR.PHONE_INVALID };
	}

	const digits = withPlus.slice(1);
	// E.164: up to 15 digits, and a country code cannot start with 0.
	if (!/^[1-9]\d{7,14}$/.test(digits)) {
		return { ok: false, code: PUBLIC_PROFILE_ERROR.PHONE_INVALID };
	}

	return { ok: true, value: `+${digits}` };
}

/** `tel:` keeps the `+` — it is what makes the number dialable from abroad. */
export function toTelHref(phone: string): string {
	return `tel:${phone}`;
}

/**
 * wa.me takes digits only, no `+`. The `slice(1)` is safe precisely because
 * storage is canonical E.164 — that is the payoff of normalizing on write.
 */
export function toWhatsAppUrl(phone: string): string | null {
	if (!/^\+[1-9]\d{7,14}$/.test(phone)) return null;
	return `https://wa.me/${phone.slice(1)}`;
}

/** Shape check only. The value feeds a `mailto:` on an anonymous page. */
export function isValidContactEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
