import { describe, expect, it } from "vitest";
import { INVITE_CSV_MAX_ROWS } from "../constants";
import type { InviteRowFacts } from "../inviteOnboardingHelpers";
import {
	canonicalizeCsvHeader,
	classifyInviteRow,
	INVITE_CSV_ERROR,
	INVITE_OVERRIDE,
	INVITE_ROLE,
	INVITE_ROW_STATUS,
	inviteDedupeKey,
	inviteRowErrorCode,
	inviteRowErrorField,
	isInviteRowCommittable,
	isValidInviteEmail,
	normalizeInviteEmail,
	parseCsvRecords,
	parseInviteCsv,
	parseInviteRole,
	splitRestaurantTokens,
} from "../inviteOnboardingHelpers";

const ORG_A = "org_aaa";
const ORG_B = "org_bbb";

/** A row that classifies as `ok`; each test perturbs exactly one fact. */
function facts(overrides: Partial<InviteRowFacts> = {}): InviteRowFacts {
	return {
		email: "new.hire@example.com",
		role: INVITE_ROLE.MANAGER,
		organization: { status: "found", id: ORG_A },
		restaurants: {
			resolvedIds: ["rest_1"],
			unknownTokens: [],
			ambiguousTokens: [],
			foreignTokens: [],
		},
		existingRoleOrganizationIds: [],
		pendingInvitationInTargetOrg: false,
		...overrides,
	};
}

describe("email + role normalization", () => {
	it("lowercases and trims like the invitation writer does", () => {
		expect(normalizeInviteEmail("  New.Hire@Example.COM ")).toBe("new.hire@example.com");
	});

	it("accepts ordinary addresses and rejects spreadsheet junk", () => {
		expect(isValidInviteEmail("a.b+tag@sub.example.co.uk")).toBe(true);
		expect(isValidInviteEmail("no-at-sign.example.com")).toBe(false);
		expect(isValidInviteEmail("two@@example.com")).toBe(false);
		expect(isValidInviteEmail("nodomaindot@example")).toBe(false);
		expect(isValidInviteEmail("has space@example.com")).toBe(false);
		expect(isValidInviteEmail("")).toBe(false);
		expect(isValidInviteEmail(`${"a".repeat(250)}@example.com`)).toBe(false);
	});

	it("parses roles case-insensitively and rejects anything else", () => {
		expect(parseInviteRole(" Owner ")).toBe(INVITE_ROLE.OWNER);
		expect(parseInviteRole("MANAGER")).toBe(INVITE_ROLE.MANAGER);
		expect(parseInviteRole("employee")).toBe(INVITE_ROLE.EMPLOYEE);
		expect(parseInviteRole("admin")).toBeNull();
		expect(parseInviteRole("")).toBeNull();
	});
});

