/**
 * CSV in and CSV out for admin bulk onboarding.
 *
 * **In** — the template an admin downloads before filling a file. Its header is
 * built from `INVITE_CSV_COLUMN`, the same constant the backend's alias table is
 * keyed on, so the template can never drift from what the parser accepts.
 *
 * **Out** — the problem rows of a finished run, so a 500-row upload that had 12
 * bad addresses can be fixed and re-uploaded instead of re-typed. Reasons are
 * written already localized: the file is for a human, not for a re-import.
 *
 * The writing side stays here rather than reaching for `convex/exports.ts`'s
 * `toCsv`, which is a Convex module the frontend must not import.
 */
import { INVITE_CSV_COLUMN } from "convex/inviteOnboardingHelpers";

/**
 * The template header, in the order an admin most naturally fills it. Only
 * `email`, `role` and `organization` are required; the rest are accepted and
 * may be left blank.
 */
export const INVITE_CSV_TEMPLATE_COLUMNS: readonly string[] = [
	INVITE_CSV_COLUMN.EMAIL,
	INVITE_CSV_COLUMN.ROLE,
	INVITE_CSV_COLUMN.ORGANIZATION,
	INVITE_CSV_COLUMN.RESTAURANTS,
	INVITE_CSV_COLUMN.FIRST_NAME,
	INVITE_CSV_COLUMN.PATERNAL_LASTNAME,
	INVITE_CSV_COLUMN.MATERNAL_LASTNAME,
];

export const INVITE_CSV_TEMPLATE_FILENAME = "tavli-invite-template.csv";
export const INVITE_PROBLEM_CSV_FILENAME = "tavli-invite-problems.csv";

/** RFC-4180 quoting: wrap when the value could otherwise break the grammar. */
function csvEscape(value: string): string {
	if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
	return value;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
	return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

/**
 * A header-only template. Deliberately no example row: an example is itself a
 * data row, so it would come back on the next upload as a bogus invitation the
 * admin has to notice and delete. The dialog documents the format in prose
 * instead, where it costs nothing.
 */
export function buildInviteCsvTemplate(): string {
	return `${toCsv([INVITE_CSV_TEMPLATE_COLUMNS])}\r\n`;
}

export interface InviteProblemRow {
	readonly rowNumber: number;
	readonly email: string;
	/** Already localized. */
	readonly outcome: string;
	/** Already localized. */
	readonly reason: string;
}

export interface InviteProblemCsvHeaders {
	readonly row: string;
	readonly email: string;
	readonly outcome: string;
	readonly reason: string;
}

export function buildInviteProblemCsv(
	rows: readonly InviteProblemRow[],
	headers: InviteProblemCsvHeaders
): string {
	const body = rows.map((row) => [String(row.rowNumber), row.email, row.outcome, row.reason]);
	return `${toCsv([[headers.row, headers.email, headers.outcome, headers.reason], ...body])}\r\n`;
}

/**
 * Save a string as a CSV download.
 *
 * The BOM is what makes Excel open a UTF-8 file as UTF-8 instead of mangling
 * accented names; the backend's parser strips a leading BOM, so a file that
 * round-trips through Excel still uploads cleanly.
 */
export function downloadCsv(filename: string, content: string): void {
	const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	URL.revokeObjectURL(url);
}
