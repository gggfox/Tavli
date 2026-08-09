/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * The bulk CSV flow, from dropped file to result report.
 *
 * What is actually being guarded: the preview is a *consent screen*. Every test
 * below is a way that consent could be faked — a dangerous row pre-ticked, a
 * row the admin never ticked riding along in the payload, an acknowledgement
 * that fails to reach the server, a cancel that turns out to have created
 * something.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Id } from "convex/_generated/dataModel";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_A = "organizations:a" as Id<"organizations">;
const REST_A1 = "restaurants:a1" as Id<"restaurants">;

/** Convex result tuples are `[value, null] | [null, error]`, so these stay `any`. */
const hoisted = vi.hoisted(() => ({
	uploadUrlMock: vi.fn(async (): Promise<any> => ["https://upload.example/put", null]),
	previewMock: vi.fn(async (_args: unknown): Promise<any> => [{ rows: [], counts: {} }, null]),
	commitMock: vi.fn(
		async (_args: unknown): Promise<any> => [
			{ bulkImportId: "bulk-1", results: [], counts: {} },
			null,
		]
	),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: any, args: unknown) => ({ queryKey: [getFunctionName(ref), args] }),
	useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
	useConvexAction: () => hoisted.previewMock,
	useConvexMutation: (ref: any) =>
		getFunctionName(ref).includes("commitBulkInvitations")
			? hoisted.commitMock
			: hoisted.uploadUrlMock,
}));

import { BulkInviteDialog } from "./BulkInviteDialog";

/** One row of every classification the backend can hand back. */
const PREVIEW_ROWS = [
	{
		rowNumber: 1,
		email: "clean@example.com",
		role: "manager",
		organizationId: ORG_A,
		organizationName: "Alpha Group",
		restaurantIds: [REST_A1],
		restaurantNames: ["Alpha Diner"],
		status: "ok",
		blocked: false,
		override: null,
		errorCode: null,
	},
	{
		rowNumber: 2,
		email: "elsewhere@example.com",
		role: "owner",
		organizationId: ORG_A,
		organizationName: "Alpha Group",
		restaurantIds: [],
		restaurantNames: [],
		status: "cross_org",
		blocked: true,
		override: "acknowledgeOrgMove",
		errorCode: "ERROR_INVITE_CROSS_ORG",
	},
	{
		rowNumber: 3,
		email: "waiting@example.com",
		role: "employee",
		organizationId: ORG_A,
		organizationName: "Alpha Group",
		restaurantIds: [REST_A1],
		restaurantNames: ["Alpha Diner"],
		status: "duplicate_pending",
		blocked: true,
		override: "replaceExistingPending",
		errorCode: "ERROR_INVITE_DUPLICATE_PENDING",
	},
	{
		rowNumber: 4,
		email: "not-an-email",
		role: null,
		organizationId: null,
		organizationName: null,
		restaurantIds: [],
		restaurantNames: [],
		status: "invalid_email",
		blocked: true,
		override: null,
		errorCode: "ERROR_INVITE_INVALID_EMAIL",
	},
	{
		rowNumber: 5,
		email: "already@example.com",
		role: "manager",
		organizationId: ORG_A,
		organizationName: "Alpha Group",
		restaurantIds: [REST_A1],
		restaurantNames: ["Alpha Diner"],
		status: "already_member",
		blocked: false,
		override: null,
		errorCode: null,
	},
];

const PREVIEW_COUNTS = {
	total: 5,
	ok: 1,
	alreadyMember: 1,
	crossOrg: 1,
	duplicatePending: 1,
	duplicateInFile: 0,
	invalid: 1,
};

function csvFile(name = "invites.csv") {
	return new File(["email,role,organization\n"], name, { type: "text/csv" });
}

async function dropFile(file = csvFile()) {
	fireEvent.drop(screen.getByRole("button", { name: /Drop a CSV here/ }), {
		dataTransfer: { files: [file] },
	});
	await waitFor(() => expect(screen.getByText("Review before sending")).toBeInTheDocument());
}

const rowCheckbox = (email: string) => screen.getByLabelText(`Send an invitation to ${email}`);

beforeEach(() => {
	HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
		this.setAttribute("open", "");
	});
	HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
		this.removeAttribute("open");
	});

	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ ok: true, json: async () => ({ storageId: "storage:1" }) }))
	);
	URL.createObjectURL = vi.fn(() => "blob:stub");
	URL.revokeObjectURL = vi.fn();

	hoisted.uploadUrlMock = vi.fn(async (): Promise<any> => ["https://upload.example/put", null]);
	hoisted.previewMock = vi.fn(
		async (_args: unknown): Promise<any> => [{ rows: PREVIEW_ROWS, counts: PREVIEW_COUNTS }, null]
	);
	hoisted.commitMock = vi.fn(
		async (_args: unknown): Promise<any> => [
			{
				bulkImportId: "bulk-1",
				results: [
					{
						rowNumber: 1,
						email: "clean@example.com",
						outcome: "created",
						status: "ok",
						code: null,
						invitationId: "invitations:1",
					},
				],
				counts: { requested: 1, created: 1, skipped: 0, failed: 0 },
			},
			null,
		]
	);
});