describe("classifyInviteRow", () => {
	it("returns ok for a clean manager row", () => {
		const verdict = classifyInviteRow(facts());
		expect(verdict.status).toBe(INVITE_ROW_STATUS.OK);
		expect(verdict.blocked).toBe(false);
		expect(verdict.restaurantIds).toEqual(["rest_1"]);
	});

	it("drops restaurant tokens on an owner row instead of failing it", () => {
		const verdict = classifyInviteRow(
			facts({
				role: INVITE_ROLE.OWNER,
				restaurants: {
					resolvedIds: ["rest_1"],
					unknownTokens: ["ghost"],
					ambiguousTokens: [],
					foreignTokens: [],
				},
			})
		);
		expect(verdict.status).toBe(INVITE_ROW_STATUS.OK);
		expect(verdict.restaurantIds).toEqual([]);
	});

	it("flags an invalid email before anything else", () => {
		const verdict = classifyInviteRow(
			facts({ email: "nope", role: "wizard", organization: { status: "not_found" } })
		);
		expect(verdict.status).toBe(INVITE_ROW_STATUS.INVALID_EMAIL);
		expect(verdict.blocked).toBe(true);
		expect(verdict.override).toBeNull();
	});

	it("flags an unknown role", () => {
		expect(classifyInviteRow(facts({ role: "chef" })).status).toBe(INVITE_ROW_STATUS.INVALID_ROLE);
	});

	it("distinguishes an unresolvable organization from an ambiguous one", () => {
		expect(classifyInviteRow(facts({ organization: { status: "not_found" } })).status).toBe(
			INVITE_ROW_STATUS.INVALID_ORGANIZATION
		);
		expect(classifyInviteRow(facts({ organization: { status: "ambiguous" } })).status).toBe(
			INVITE_ROW_STATUS.INVALID_ORGANIZATION_AMBIGUOUS
		);
	});

	it("requires at least one restaurant for manager and employee", () => {
		for (const role of [INVITE_ROLE.MANAGER, INVITE_ROLE.EMPLOYEE]) {
			const verdict = classifyInviteRow(
				facts({
					role,
					restaurants: {
						resolvedIds: [],
						unknownTokens: [],
						ambiguousTokens: [],
						foreignTokens: [],
					},
				})
			);
			expect(verdict.status).toBe(INVITE_ROW_STATUS.INVALID_RESTAURANTS_REQUIRED);
		}
	});

	it("reports a restaurant belonging to another organization distinctly from a typo", () => {
		const foreign = classifyInviteRow(
			facts({
				restaurants: {
					resolvedIds: [],
					unknownTokens: [],
					ambiguousTokens: [],
					foreignTokens: ["rest_other_tenant"],
				},
			})
		);
		expect(foreign.status).toBe(INVITE_ROW_STATUS.INVALID_RESTAURANT_OTHER_ORG);

		const unknown = classifyInviteRow(
			facts({
				restaurants: {
					resolvedIds: [],
					unknownTokens: ["Casa Vieja"],
					ambiguousTokens: [],
					foreignTokens: [],
				},
			})
		);
		expect(unknown.status).toBe(INVITE_ROW_STATUS.INVALID_RESTAURANT_UNKNOWN);

		const ambiguous = classifyInviteRow(
			facts({
				restaurants: {
					resolvedIds: [],
					unknownTokens: [],
					ambiguousTokens: ["Centro"],
					foreignTokens: [],
				},
			})
		);
		expect(ambiguous.status).toBe(INVITE_ROW_STATUS.INVALID_RESTAURANT_AMBIGUOUS);
	});

	it("flags cross_org when the email already holds a role elsewhere", () => {
		const verdict = classifyInviteRow(facts({ existingRoleOrganizationIds: [ORG_B] }));
		expect(verdict.status).toBe(INVITE_ROW_STATUS.CROSS_ORG);
		expect(verdict.blocked).toBe(true);
		expect(verdict.override).toBe(INVITE_OVERRIDE.ACKNOWLEDGE_ORG_MOVE);
	});

	it("treats a role in the SAME org as already_member, not cross_org", () => {
		const verdict = classifyInviteRow(facts({ existingRoleOrganizationIds: [ORG_A] }));
		expect(verdict.status).toBe(INVITE_ROW_STATUS.ALREADY_MEMBER);
		expect(verdict.blocked).toBe(false);
	});

	it("ignores orgless role rows — an admin or customer is not another tenancy", () => {
		const verdict = classifyInviteRow(facts({ existingRoleOrganizationIds: [undefined] }));
		expect(verdict.status).toBe(INVITE_ROW_STATUS.OK);
	});

	it("ranks cross_org above every other non-structural verdict", () => {
		const verdict = classifyInviteRow(
			facts({
				existingRoleOrganizationIds: [ORG_A, ORG_B],
				pendingInvitationInTargetOrg: true,
				duplicateEarlierInFile: true,
			})
		);
		expect(verdict.status).toBe(INVITE_ROW_STATUS.CROSS_ORG);
	});

	it("flags a pending duplicate and offers the replace override", () => {
		const verdict = classifyInviteRow(facts({ pendingInvitationInTargetOrg: true }));
		expect(verdict.status).toBe(INVITE_ROW_STATUS.DUPLICATE_PENDING);
		expect(verdict.override).toBe(INVITE_OVERRIDE.REPLACE_EXISTING_PENDING);
	});

	it("does not flag a duplicate when the only prior invitation is expired or revoked", () => {
		// The Convex layer filters to PENDING + unexpired before setting this fact,
		// so an expired/revoked prior invitation arrives here as `false`.
		expect(classifyInviteRow(facts({ pendingInvitationInTargetOrg: false })).status).toBe(
			INVITE_ROW_STATUS.OK
		);
	});

	it("flags a second row of the same file with no way to override it", () => {
		const verdict = classifyInviteRow(facts({ duplicateEarlierInFile: true }));
		expect(verdict.status).toBe(INVITE_ROW_STATUS.DUPLICATE_IN_FILE);
		expect(verdict.blocked).toBe(true);
		expect(verdict.override).toBeNull();
	});

	it("never lets the informational already_member mask a blocking duplicate", () => {
		const verdict = classifyInviteRow(
			facts({ existingRoleOrganizationIds: [ORG_A], pendingInvitationInTargetOrg: true })
		);
		expect(verdict.status).toBe(INVITE_ROW_STATUS.DUPLICATE_PENDING);
		expect(verdict.blocked).toBe(true);
	});

	it("deduplicates the restaurants it would write", () => {
		const verdict = classifyInviteRow(
			facts({
				restaurants: {
					resolvedIds: ["rest_1", "rest_1", "rest_2"],
					unknownTokens: [],
					ambiguousTokens: [],
					foreignTokens: [],
				},
			})
		);
		expect(verdict.restaurantIds).toEqual(["rest_1", "rest_2"]);
	});
});

