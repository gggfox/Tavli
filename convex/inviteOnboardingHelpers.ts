/**
 * Pure logic for admin-driven onboarding of new users — the single-invite form
 * and the bulk CSV upload both funnel through here.
 *
 * Nothing in this module does I/O. `convex/inviteOnboarding.ts` performs the
 * database lookups, packs the answers into {@link InviteRowFacts}, and asks
 * {@link classifyInviteRow} for a verdict. That split is deliberate: the
 * interesting decisions (which row is safe to send, which one would quietly
 * damage an existing user) are then unit-testable without convex-test.
 *
 * ## Why a classifier exists at all
 *
 * Accepting an invitation OVERWRITES `userRoles.organizationId` (see
 * `acceptInvitation` in `convex/invites.ts`). So inviting somebody who already
 * belongs to another organization silently re-points them at the new one and
 * strips their old tenancy. That is the `cross_org` case: it is detected here
 * and blocked unless the admin explicitly acknowledges the move per row.
 *
 * Multi-org membership is NOT fixed here — this only refuses to walk into it
 * by accident.
 */

import {
	INVITE_CSV_MAX_ROWS,
	INVITE_EMAIL_MAX_LENGTH,
	RESTAURANT_MEMBER_ROLE,
	USER_ROLES,
} from "./constants";

// =============================================================================
// Roles
// =============================================================================

/** The three roles an invitation can carry (mirrors the `invitations.role` union). */
export const INVITE_ROLE = {
	OWNER: USER_ROLES.OWNER,
	MANAGER: RESTAURANT_MEMBER_ROLE.MANAGER,
	EMPLOYEE: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
} as const;

export type InviteRole = (typeof INVITE_ROLE)[keyof typeof INVITE_ROLE];

const INVITE_ROLE_VALUES: readonly InviteRole[] = [
	INVITE_ROLE.OWNER,
	INVITE_ROLE.MANAGER,
	INVITE_ROLE.EMPLOYEE,
];

/** Case/whitespace-forgiving role parse. Returns `null` for anything unknown. */
export function parseInviteRole(raw: string): InviteRole | null {
	const token = raw.trim().toLowerCase();
	return INVITE_ROLE_VALUES.find((role) => role === token) ?? null;
}

/** Only manager/employee invitations attach to restaurants; owner invites are org-wide. */
export function roleRequiresRestaurants(role: InviteRole): boolean {
	return role === INVITE_ROLE.MANAGER || role === INVITE_ROLE.EMPLOYEE;
}

// =============================================================================
// Email
// =============================================================================

/**
 * Same normalization `convex/invites.ts` applies before insert, duplicated here
 * so the classifier compares like with like.
 */
export function normalizeInviteEmail(raw: string): string {
	return raw.trim().toLowerCase();
}

/**
 * Deliberately conservative: one `@`, a non-empty local part, and a dotted
 * domain with no whitespace or CSV/RFC punctuation. This is not a full RFC 5322
 * validator — it exists to catch spreadsheet typos before we mail a stranger.
 */
const EMAIL_PATTERN = /^[^\s@,;:"'<>()[\]\\]+@[^\s@,;:"'<>()[\]\\.]+(?:\.[^\s@,;:"'<>()[\]\\.]+)+$/;

export function isValidInviteEmail(email: string): boolean {
	if (email.length === 0 || email.length > INVITE_EMAIL_MAX_LENGTH) return false;
	return EMAIL_PATTERN.test(email);
}

// =============================================================================
// Row classification
// =============================================================================

/**
 * Verdict vocabulary shared by the single form and the bulk preview. Values are
 * stable strings: the frontend maps them to i18n keys, so never reword one
 * without a matching key change.
 */