describe("BulkInviteDialog — preview", () => {
	it("classifies every row and refuses a file that is not a CSV", async () => {
		render(<BulkInviteDialog isOpen onClose={vi.fn()} />);

		fireEvent.drop(screen.getByRole("button", { name: /Drop a CSV here/ }), {
			dataTransfer: { files: [new File(["%PDF"], "roster.pdf", { type: "application/pdf" })] },
		});
		expect(
			screen.getByText("That isn't a CSV file. Export your spreadsheet as CSV and try again.")
		).toBeInTheDocument();
		expect(hoisted.uploadUrlMock).not.toHaveBeenCalled();

		await dropFile();

		expect(screen.getByText("5 rows read")).toBeInTheDocument();
		expect(screen.getByText("Ready to send")).toBeInTheDocument();
		expect(screen.getByText("Belongs to another organization")).toBeInTheDocument();
		expect(screen.getByText("Already invited")).toBeInTheDocument();
		expect(screen.getByText("Already in this organization")).toBeInTheDocument();
		expect(screen.getByText("Can't be sent")).toBeInTheDocument();
		// The reason column speaks English, never the stable code.
		expect(screen.getByText("That isn't a valid email address.")).toBeInTheDocument();
		expect(screen.queryByText(/ERROR_INVITE/)).toBeNull();
	});

	it("starts with nothing ticked, and never offers a tick for an unfixable row", async () => {
		render(<BulkInviteDialog isOpen onClose={vi.fn()} />);
		await dropFile();

		for (const email of ["clean@example.com", "elsewhere@example.com", "waiting@example.com"]) {
			expect(rowCheckbox(email)).not.toBeChecked();
		}
		// A bad address cannot be acknowledged into existence.
		expect(screen.queryByLabelText("Send an invitation to not-an-email")).toBeNull();
		expect(screen.getByRole("button", { name: /^Send 0 invitations$/ })).toBeDisabled();
	});

	it("select-all-safe leaves the dangerous rows alone", async () => {
		render(<BulkInviteDialog isOpen onClose={vi.fn()} />);
		await dropFile();

		fireEvent.click(screen.getByRole("button", { name: "Select every safe row" }));

		expect(rowCheckbox("clean@example.com")).toBeChecked();
		expect(rowCheckbox("already@example.com")).toBeChecked();
		expect(rowCheckbox("elsewhere@example.com")).not.toBeChecked();
		expect(rowCheckbox("waiting@example.com")).not.toBeChecked();
		expect(screen.getByText("2 selected to send")).toBeInTheDocument();
	});

	it("warns about the cross-organization rows and can acknowledge them together", async () => {
		render(<BulkInviteDialog isOpen onClose={vi.fn()} />);
		await dropFile();

		expect(
			screen.getByText(
				"1 row belongs to another organization. Ticking it moves that person out of the organization they are in today."
			)
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Move all 1 of them" }));
		expect(rowCheckbox("elsewhere@example.com")).toBeChecked();
	});
});

describe("BulkInviteDialog — commit", () => {
	it("sends only the ticked rows, carrying each row's acknowledgement", async () => {
		render(<BulkInviteDialog isOpen onClose={vi.fn()} />);
		await dropFile();

		fireEvent.click(rowCheckbox("clean@example.com"));
		fireEvent.click(rowCheckbox("elsewhere@example.com"));
		fireEvent.click(screen.getByRole("button", { name: /^Send 2 invitations$/ }));

		await waitFor(() => expect(hoisted.commitMock).toHaveBeenCalledTimes(1));

		const payload = hoisted.commitMock.mock.calls[0][0] as any;
		expect(payload.rows.map((row: any) => row.rowNumber)).toEqual([1, 2]);
		// The rows nobody ticked are simply absent — not sent-and-skipped.
		expect(payload.rows.map((row: any) => row.email)).not.toContain("waiting@example.com");
		expect(payload.rows.map((row: any) => row.email)).not.toContain("already@example.com");
		expect(payload.rows[0]).toMatchObject({
			email: "clean@example.com",
			role: "manager",
			organizationId: ORG_A,
			restaurantIds: [REST_A1],
		});
		expect(payload.rows[0].acknowledgeOrgMove).toBeUndefined();
		expect(payload.rows[1]).toMatchObject({
			email: "elsewhere@example.com",
			acknowledgeOrgMove: true,
		});
		expect(payload.rows[1].replaceExistingPending).toBeUndefined();
	});

	it("carries the replace acknowledgement for a pending duplicate", async () => {
		render(<BulkInviteDialog isOpen onClose={vi.fn()} />);
		await dropFile();

		fireEvent.click(rowCheckbox("waiting@example.com"));
		fireEvent.click(screen.getByRole("button", { name: /^Send 1 invitations$/ }));

		await waitFor(() => expect(hoisted.commitMock).toHaveBeenCalledTimes(1));
		expect((hoisted.commitMock.mock.calls[0][0] as any).rows[0]).toMatchObject({
			email: "waiting@example.com",
			replaceExistingPending: true,
		});
	});

	it("creates nothing when the admin cancels out of the preview", async () => {
		const onClose = vi.fn();
		render(<BulkInviteDialog isOpen onClose={onClose} />);
		await dropFile();

		fireEvent.click(rowCheckbox("clean@example.com"));
		fireEvent.click(rowCheckbox("elsewhere@example.com"));
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(hoisted.commitMock).not.toHaveBeenCalled();
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});

describe("BulkInviteDialog — report", () => {
	it("reports every row's outcome with a readable reason", async () => {
		hoisted.commitMock = vi.fn(
			async (_args: unknown): Promise<any> => [
				{
					bulkImportId: "bulk-1",
					results: [
						{
							rowNumber: 1,
							email: "clean@example.com",
							outcome: "created",
							status: "ok",
							code: null,
							invitationId: "invitations:1",
						},
						{
							rowNumber: 2,
							email: "elsewhere@example.com",
							outcome: "skipped",
							status: "cross_org",
							code: "ERROR_INVITE_CROSS_ORG",
							invitationId: null,
						},
						{
							rowNumber: 3,
							email: "waiting@example.com",
							outcome: "failed",
							status: "duplicate_pending",
							code: "ERROR_INVITE_EMAIL_RATE_LIMITED",
							invitationId: null,
						},
					],
					counts: { requested: 3, created: 1, skipped: 1, failed: 1 },
				},
				null,
			]
		);

		render(<BulkInviteDialog isOpen onClose={vi.fn()} />);
		await dropFile();

		fireEvent.click(rowCheckbox("clean@example.com"));
		fireEvent.click(rowCheckbox("elsewhere@example.com"));
		fireEvent.click(rowCheckbox("waiting@example.com"));
		fireEvent.click(screen.getByRole("button", { name: /^Send 3 invitations$/ }));

		await waitFor(() => expect(screen.getByText("Result of this upload")).toBeInTheDocument());

		expect(screen.getByText("1 sent, 1 skipped, 1 failed.")).toBeInTheDocument();
		expect(screen.getByText("Invitation sent")).toBeInTheDocument();
		expect(screen.getByText("Skipped")).toBeInTheDocument();
		expect(screen.getByText("Failed")).toBeInTheDocument();
		expect(
			screen.getByText(
				"This address has already been invited several times today. Please try again tomorrow."
			)
		).toBeInTheDocument();
		// The problem rows are recoverable without re-typing the file.
		expect(screen.getByRole("button", { name: "Download the problem rows" })).toBeInTheDocument();
	});

	it("keeps the invitations an interrupted run already sent, and says it stopped", async () => {
		hoisted.commitMock = vi.fn(
			async (_args: unknown): Promise<any> => [
				null,
				{ name: "RATE_LIMITED", message: "ERROR_INVITE_RATE_LIMITED" },
			]
		);

		render(<BulkInviteDialog isOpen onClose={vi.fn()} />);
		await dropFile();

		fireEvent.click(rowCheckbox("clean@example.com"));
		fireEvent.click(screen.getByRole("button", { name: /^Send 1 invitations$/ }));

		await waitFor(() => expect(screen.getByText("Result of this upload")).toBeInTheDocument());
		expect(screen.getByText("0 sent, 0 skipped, 0 failed.")).toBeInTheDocument();
		expect(screen.getByText(/The run stopped early/)).toBeInTheDocument();
		expect(
			screen.getByText(
				/You've sent a lot of invitations in the last hour\. Please wait a while before sending more\./
			)
		).toBeInTheDocument();
	});
});

describe("BulkInviteDialog — file-level failures", () => {
	it("names the column a rejected file is missing", async () => {
		hoisted.previewMock = vi.fn(
			async (_args: unknown): Promise<any> => [
				null,
				{
					name: "VALIDATION_ERROR",
					message: "file: ERROR_INVITE_CSV_MISSING_COLUMN:email",
					fields: [{ field: "file", message: "ERROR_INVITE_CSV_MISSING_COLUMN:email" }],
				},
			]
		);

		render(<BulkInviteDialog isOpen onClose={vi.fn()} />);
		fireEvent.drop(screen.getByRole("button", { name: /Drop a CSV here/ }), {
			dataTransfer: { files: [csvFile()] },
		});

		await waitFor(() =>
			expect(screen.getByText("Your file is missing a required column: email.")).toBeInTheDocument()
		);
		// Back at the dropzone, with nothing created.
		expect(screen.getByRole("button", { name: /Drop a CSV here/ })).toBeInTheDocument();
		expect(hoisted.commitMock).not.toHaveBeenCalled();
	});

	it("offers a template whose header is exactly what the parser accepts", () => {
		render(<BulkInviteDialog isOpen onClose={vi.fn()} />);

		const format = screen.getByText("File format").parentElement as HTMLElement;
		expect(
			within(format).getByText("Required columns: email, role, organization.")
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Download the CSV template" })).toBeInTheDocument();
	});
});
