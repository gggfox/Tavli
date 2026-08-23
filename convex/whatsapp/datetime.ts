/**
 * Date/time translation between the model and the database.
 *
 * The division of labour is deliberate: **the model does the natural-language
 * reasoning** ("next Friday", "mañana a las 8") and hands back a strict
 * `YYYY-MM-DD` + `HH:MM` pair; this module only validates that pair and converts
 * it to a UTC instant in the restaurant's timezone. No date parsing heuristics
 * live here — a model that emits "next friday" gets a rejection it can retry,
 * which is safer than us guessing what it meant.
 *
 * The system prompt is given the restaurant's current local date, time and
 * weekday (see `nowInRestaurant`); without that the model cannot resolve any
 * relative expression, and would silently anchor on its training cutoff.
 */
import {
	formatHm,
	parseHm,
	resolveRestaurantTimezone,
	utcMsToYmdInTimezone,
	ymdHmToUtcMs,
} from "../_util/timezone";
import { WHATSAPP_LOCALE, type WhatsappLocale } from "../constants";

/** Strict `YYYY-MM-DD`. Returns null on anything else, including real-looking junk. */
export function parseModelDate(date: string): string | null {
	const trimmed = date.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
	const [y, mo, d] = trimmed.split("-").map(Number);
	if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
	// Reject impossible days (2026-02-30) by round-tripping through UTC.
	const probe = new Date(Date.UTC(y, mo - 1, d));
	if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
	return trimmed;
}

/** Strict `HH:MM` (24-hour) → minutes from midnight, or null. */
export function parseModelTime(time: string): number | null {
	const trimmed = time.trim();
	// `parseHm` accepts "9:30"; normalize so callers see one canonical form.
	if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return null;
	return parseHm(trimmed);
}

export type ResolvedStart = {
	startsAt: number;
	/** Canonical forms, echoed back so the customer sees what we understood. */
	date: string;
	time: string;
};

/**
 * Convert a model-supplied local date + time into a UTC instant in the
 * restaurant's timezone. Returns null when either part is malformed.
 */
export function resolveRequestedStart(args: {
	date: string;
	time: string;
	timezone: string | undefined;
}): ResolvedStart | null {
	const date = parseModelDate(args.date);
	const minutes = parseModelTime(args.time);
	if (date === null || minutes === null) return null;
	const timezone = resolveRestaurantTimezone(args.timezone);
	return {
		startsAt: ymdHmToUtcMs(date, minutes, timezone),
		date,
		time: formatHm(minutes),
	};
}

/** The restaurant's local date, time and weekday right now, for the prompt. */
export function nowInRestaurant(
	timezone: string | undefined,
	nowMs: number
): { date: string; time: string; weekday: string; timezone: string } {
	const tz = resolveRestaurantTimezone(timezone);
	const date = utcMsToYmdInTimezone(nowMs, tz);
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: tz,
		hourCycle: "h23",
		hour: "2-digit",
		minute: "2-digit",
		weekday: "long",
	}).formatToParts(new Date(nowMs));
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
	return {
		date,
		time: `${get("hour")}:${get("minute")}`,
		weekday: get("weekday"),
		timezone: tz,
	};
}

/**
 * Split a UTC instant into the restaurant-local `YYYY-MM-DD` and `HH:MM` used in
 * every projection handed to the model. Keeping epoch ms out of tool output
 * means the model has no timestamp to invent variations of.
 */
export function toLocalDateTimeParts(
	utcMs: number,
	timezone: string | undefined
): { date: string; time: string } {
	const tz = resolveRestaurantTimezone(timezone);
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: tz,
		hourCycle: "h23",
		hour: "2-digit",
		minute: "2-digit",
	}).formatToParts(new Date(utcMs));
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
	return {
		date: utcMsToYmdInTimezone(utcMs, tz),
		time: `${get("hour")}:${get("minute")}`,
	};
}

/** Human-readable local date+time for a customer-facing confirmation line. */
export function formatLocalDateTime(
	utcMs: number,
	timezone: string | undefined,
	locale: WhatsappLocale
): string {
	const tz = resolveRestaurantTimezone(timezone);
	return new Intl.DateTimeFormat(locale === WHATSAPP_LOCALE.ES ? "es-MX" : "en-US", {
		timeZone: tz,
		weekday: "short",
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(new Date(utcMs));
}