export const INVITE_ROW_STATUS = {
	/** Safe to send. */
	OK: "ok",
	/**
	 * The email already holds a `userRoles` row in a DIFFERENT organization.
	 * Accepting would re-point them — blocked pending acknowledgement.
	 */
	CROSS_ORG: "cross_org",
	/** An earlier row in the same upload already targets this email + organization. */
	DUPLICATE_IN_FILE: "duplicate_in_file",
	/** A pending, unexpired invitation for this email + organization already exists. */
	DUPLICATE_PENDING: "duplicate_pending",
	/** The email already has a role in the TARGET organization. Informational, not an error. */
	ALREADY_MEMBER: "already_member",
	INVALID_EMAIL: "invalid_email",
	INVALID_ROLE: "invalid_role",
	INVALID_ORGANIZATION: "invalid_organization",
	INVALID_ORGANIZATION_AMBIGUOUS: "invalid_organization_ambiguous",
	INVALID_RESTAURANTS_REQUIRED: "invalid_restaurants_required",
	INVALID_RESTAURANT_UNKNOWN: "invalid_restaurant_unknown",
	INVALID_RESTAURANT_AMBIGUOUS: "invalid_restaurant_ambiguous",
	INVALID_RESTAURANT_OTHER_ORG: "invalid_restaurant_other_org",
} as const;

export type InviteRowStatus = (typeof INVITE_ROW_STATUS)[keyof typeof INVITE_ROW_STATUS];

/** Names of the per-row acknowledgements that clear a blocking verdict. */
export const INVITE_OVERRIDE = {
	ACKNOWLEDGE_ORG_MOVE: "acknowledgeOrgMove",
	REPLACE_EXISTING_PENDING: "replaceExistingPending",
} as const;

export type InviteOverride = (typeof INVITE_OVERRIDE)[keyof typeof INVITE_OVERRIDE];

/** What the database says about one prospective invitation. */
export interface InviteRowFacts {
	/** Raw email as typed/uploaded; normalized inside the classifier. */
	email: string;
	/** Raw role token as typed/uploaded. */
	role: string;
	/** Outcome of resolving the `organization` column (id or exact name). */
	organization: { status: "found"; id: string } | { status: "not_found" | "ambiguous" };
	/** Outcome of resolving each restaurant token WITHIN the target organization. */
	restaurants: {
		/** Tokens that resolved to a live restaurant in the target org. */
		resolvedIds: string[];
		/** Tokens that matched nothing (or matched a soft-deleted restaurant). */
		unknownTokens: string[];
		/** Name tokens that matched more than one restaurant in the org. */
		ambiguousTokens: string[];
		/** Tokens that resolved to a real restaurant belonging to a DIFFERENT org. */
		foreignTokens: string[];
	};
	/**
	 * `organizationId` of every `userRoles` row carrying this email. `undefined`
	 * entries (orgless rows — platform admins, customers) are not tenancy and
	 * never count as a cross-org move.
	 */
	existingRoleOrganizationIds: (string | undefined)[];
	/** A PENDING, unexpired invitation already exists for this email + target org. */
	pendingInvitationInTargetOrg: boolean;
	/** An earlier row of the same upload already claimed this email + target org. */
	duplicateEarlierInFile?: boolean;
}

export interface InviteRowVerdict {
	status: InviteRowStatus;
	/** True when the row must not be committed as submitted. */
	blocked: boolean;
	/** Acknowledgement that clears `blocked`; `null` when nothing can. */
	override: InviteOverride | null;
	normalizedEmail: string;
	/** `null` when the role token was unparseable. */
	role: InviteRole | null;
	/** `null` when the organization could not be resolved. */
	organizationId: string | null;
	/** Restaurants that would actually be written — always empty for owner invites. */
	restaurantIds: string[];
}

function verdict(
	status: InviteRowStatus,
	base: Omit<InviteRowVerdict, "status" | "blocked" | "override">,
	blocking?: { override: InviteOverride | null }
): InviteRowVerdict {
	return {
		...base,
		status,
		blocked: blocking !== undefined,
		override: blocking?.override ?? null,
	};
}

/**
 * Classify one prospective invitation.
 *
 * Precedence, first match wins:
 *   1. structural errors (email → role → organization → restaurants), because a
 *      row we cannot even resolve has nothing else worth saying about it;
 *   2. `cross_org` — the destructive case, surfaced ahead of the merely
 *      redundant ones so the admin sees the danger first;
 *   3. `duplicate_in_file`, then `duplicate_pending` — both blocking;
 *   4. `already_member` — informational only, so it is ranked BELOW every
 *      blocking verdict and can never mask one;
 *   5. `ok`.
 *
 * Owner rows ignore any restaurant tokens rather than rejecting them: an owner
 * invitation is org-wide by construction (`restaurantIds: []`), and a stray
 * column in a spreadsheet should not fail an otherwise-good row.
 */
