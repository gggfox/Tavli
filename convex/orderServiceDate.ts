/** Default 04:00 local = start of business “order day” for numbering. */
export const DEFAULT_ORDER_DAY_START_MINUTES = 240;

function resolveTimeZone(timeZone: string | undefined): string {
	const raw = timeZone?.trim();
	const tz = raw && raw.length > 0 ? raw : "UTC";
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
		return tz;
	} catch {
		return "UTC";
	}
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