describe("isInviteRowCommittable", () => {
	it("lets non-blocking verdicts through unconditionally", () => {
		expect(isInviteRowCommittable(classifyInviteRow(facts()), {})).toBe(true);
		expect(
			isInviteRowCommittable(classifyInviteRow(facts({ existingRoleOrganizationIds: [ORG_A] })), {})
		).toBe(true);
	});

	it("requires the matching acknowledgement for a blocking verdict", () => {
		const crossOrg = classifyInviteRow(facts({ existingRoleOrganizationIds: [ORG_B] }));
		expect(isInviteRowCommittable(crossOrg, {})).toBe(false);
		// The wrong acknowledgement does not unlock it.
		expect(
			isInviteRowCommittable(crossOrg, { [INVITE_OVERRIDE.REPLACE_EXISTING_PENDING]: true })
		).toBe(false);
		expect(isInviteRowCommittable(crossOrg, { [INVITE_OVERRIDE.ACKNOWLEDGE_ORG_MOVE]: true })).toBe(
			true
		);
	});

	it("never unlocks a verdict with no override", () => {
		const invalid = classifyInviteRow(facts({ email: "nope" }));
		expect(
			isInviteRowCommittable(invalid, {
				[INVITE_OVERRIDE.ACKNOWLEDGE_ORG_MOVE]: true,
				[INVITE_OVERRIDE.REPLACE_EXISTING_PENDING]: true,
			})
		).toBe(false);
	});
});

describe("stable error surface", () => {
	it("derives the code mechanically from the status", () => {
		expect(inviteRowErrorCode(INVITE_ROW_STATUS.CROSS_ORG)).toBe("ERROR_INVITE_CROSS_ORG");
		expect(inviteRowErrorCode(INVITE_ROW_STATUS.INVALID_EMAIL)).toBe("ERROR_INVITE_INVALID_EMAIL");
		expect(inviteRowErrorCode(INVITE_ROW_STATUS.DUPLICATE_PENDING)).toBe(
			"ERROR_INVITE_DUPLICATE_PENDING"
		);
	});

	it("points each verdict at the field it is about", () => {
		expect(inviteRowErrorField(INVITE_ROW_STATUS.INVALID_ROLE)).toBe("role");
		expect(inviteRowErrorField(INVITE_ROW_STATUS.INVALID_ORGANIZATION)).toBe("organizationId");
		expect(inviteRowErrorField(INVITE_ROW_STATUS.CROSS_ORG)).toBe("email");
		expect(inviteRowErrorField(INVITE_ROW_STATUS.INVALID_RESTAURANTS_REQUIRED)).toBe(
			"restaurantIds"
		);
	});

	it("keys duplicates on email + organization", () => {
		expect(inviteDedupeKey("a@b.com", ORG_A)).not.toBe(inviteDedupeKey("a@b.com", ORG_B));
	});
});