export function classifyInviteRow(facts: InviteRowFacts): InviteRowVerdict {
	const normalizedEmail = normalizeInviteEmail(facts.email);
	const role = parseInviteRole(facts.role);
	const organizationId = facts.organization.status === "found" ? facts.organization.id : null;

	const base = {
		normalizedEmail,
		role,
		organizationId,
		restaurantIds: [] as string[],
	};

	if (!isValidInviteEmail(normalizedEmail)) {
		return verdict(INVITE_ROW_STATUS.INVALID_EMAIL, base, { override: null });
	}
	if (role === null) {
		return verdict(INVITE_ROW_STATUS.INVALID_ROLE, base, { override: null });
	}
	if (facts.organization.status === "ambiguous") {
		return verdict(INVITE_ROW_STATUS.INVALID_ORGANIZATION_AMBIGUOUS, base, { override: null });
	}
	if (facts.organization.status !== "found") {
		return verdict(INVITE_ROW_STATUS.INVALID_ORGANIZATION, base, { override: null });
	}

	if (roleRequiresRestaurants(role)) {
		if (facts.restaurants.foreignTokens.length > 0) {
			return verdict(INVITE_ROW_STATUS.INVALID_RESTAURANT_OTHER_ORG, base, { override: null });
		}
		if (facts.restaurants.ambiguousTokens.length > 0) {
			return verdict(INVITE_ROW_STATUS.INVALID_RESTAURANT_AMBIGUOUS, base, { override: null });
		}
		if (facts.restaurants.unknownTokens.length > 0) {
			return verdict(INVITE_ROW_STATUS.INVALID_RESTAURANT_UNKNOWN, base, { override: null });
		}
		if (facts.restaurants.resolvedIds.length === 0) {
			return verdict(INVITE_ROW_STATUS.INVALID_RESTAURANTS_REQUIRED, base, { override: null });
		}
		base.restaurantIds = dedupe(facts.restaurants.resolvedIds);
	}

	const otherOrg = facts.existingRoleOrganizationIds.some(
		(orgId) => orgId !== undefined && orgId !== organizationId
	);
	if (otherOrg) {
		return verdict(INVITE_ROW_STATUS.CROSS_ORG, base, {
			override: INVITE_OVERRIDE.ACKNOWLEDGE_ORG_MOVE,
		});
	}

	if (facts.duplicateEarlierInFile === true) {
		return verdict(INVITE_ROW_STATUS.DUPLICATE_IN_FILE, base, { override: null });
	}
	if (facts.pendingInvitationInTargetOrg) {
		return verdict(INVITE_ROW_STATUS.DUPLICATE_PENDING, base, {
			override: INVITE_OVERRIDE.REPLACE_EXISTING_PENDING,
		});
	}

	const sameOrg = facts.existingRoleOrganizationIds.some((orgId) => orgId === organizationId);
	if (sameOrg) {
		return verdict(INVITE_ROW_STATUS.ALREADY_MEMBER, base);
	}

	return verdict(INVITE_ROW_STATUS.OK, base);
}

/**
 * Whether a verdict may be committed given the acknowledgements the admin ticked
 * for that row. Non-blocking verdicts (`ok`, `already_member`) always pass.
 */
export function isInviteRowCommittable(
	result: InviteRowVerdict,
	acknowledgements: Partial<Record<InviteOverride, boolean>>
): boolean {
	if (!result.blocked) return true;
	if (result.override === null) return false;
	return acknowledgements[result.override] === true;
}

function dedupe(values: string[]): string[] {
	return [...new Set(values)];
}

// =============================================================================
// CSV parsing
// =============================================================================

/**
 * Stable failure codes for a CSV that cannot be turned into rows at all.
 * Row-level problems are reported per row as an {@link InviteRowStatus}.
 */
export const INVITE_CSV_ERROR = {
	EMPTY: "ERROR_INVITE_CSV_EMPTY",
	MISSING_COLUMN: "ERROR_INVITE_CSV_MISSING_COLUMN",
	UNKNOWN_COLUMN: "ERROR_INVITE_CSV_UNKNOWN_COLUMN",
	DUPLICATE_COLUMN: "ERROR_INVITE_CSV_DUPLICATE_COLUMN",
	TOO_MANY_ROWS: "ERROR_INVITE_CSV_TOO_MANY_ROWS",
	TOO_LARGE: "ERROR_INVITE_CSV_TOO_LARGE",
	UNTERMINATED_QUOTE: "ERROR_INVITE_CSV_UNTERMINATED_QUOTE",
	NOT_CSV: "ERROR_INVITE_CSV_NOT_CSV",
} as const;

