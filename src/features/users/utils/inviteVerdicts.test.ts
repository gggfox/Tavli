/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown */
/**
 * The frontend half of the invitation-verdict contract.
 *
 * The interesting case is `readInviteFailure`: file-level CSV rejections travel
 * as `CODE:detail` inside a validation field, and the detail is the only thing
 * that tells an admin *which* column is missing. Losing it silently downgrades
 * a precise message to a useless one, which is exactly the kind of regression
 * nobody notices until somebody is staring at a spreadsheet.
 */
import { describe, expect, it } from "vitest";
import {
	buildInviteCsvTemplate,
	buildInviteProblemCsv,
	INVITE_CSV_TEMPLATE_COLUMNS,
} from "./inviteCsv";
import {
	inviteOutcomeChip,
	inviteStatusChip,
	overrideForErrorCode,
	readInviteFailure,
} from "./inviteVerdicts";

describe("readInviteFailure", () => {
	it("pulls the column name out of a file-level CSV rejection", () => {
		expect(
			readInviteFailure({
				name: "VALIDATION_ERROR",
				message: "file: ERROR_INVITE_CSV_MISSING_COLUMN:email",
				fields: [{ field: "file", message: "ERROR_INVITE_CSV_MISSING_COLUMN:email" }],
			})
		).toEqual({ code: "ERROR_INVITE_CSV_MISSING_COLUMN", detail: "email" });
	});

	it("reports a code with no detail as detail-less rather than empty-stringed", () => {
		expect(
			readInviteFailure({
				name: "VALIDATION_ERROR",
				message: "email: ERROR_INVITE_CROSS_ORG",
				fields: [{ field: "email", message: "ERROR_INVITE_CROSS_ORG" }],
			})
		).toEqual({ code: "ERROR_INVITE_CROSS_ORG", detail: null });
	});

	it("reads a rate-limit code off a plain error message", () => {
		expect(
			readInviteFailure({ name: "RATE_LIMITED", message: "ERROR_INVITE_EMAIL_RATE_LIMITED" })
		).toEqual({ code: "ERROR_INVITE_EMAIL_RATE_LIMITED", detail: null });
	});

	it("does not let the shorter inviter code shadow the per-address one", () => {
		expect(readInviteFailure({ message: "ERROR_INVITE_RATE_LIMITED" }).code).toBe(
			"ERROR_INVITE_RATE_LIMITED"
		);
	});

	it("gives up quietly on something it does not recognize", () => {
		expect(readInviteFailure(new Error("socket hang up"))).toEqual({ code: null, detail: null });
	});
});

describe("overrideForErrorCode", () => {
	it("maps the two recoverable verdicts to their acknowledgements", () => {
		expect(overrideForErrorCode("ERROR_INVITE_CROSS_ORG")).toBe("acknowledgeOrgMove");
		expect(overrideForErrorCode("ERROR_INVITE_DUPLICATE_PENDING")).toBe("replaceExistingPending");
	});

	it("offers no way out of a verdict that has none", () => {
		expect(overrideForErrorCode("ERROR_INVITE_INVALID_EMAIL")).toBeNull();
		expect(overrideForErrorCode("ERROR_INVITE_DUPLICATE_IN_FILE")).toBeNull();
		expect(overrideForErrorCode(null)).toBeNull();
	});
});

describe("chips", () => {
	it("collapses every structural problem into one 'can't be sent' chip", () => {
		for (const status of [
			"invalid_email",
			"invalid_role",
			"invalid_organization",
			"invalid_restaurant_other_org",
		] as const) {
			expect(inviteStatusChip(status)).toEqual({
				labelKey: "userOnboarding.status.invalid",
				tone: "danger",
			});
		}
	});

	it("keeps the two acknowledgeable verdicts visually distinct from an error", () => {
		expect(inviteStatusChip("cross_org").tone).toBe("warning");
		expect(inviteStatusChip("duplicate_pending").tone).toBe("warning");
		expect(inviteStatusChip("ok").tone).toBe("success");
		expect(inviteStatusChip("already_member").tone).toBe("info");
	});

	it("tones the commit outcomes apart", () => {
		expect(inviteOutcomeChip("created").tone).toBe("success");
		expect(inviteOutcomeChip("skipped").tone).toBe("warning");
		expect(inviteOutcomeChip("failed").tone).toBe("danger");
	});
});

describe("CSV template", () => {
	it("uses the canonical column names the backend parser is keyed on", () => {
		expect(INVITE_CSV_TEMPLATE_COLUMNS).toEqual([
			"email",
			"role",
			"organization",
			"restaurants",
			"firstName",
			"paternalLastname",
			"maternalLastname",
		]);
	});

	it("ships a header and no data rows", () => {
		// An example row would come back on the next upload as a bogus invitation.
		expect(buildInviteCsvTemplate()).toBe(
			"email,role,organization,restaurants,firstName,paternalLastname,maternalLastname\r\n"
		);
	});

	it("quotes a reason that contains a comma so the report stays parseable", () => {
		const csv = buildInviteProblemCsv(
			[
				{
					rowNumber: 4,
					email: "bad@example.com",
					outcome: "Failed",
					reason: "Managers and employees need at least one restaurant, so this row stopped.",
				},
			],
			{ row: "Row", email: "Email", outcome: "Result", reason: "Reason" }
		);

		expect(csv).toBe(
			"Row,Email,Result,Reason\r\n" +
				'4,bad@example.com,Failed,"Managers and employees need at least one restaurant, so this row stopped."\r\n'
		);
	});
});