describe("parseCsvRecords", () => {
	it("strips a UTF-8 BOM", () => {
		const { records } = parseCsvRecords("\uFEFFemail,role\na@b.com,owner");
		expect(records[0]).toEqual(["email", "role"]);
	});

	it("handles CRLF and a bare CR as record separators", () => {
		expect(parseCsvRecords("a,b\r\nc,d\r\n").records).toEqual([
			["a", "b"],
			["c", "d"],
		]);
		expect(parseCsvRecords("a,b\rc,d").records).toEqual([
			["a", "b"],
			["c", "d"],
		]);
	});

	it("keeps commas, newlines and escaped quotes inside a quoted field", () => {
		const { records } = parseCsvRecords('a,"Bar, Grill & Co","say ""hi""","two\nlines"');
		expect(records[0]).toEqual(["a", "Bar, Grill & Co", 'say "hi"', "two\nlines"]);
	});

	it("drops blank lines, including a trailing newline", () => {
		expect(parseCsvRecords("a,b\n\n\nc,d\n").records).toEqual([
			["a", "b"],
			["c", "d"],
		]);
		expect(parseCsvRecords("\n , \n").records).toEqual([]);
	});

	it("trims unquoted fields but preserves quoted ones verbatim", () => {
		const { records } = parseCsvRecords('  spaced  ,"  quoted  "');
		expect(records[0]).toEqual(["spaced", "  quoted  "]);
	});

	it("reports an unterminated quote instead of silently truncating", () => {
		expect(parseCsvRecords('a,"never closed').unterminatedQuote).toBe(true);
		expect(parseCsvRecords('a,"closed"').unterminatedQuote).toBe(false);
	});

	it("preserves a trailing empty quoted field", () => {
		expect(parseCsvRecords('a,""').records).toEqual([["a", ""]]);
	});
});

describe("canonicalizeCsvHeader + splitRestaurantTokens", () => {
	it("folds case, spaces and punctuation out of a header", () => {
		expect(canonicalizeCsvHeader(" First Name ")).toBe("firstname");
		expect(canonicalizeCsvHeader("first_name")).toBe("firstname");
		expect(canonicalizeCsvHeader("Organization-ID")).toBe("organizationid");
	});

	it("splits restaurants on semicolons or pipes and drops the empties", () => {
		expect(splitRestaurantTokens("Centro; Sur |  | Norte ")).toEqual(["Centro", "Sur", "Norte"]);
		expect(splitRestaurantTokens("")).toEqual([]);
	});
});