/**
 * Content types a browser sends for a `.csv` pick. Windows reports Excel types
 * for the same file, so the list is deliberately wider than `text/csv`; a blob
 * with no type at all is accepted, since some clients send none.
 */
export const CSV_UPLOAD_CONTENT_TYPES = [
	"text/csv",
	"text/plain",
	"application/csv",
	"application/vnd.ms-excel",
	"application/octet-stream",
] as const;

export type InviteCsvErrorCode = (typeof INVITE_CSV_ERROR)[keyof typeof INVITE_CSV_ERROR];

/**
 * Hand-rolled RFC-4180-ish reader. No dependency is pulled in for this: the
 * grammar is small, and a parser we own is a parser we can keep strict about
 * the things that actually bite (BOM, CRLF, quoted commas, blank lines).
 *
 * Behaviour:
 *   - a leading UTF-8 BOM is stripped;
 *   - `\r\n`, `\n` and a bare `\r` all end a record;
 *   - a field wrapped in `"` may contain commas, newlines and `""` escapes;
 *   - unquoted fields are trimmed, quoted fields are preserved verbatim;
 *   - records whose every cell is empty (blank lines) are dropped;
 *   - text after a closing quote is appended to the field rather than rejected.
 *
 * Throws nothing — an unterminated quote is reported by the caller-facing
 * {@link parseInviteCsv}.
 */
export function parseCsvRecords(input: string): {
	records: string[][];
	unterminatedQuote: boolean;
} {
	const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

	const records: string[][] = [];
	let record: string[] = [];
	let field = "";
	let fieldWasQuoted = false;
	let inQuotes = false;

	const endField = (): void => {
		record.push(fieldWasQuoted ? field : field.trim());
		field = "";
		fieldWasQuoted = false;
	};
	const endRecord = (): void => {
		endField();
		if (record.some((cell) => cell.length > 0)) records.push(record);
		record = [];
	};

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];

		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += ch;
			}
			continue;
		}

		if (ch === '"') {
			inQuotes = true;
			fieldWasQuoted = true;
			continue;
		}
		if (ch === ",") {
			endField();
			continue;
		}
		if (ch === "\r") {
			if (text[i + 1] === "\n") i++;
			endRecord();
			continue;
		}
		if (ch === "\n") {
			endRecord();
			continue;
		}
		field += ch;
	}

	if (field.length > 0 || fieldWasQuoted || record.length > 0) endRecord();

	return { records, unterminatedQuote: inQuotes };
}

/** Canonical column keys. The header may spell them in any of the aliases below. */
export const INVITE_CSV_COLUMN = {
	EMAIL: "email",
	ROLE: "role",
	ORGANIZATION: "organization",
	RESTAURANTS: "restaurants",
	FIRST_NAME: "firstName",
	PATERNAL_LASTNAME: "paternalLastname",
	MATERNAL_LASTNAME: "maternalLastname",
} as const;

export type InviteCsvColumn = (typeof INVITE_CSV_COLUMN)[keyof typeof INVITE_CSV_COLUMN];

/** Columns a file must carry. `restaurants` is conditional and checked per row. */
export const INVITE_CSV_REQUIRED_COLUMNS: readonly InviteCsvColumn[] = [
	INVITE_CSV_COLUMN.EMAIL,
	INVITE_CSV_COLUMN.ROLE,
	INVITE_CSV_COLUMN.ORGANIZATION,
];

/**
 * Header aliases, keyed by the canonicalized spelling (lowercased, every
 * non-alphanumeric character removed). So `First Name`, `first_name` and
 * `FIRSTNAME` all arrive here as `firstname`.
 */
