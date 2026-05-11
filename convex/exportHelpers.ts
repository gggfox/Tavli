/**
 * Shared helpers for Excel exports.
 *
 * Generates xlsx workbooks server-side inside Convex V8 actions using SheetJS.
 * The actions return base64 strings; the browser decodes and triggers download.
 *
 * Month bucketing respects each restaurant's IANA timezone via Intl.DateTimeFormat.
 * Currency values are stored as integer cents and formatted to decimal for humans.
 */
import * as XLSX from "xlsx";

export const DEFAULT_TIMEZONE = "UTC";

const FALLBACK_DATE = "—";

const PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function getPartsFormatter(timeZone: string): Intl.DateTimeFormat {
	const cached = PARTS_FORMATTER_CACHE.get(timeZone);
	if (cached) return cached;
	let fmt: Intl.DateTimeFormat;
	try {
		fmt = new Intl.DateTimeFormat("en-US", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
	} catch {
		fmt = new Intl.DateTimeFormat("en-US", {
			timeZone: DEFAULT_TIMEZONE,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
	}
	PARTS_FORMATTER_CACHE.set(timeZone, fmt);
	return fmt;
}

interface DateTimeParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
}

function extractParts(timeZone: string, ms: number): DateTimeParts | null {
	if (!Number.isFinite(ms)) return null;
	const fmt = getPartsFormatter(timeZone);
	const parts = fmt.formatToParts(new Date(ms));
	const lookup = (type: string) => {
		const found = parts.find((p) => p.type === type);
		return found ? Number(found.value) : Number.NaN;
	};
	const year = lookup("year");
	const month = lookup("month");
	const day = lookup("day");
	let hour = lookup("hour");
	const minute = lookup("minute");
	// Intl returns "24" for midnight in hour12:false on some runtimes.
	if (hour === 24) hour = 0;
	if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return null;
	return { year, month, day, hour, minute };
}

/** Format an epoch-ms timestamp as `YYYY-MM-DD HH:mm` in the given timezone. */
export function formatLocalTimestamp(ms: number | undefined | null, timeZone: string): string {
	if (ms == null) return "";
	const p = extractParts(timeZone, ms);
	if (!p) return "";
	const pad = (n: number, width = 2) => String(n).padStart(width, "0");
	return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Format an epoch-ms timestamp as `YYYY-MM-DD` in the given timezone. */
export function formatLocalDate(ms: number | undefined | null, timeZone: string): string {
	if (ms == null) return FALLBACK_DATE;
	const p = extractParts(timeZone, ms);
	if (!p) return FALLBACK_DATE;
	const pad = (n: number, width = 2) => String(n).padStart(width, "0");
	return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Calendar year for an epoch-ms timestamp in the given timezone. */
export function yearInTz(ms: number, timeZone: string): number | null {
	const p = extractParts(timeZone, ms);
	return p ? p.year : null;
}

/**
 * Returns the 0-based month index (0=Jan ... 11=Dec) for an epoch-ms timestamp
 * in the given timezone, or null if the timestamp does not fall in `year`.
 */
export function monthIndexInTz(
	ms: number | undefined | null,
	year: number,
	timeZone: string
): number | null {
	if (ms == null) return null;
	const p = extractParts(timeZone, ms);
	if (!p) return null;
	if (p.year !== year) return null;
	return p.month - 1;
}

/**
 * Returns the 0-based month index for a `YYYY-MM-DD` business-day key,
 * or null if the key is malformed or not in `year`.
 */
export function monthIndexFromYmd(
	ymd: string | undefined | null,
	year: number
): number | null {
	if (!ymd) return null;
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
	if (!m) return null;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	if (y !== year) return null;
	if (mo < 1 || mo > 12) return null;
	return mo - 1;
}

/** Format integer cents as a decimal string ("12.34"). Empty for null/undefined. */
export function formatMoneyCents(cents: number | undefined | null): string {
	if (cents == null || !Number.isFinite(cents)) return "";
	const sign = cents < 0 ? "-" : "";
	const abs = Math.abs(cents);
	const whole = Math.trunc(abs / 100);
	const frac = abs % 100;
	return `${sign}${whole}.${String(frac).padStart(2, "0")}`;
}

/**
 * Locale-aware long month names. The first element is January.
 * Falls back to English if the locale is unknown.
 */
const MONTH_NAME_CACHE = new Map<string, string[]>();

export function getMonthNames(locale: string): string[] {
	const cached = MONTH_NAME_CACHE.get(locale);
	if (cached) return cached;
	const names: string[] = [];
	for (let m = 0; m < 12; m++) {
		try {
			const fmt = new Intl.DateTimeFormat(locale, { month: "long" });
			// Use a fixed UTC date that is unambiguously the 15th of each month.
			names.push(fmt.format(new Date(Date.UTC(2024, m, 15))));
		} catch {
			names.push(
				[
					"January",
					"February",
					"March",
					"April",
					"May",
					"June",
					"July",
					"August",
					"September",
					"October",
					"November",
					"December",
				][m]
			);
		}
	}
	MONTH_NAME_CACHE.set(locale, names);
	return names;
}

// Excel sheet names: max 31 chars, cannot contain : \ / ? * [ ]
const ILLEGAL_SHEET_CHARS = /[:\\/?*[\]]/g;

export function safeSheetName(name: string): string {
	const cleaned = name.replaceAll(ILLEGAL_SHEET_CHARS, " ").trim() || "Sheet";
	return cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned;
}

export type CellValue = string | number | null;

export interface SheetSpec<T> {
	name: string;
	headers: string[];
	rows: T[];
	mapRow: (row: T) => CellValue[];
}

export interface SummarySpec {
	name: string;
	headers: string[];
	rows: CellValue[][];
}

export interface MonthlySheetSpec<T> {
	monthIndex: number;
	sheetName: string;
	rows: T[];
}

export interface BuildMonthlyWorkbookArgs<T> {
	monthlySheets: MonthlySheetSpec<T>[];
	headers: string[];
	mapRow: (row: T) => CellValue[];
	summary?: SummarySpec;
}

/**
 * Build a base64-encoded xlsx workbook. Always emits the Summary sheet first
 * (if provided), followed by sheets in the order given. Empty sheets get a
 * header row so the file remains usable.
 */
export function buildMonthlyWorkbook<T>(args: BuildMonthlyWorkbookArgs<T>): string {
	const workbook = XLSX.utils.book_new();

	if (args.summary) {
		const aoa: CellValue[][] = [args.summary.headers, ...args.summary.rows];
		const sheet = XLSX.utils.aoa_to_sheet(aoa);
		XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(args.summary.name));
	}

	for (const spec of args.monthlySheets) {
		const aoa: CellValue[][] = [args.headers];
		for (const row of spec.rows) {
			aoa.push(args.mapRow(row));
		}
		const sheet = XLSX.utils.aoa_to_sheet(aoa);
		XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(spec.sheetName));
	}

	return XLSX.write(workbook, { type: "base64", bookType: "xlsx", compression: true });
}

export interface SectionSheet<T> {
	name: string;
	headers: string[];
	rows: T[];
	mapRow: (row: T) => CellValue[];
}

/**
 * Build a base64-encoded xlsx workbook from a list of named sheets.
 * Used for the menu snapshot (Menus, Categories, Items, OptionGroups, Options).
 */
export function buildSectionedWorkbook(sections: SectionSheet<unknown>[]): string {
	const workbook = XLSX.utils.book_new();
	for (const section of sections) {
		const aoa: CellValue[][] = [section.headers];
		for (const row of section.rows) {
			aoa.push(section.mapRow(row));
		}
		const sheet = XLSX.utils.aoa_to_sheet(aoa);
		XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(section.name));
	}
	return XLSX.write(workbook, { type: "base64", bookType: "xlsx", compression: true });
}

/**
 * Approximate the byte-size of a base64 string. Used as a guardrail so we can
 * abort with a helpful error before hitting Convex's action response cap.
 */
export function approxBase64Bytes(base64: string): number {
	if (!base64) return 0;
	let padding = 0;
	if (base64.endsWith("==")) padding = 2;
	else if (base64.endsWith("=")) padding = 1;
	return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Convex's action response cap is ~8 MB. We abort proactively a bit under that
 * so the error is friendlier than an opaque "response too large".
 */
export const MAX_EXPORT_BASE64_BYTES = 7 * 1024 * 1024;

export function exportTooLargeMessage(year?: number): string {
	const yearText = year ? ` for ${year}` : "";
	return `Export${yearText} is too large to download in a single file. Please contact support to receive the data in chunks.`;
}