describe("parseInviteCsv", () => {
	const header = "email,role,organization,restaurants";

	it("parses a minimal file", () => {
		const result = parseInviteCsv(`${header}\nowner@x.com,owner,Acme,\nmgr@x.com,manager,Acme,R1`);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.rows).toHaveLength(2);
		expect(result.rows[0]).toMatchObject({
			rowNumber: 1,
			email: "owner@x.com",
			role: "owner",
			organization: "Acme",
			restaurants: [],
		});
		expect(result.rows[1]).toMatchObject({ rowNumber: 2, restaurants: ["R1"] });
	});

	it("accepts header aliases in any case, order and spelling", () => {
		const result = parseInviteCsv(
			"Rol,Correo,ORGANIZATION ID,Locations,First Name,Apellido Paterno\n" +
				"manager,a@b.com,org_1,r1|r2,Ana,Lopez"
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.rows[0]).toMatchObject({
			email: "a@b.com",
			role: "manager",
			organization: "org_1",
			restaurants: ["r1", "r2"],
			firstName: "Ana",
			paternalLastname: "Lopez",
		});
	});

	it("keeps a quoted organization name containing a comma intact", () => {
		const result = parseInviteCsv(`${header}\na@b.com,owner,"Grupo Sol, S.A.",`);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.rows[0].organization).toBe("Grupo Sol, S.A.");
	});

	it("survives CRLF, a BOM and interior blank lines together", () => {
		const result = parseInviteCsv(`\uFEFF${header}\r\n\r\na@b.com,owner,Acme,\r\n\r\n`);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.rows).toHaveLength(1);
	});

	it("rejects an unknown column rather than ignoring it", () => {
		const result = parseInviteCsv(`${header},salary\na@b.com,owner,Acme,,100`);
		expect(result).toMatchObject({ ok: false, code: INVITE_CSV_ERROR.UNKNOWN_COLUMN });
	});

	it("ignores a trailing empty header cell", () => {
		const result = parseInviteCsv(`${header},\na@b.com,owner,Acme,,`);
		expect(result.ok).toBe(true);
	});

	it("rejects a duplicated column", () => {
		const result = parseInviteCsv("email,role,organization,e-mail\na@b.com,owner,Acme,a@b.com");
		expect(result).toMatchObject({ ok: false, code: INVITE_CSV_ERROR.DUPLICATE_COLUMN });
	});

	it("names the required column that is missing", () => {
		const result = parseInviteCsv("email,restaurants\na@b.com,R1");
		expect(result).toMatchObject({ ok: false, code: INVITE_CSV_ERROR.MISSING_COLUMN });
		if (result.ok) return;
		expect(result.detail).toContain("role");
		expect(result.detail).toContain("organization");
	});

	it("rejects an empty file and a header with no data rows", () => {
		expect(parseInviteCsv("")).toMatchObject({ ok: false, code: INVITE_CSV_ERROR.EMPTY });
		expect(parseInviteCsv("   \n\n")).toMatchObject({ ok: false, code: INVITE_CSV_ERROR.EMPTY });
		expect(parseInviteCsv(header)).toMatchObject({ ok: false, code: INVITE_CSV_ERROR.EMPTY });
	});

	it("rejects an unterminated quote", () => {
		const result = parseInviteCsv(`${header}\na@b.com,owner,"Acme,`);
		expect(result).toMatchObject({ ok: false, code: INVITE_CSV_ERROR.UNTERMINATED_QUOTE });
	});

	it("enforces the row cap", () => {
		const body = Array.from({ length: 3 }, (_, i) => `u${i}@x.com,owner,Acme,`).join("\n");
		expect(parseInviteCsv(`${header}\n${body}`, { maxRows: 2 })).toMatchObject({
			ok: false,
			code: INVITE_CSV_ERROR.TOO_MANY_ROWS,
			detail: "2",
		});
		expect(parseInviteCsv(`${header}\n${body}`, { maxRows: 3 }).ok).toBe(true);
	});

	it("defaults the row cap to the shared constant", () => {
		const body = Array.from(
			{ length: INVITE_CSV_MAX_ROWS + 1 },
			(_, i) => `u${i}@x.com,owner,Acme,`
		).join("\n");
		expect(parseInviteCsv(`${header}\n${body}`)).toMatchObject({
			ok: false,
			code: INVITE_CSV_ERROR.TOO_MANY_ROWS,
		});
	});

	it("tolerates a short row so it fails per-row instead of failing the upload", () => {
		const result = parseInviteCsv(`${header}\na@b.com,owner`);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.rows[0]).toMatchObject({ organization: "", restaurants: [] });
	});

	it("omits blank optional name columns rather than storing empty strings", () => {
		const result = parseInviteCsv(`${header},firstName\na@b.com,owner,Acme,,   `);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.rows[0].firstName).toBeUndefined();
	});
});