const HEADER_ALIASES: Readonly<Record<string, InviteCsvColumn>> = {
	email: INVITE_CSV_COLUMN.EMAIL,
	emailaddress: INVITE_CSV_COLUMN.EMAIL,
	mail: INVITE_CSV_COLUMN.EMAIL,
	correo: INVITE_CSV_COLUMN.EMAIL,

	role: INVITE_CSV_COLUMN.ROLE,
	rol: INVITE_CSV_COLUMN.ROLE,

	organization: INVITE_CSV_COLUMN.ORGANIZATION,
	organisation: INVITE_CSV_COLUMN.ORGANIZATION,
	org: INVITE_CSV_COLUMN.ORGANIZATION,
	organizationid: INVITE_CSV_COLUMN.ORGANIZATION,
	organisationid: INVITE_CSV_COLUMN.ORGANIZATION,
	orgid: INVITE_CSV_COLUMN.ORGANIZATION,
	organizacion: INVITE_CSV_COLUMN.ORGANIZATION,

	restaurants: INVITE_CSV_COLUMN.RESTAURANTS,
	restaurant: INVITE_CSV_COLUMN.RESTAURANTS,
	restaurantids: INVITE_CSV_COLUMN.RESTAURANTS,
	restaurantid: INVITE_CSV_COLUMN.RESTAURANTS,
	restaurantes: INVITE_CSV_COLUMN.RESTAURANTS,
	locations: INVITE_CSV_COLUMN.RESTAURANTS,

	firstname: INVITE_CSV_COLUMN.FIRST_NAME,
	givenname: INVITE_CSV_COLUMN.FIRST_NAME,
	nombre: INVITE_CSV_COLUMN.FIRST_NAME,

	paternallastname: INVITE_CSV_COLUMN.PATERNAL_LASTNAME,
	paternalsurname: INVITE_CSV_COLUMN.PATERNAL_LASTNAME,
	lastname: INVITE_CSV_COLUMN.PATERNAL_LASTNAME,
	surname: INVITE_CSV_COLUMN.PATERNAL_LASTNAME,
	apellidopaterno: INVITE_CSV_COLUMN.PATERNAL_LASTNAME,

	maternallastname: INVITE_CSV_COLUMN.MATERNAL_LASTNAME,
	maternalsurname: INVITE_CSV_COLUMN.MATERNAL_LASTNAME,
	secondlastname: INVITE_CSV_COLUMN.MATERNAL_LASTNAME,
	apellidomaterno: INVITE_CSV_COLUMN.MATERNAL_LASTNAME,
};

