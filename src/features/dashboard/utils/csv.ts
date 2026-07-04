/**
 * Minimal client-side CSV export for dashboard widgets.
 *
 * Builds a CSV string from an array of plain row objects (header = the keys of
 * the first row, in declaration order) and triggers a browser download. No
 * dependency — a future server-side Excel/PDF exporter (see TAVLI-2 deferred
 * scope) can replace the widget call sites without touching this contract.
 */
export function downloadCsv(filename: string, rows: ReadonlyArray<Record<string, unknown>>): void {
	if (rows.length === 0) return;

	const headers = Object.keys(rows[0]);
	const lines = [headers.map(escapeCsvCell).join(",")];
	for (const row of rows) {
		lines.push(headers.map((header) => escapeCsvCell(row[header])).join(","));
	}

	// Prepend a BOM so Excel opens UTF-8 (accents in category / server names).
	const blob = new Blob(["﻿" + lines.join("\r\n")], {
		type: "text/csv;charset=utf-8;",
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

function escapeCsvCell(value: unknown): string {
	if (value === null || value === undefined) return "";
	const str = String(value);
	return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}
