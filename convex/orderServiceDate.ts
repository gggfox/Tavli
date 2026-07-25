import { resolveRestaurantTimezone } from "./_util/timezone";
import { DEFAULT_ORDER_NUMBER_RESET_FREQUENCY, type OrderNumberResetFrequency } from "./constants";

/** Default 04:00 local = start of business “order day” for numbering. */
export const DEFAULT_ORDER_DAY_START_MINUTES = 240;

/**
 * Service-date bucketing must resolve timezones the same way everything else
 * does. This used to fall back to UTC while `resolveRestaurantTimezone` fell
 * back to `America/Mexico_City` -- six hours of skew straddling the 04:00
 * rollover, so a restaurant with no `timezone` set filed orders under the wrong
 * service date. Only legacy rows are affected: `restaurants.create` has resolved
 * the timezone at write time since it was added.
 */
function resolveTimeZone(timeZone: string | undefined): string {
	return resolveRestaurantTimezone(timeZone);
}

/**
 * Returns the stable YYYY-MM-DD business-day label for `nowMs` in the restaurant
 * timezone, using `orderDayStartMinutesFromMidnight` as the rollover (exclusive:
 * times strictly before it belong to the previous calendar day’s service date).
 */
export function getOrderServiceDateKey(
	nowMs: number,
	timeZone: string | undefined,
	orderDayStartMinutesFromMidnight: number | undefined
): string {
	const cutoff = orderDayStartMinutesFromMidnight ?? DEFAULT_ORDER_DAY_START_MINUTES;
	const tz = resolveTimeZone(timeZone);

	const dtf = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});

	const parts = dtf.formatToParts(new Date(nowMs));
	const num = (type: Intl.DateTimeFormatPartTypes) =>
		Number.parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

	const y = num("year");
	const m = num("month");
	const d = num("day");
	const hour = num("hour");
	const minute = num("minute");
	const minutesFromMidnight = hour * 60 + minute;

	if (minutesFromMidnight < cutoff) {
		const u = new Date(Date.UTC(y, m - 1, d - 1));
		const yy = u.getUTCFullYear();
		const mm = u.getUTCMonth() + 1;
		const dd = u.getUTCDate();
		return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
	}

	return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * ISO 8601 week of a calendar date. Monday-start; the ISO year of a date is the
 * year that owns the Thursday of that date's week. Computed in UTC since the
 * input `y/m/d` came from a TZ-aware formatter.
 */
function isoWeekOfYMD(y: number, m: number, d: number): { isoYear: number; isoWeek: number } {
	const date = new Date(Date.UTC(y, m - 1, d));
	const dayMon0 = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
	date.setUTCDate(date.getUTCDate() - dayMon0 + 3); // shift to Thursday
	const isoYear = date.getUTCFullYear();
	const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
	const firstThursdayDayMon0 = (firstThursday.getUTCDay() + 6) % 7;
	firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayMon0 + 3);
	const msPerWeek = 7 * 24 * 60 * 60 * 1000;
	const isoWeek = 1 + Math.round((date.getTime() - firstThursday.getTime()) / msPerWeek);
	return { isoYear, isoWeek };
}

/**
 * Period key for the per-restaurant order-number counter. Built on top of
 * `getOrderServiceDateKey` so cutoff + timezone behaviour stays consistent
 * across frequencies — a payment confirmed before the cutoff belongs to the
 * previous calendar day's period (and therefore the previous week / month
 * when that day is on the boundary).
 *
 *  - daily    → `YYYY-MM-DD` (legacy shape; counter resets each business day)
 *  - weekly   → `YYYY-Www`   (ISO 8601 week, Monday-start)
 *  - biweekly → `YYYY-Bnn`   where nn = floor(isoWeek / 2) * 2
 *  - monthly  → `YYYY-MM`    (calendar month of the business day)
 */
export function getOrderResetPeriodKey(
	nowMs: number,
	timeZone: string | undefined,
	orderDayStartMinutesFromMidnight: number | undefined,
	frequency: OrderNumberResetFrequency | undefined
): string {
	const dailyKey = getOrderServiceDateKey(nowMs, timeZone, orderDayStartMinutesFromMidnight);
	const f = frequency ?? DEFAULT_ORDER_NUMBER_RESET_FREQUENCY;

	if (f === "daily") return dailyKey;
	if (f === "monthly") return dailyKey.slice(0, 7);

	const [yStr, mStr, dStr] = dailyKey.split("-");
	const y = Number.parseInt(yStr ?? "0", 10);
	const m = Number.parseInt(mStr ?? "0", 10);
	const d = Number.parseInt(dStr ?? "0", 10);
	const { isoYear, isoWeek } = isoWeekOfYMD(y, m, d);

	if (f === "weekly") {
		return `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
	}
	const biweekBucket = Math.floor(isoWeek / 2) * 2;
	return `${isoYear}-B${String(biweekBucket).padStart(2, "0")}`;
}