export function canonicalizeCsvHeader(header: string): string {
	return header
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

/** One CSV data row, still unresolved — ids/names are looked up by the Convex layer. */
export interface RawInviteCsvRow {
	/** 1-based position among DATA rows (the header is not counted). */
	rowNumber: number;
	email: string;
	role: string;
	organization: string;
	/** Already split on `;` / `|`, trimmed, empties dropped. */
	restaurants: string[];
	firstName?: string;
	paternalLastname?: string;
	maternalLastname?: string;
}

export type InviteCsvParseResult =
	| { ok: true; rows: RawInviteCsvRow[] }
	| { ok: false; code: InviteCsvErrorCode; detail?: string };

/** Restaurant lists use `;` or `|` — never `,`, which is the CSV delimiter. */
export function splitRestaurantTokens(raw: string): string[] {
	return raw
		.split(/[;|]/)
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
}

/**
 * Parse an uploaded invite CSV into raw rows. Strict about the header (unknown
 * or duplicated columns are rejected rather than silently ignored — a
 * mis-titled column is far more likely a mistake than an intentional extra),
 * forgiving about case, whitespace and column order.
 *
 * Short rows are tolerated: a record with fewer cells than the header yields
 * empty strings for the missing tail, which then fails per-row classification
 * with a precise reason instead of failing the whole upload.
 */
export function parseInviteCsv(
	input: string,
	options?: { maxRows?: number }
): InviteCsvParseResult {
	const maxRows = options?.maxRows ?? INVITE_CSV_MAX_ROWS;
	const { records, unterminatedQuote } = parseCsvRecords(input);

	if (unterminatedQuote) return { ok: false, code: INVITE_CSV_ERROR.UNTERMINATED_QUOTE };
	if (records.length === 0) return { ok: false, code: INVITE_CSV_ERROR.EMPTY };

	const [headerRecord, ...dataRecords] = records;

	const columns: (InviteCsvColumn | null)[] = [];
	const seen = new Set<InviteCsvColumn>();
	for (const rawHeader of headerRecord) {
		const canonical = canonicalizeCsvHeader(rawHeader);
		if (canonical.length === 0) {
			// A trailing empty header cell (common when a spreadsheet exports a
			// stray delimiter) is ignored rather than treated as unknown.
			columns.push(null);
			continue;
		}
		const column = HEADER_ALIASES[canonical];
		if (!column) {
			return { ok: false, code: INVITE_CSV_ERROR.UNKNOWN_COLUMN, detail: rawHeader.trim() };
		}
		if (seen.has(column)) {
			return { ok: false, code: INVITE_CSV_ERROR.DUPLICATE_COLUMN, detail: column };
		}
		seen.add(column);
		columns.push(column);
	}

	const missing = INVITE_CSV_REQUIRED_COLUMNS.filter((column) => !seen.has(column));
	if (missing.length > 0) {
		return { ok: false, code: INVITE_CSV_ERROR.MISSING_COLUMN, detail: missing.join(",") };
	}

	if (dataRecords.length === 0) return { ok: false, code: INVITE_CSV_ERROR.EMPTY };
	if (dataRecords.length > maxRows) {
		return { ok: false, code: INVITE_CSV_ERROR.TOO_MANY_ROWS, detail: String(maxRows) };
	}

	const rows: RawInviteCsvRow[] = dataRecords.map((record, index) => {
		const cell = (column: InviteCsvColumn): string => {
			const at = columns.indexOf(column);
			if (at === -1) return "";
			return record[at] ?? "";
		};

		const optional = (column: InviteCsvColumn): string | undefined => {
			const value = cell(column).trim();
			return value.length > 0 ? value : undefined;
		};

		return {
			rowNumber: index + 1,
			email: cell(INVITE_CSV_COLUMN.EMAIL).trim(),
			role: cell(INVITE_CSV_COLUMN.ROLE).trim(),
			organization: cell(INVITE_CSV_COLUMN.ORGANIZATION).trim(),
			restaurants: splitRestaurantTokens(cell(INVITE_CSV_COLUMN.RESTAURANTS)),
			...(optional(INVITE_CSV_COLUMN.FIRST_NAME) && {
				firstName: optional(INVITE_CSV_COLUMN.FIRST_NAME),
			}),
			...(optional(INVITE_CSV_COLUMN.PATERNAL_LASTNAME) && {
				paternalLastname: optional(INVITE_CSV_COLUMN.PATERNAL_LASTNAME),
			}),
			...(optional(INVITE_CSV_COLUMN.MATERNAL_LASTNAME) && {
				maternalLastname: optional(INVITE_CSV_COLUMN.MATERNAL_LASTNAME),
			}),
		};
	});

	return { ok: true, rows };
}

/** Key used to spot two rows of the same upload targeting the same person + org. */
export function inviteDedupeKey(normalizedEmail: string, organizationId: string): string {
	return `${normalizedEmail}::${organizationId}`;
}

// =============================================================================
// Stable error surface
// =============================================================================

/**
 * The stable code a blocking verdict is reported as. Derived mechanically from
 * the status so the two can never drift: `cross_org` → `ERROR_INVITE_CROSS_ORG`,
 * `invalid_email` → `ERROR_INVITE_INVALID_EMAIL`, and so on. The frontend maps
 * these to i18n keys; the backend never returns prose.
 */
export function inviteRowErrorCode(status: InviteRowStatus): string {
	return `ERROR_INVITE_${status.toUpperCase()}`;
}

/** Which submitted field a blocking verdict is about, for form-level display. */
export function inviteRowErrorField(status: InviteRowStatus): string {
	switch (status) {
		case INVITE_ROW_STATUS.INVALID_EMAIL:
		case INVITE_ROW_STATUS.CROSS_ORG:
		case INVITE_ROW_STATUS.DUPLICATE_IN_FILE:
		case INVITE_ROW_STATUS.DUPLICATE_PENDING:
			return "email";
		case INVITE_ROW_STATUS.INVALID_ROLE:
			return "role";
		case INVITE_ROW_STATUS.INVALID_ORGANIZATION:
		case INVITE_ROW_STATUS.INVALID_ORGANIZATION_AMBIGUOUS:
			return "organizationId";
		default:
			return "restaurantIds";
	}
}
