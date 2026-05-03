/**
 * URL-backed reservations dashboard prefs with localStorage fallback.
 * On first load, missing URL keys are merged from storage so sidebar
 * navigation back to this route preserves filters and view mode.
 */
import type { ReservationStatus } from "@/features/reservations/statusConfig";
import { RESERVATION_STATUS_CONFIG } from "@/features/reservations/statusConfig";
import {
	ORDERED_RANGES,
	type ReservationRange,
} from "@/features/reservations/utils";
import { isValidYmd } from "@/global/utils/calendarMonth";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "tavli.reservations.dashboard.preferences";
const STORAGE_VERSION = 1 as const;

export type ReservationsViewMode = "cards" | "table";

export type ReservationDashboardRangeValue = ReservationRange | "custom";

type StoredPrefs = {
	readonly version: typeof STORAGE_VERSION;
	readonly range: ReservationRange;
	readonly status: ReservationStatus[];
	readonly view: ReservationsViewMode;
	readonly day?: string;
};

export type ReservationsDashboardSearch = {
	readonly focus?: string;
	readonly range?: ReservationRange;
	readonly day?: string;
	readonly status?: string;
	readonly view?: ReservationsViewMode;
};

const VALID_STATUSES = new Set(
	RESERVATION_STATUS_CONFIG.map((s) => s.value)
) as ReadonlySet<ReservationStatus>;

const VALID_RANGES = new Set<string>(ORDERED_RANGES);

function parseRange(raw: unknown): ReservationRange | undefined {
	if (typeof raw !== "string") return undefined;
	return VALID_RANGES.has(raw) ? (raw as ReservationRange) : undefined;
}

function parseDay(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	return isValidYmd(raw) ? raw : undefined;
}

function parseView(raw: unknown): ReservationsViewMode | undefined {
	if (raw === "cards" || raw === "table") return raw;
	return undefined;
}

function parseStatusParam(raw: unknown): ReservationStatus[] | undefined {
	if (typeof raw !== "string" || !raw.trim()) return undefined;
	const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
	const out: ReservationStatus[] = [];
	for (const p of parts) {
		if (VALID_STATUSES.has(p as ReservationStatus)) out.push(p as ReservationStatus);
	}
	return out.length ? out : undefined;
}

function statusesToParam(statuses: Set<ReservationStatus>): string | undefined {
	if (statuses.size === 0) return undefined;
	return [...statuses].sort((a, b) => a.localeCompare(b)).join(",");
}

function readStoredPrefs(): StoredPrefs | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
		if (parsed.version !== STORAGE_VERSION) return null;
		if (!parsed.range || !VALID_RANGES.has(parsed.range)) return null;
		const view = parsed.view === "table" ? "table" : "cards";
		const status = Array.isArray(parsed.status)
			? parsed.status.filter((s): s is ReservationStatus => VALID_STATUSES.has(s as ReservationStatus))
			: [];
		const day =
			typeof parsed.day === "string" && isValidYmd(parsed.day) ? parsed.day : undefined;
		return {
			version: STORAGE_VERSION,
			range: parsed.range as ReservationRange,
			status,
			view,
			day,
		};
	} catch {
		return null;
	}
}

function writeStoredPrefs(prefs: Omit<StoredPrefs, "version">): void {
	if (typeof window === "undefined") return;
	try {
		const payload: StoredPrefs = {
			version: STORAGE_VERSION,
			range: prefs.range,
			status: prefs.status,
			view: prefs.view,
			...(prefs.day ? { day: prefs.day } : {}),
		};
		localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	} catch {
		// ignore quota / private mode
	}
}

export function useReservationsDashboardPrefs() {
	const navigate = useNavigate();
	const search = useSearch({ strict: false }) as ReservationsDashboardSearch;

	const storedOnce = useMemo(() => readStoredPrefs(), []);
	const [prefsHydrated, setPrefsHydrated] = useState(false);

	useEffect(() => {
		const stored = readStoredPrefs();
		if (!stored) {
			setPrefsHydrated(true);
			return;
		}

		navigate({
			// @ts-expect-error -- search merge preserves parent keys (e.g. orderId) while hydrating prefs
			search: (prev) => {
				const needsRange =
					prev.range === undefined && stored.range !== undefined;
				const needsStatus = prev.status === undefined && stored.status.length > 0;
				const needsView = prev.view === undefined && stored.view !== undefined;
				const needsDay = prev.day === undefined && stored.day !== undefined;

				if (!needsRange && !needsStatus && !needsView && !needsDay) {
					return prev;
				}

				return {
					...prev,
					...(needsRange ? { range: stored.range } : {}),
					...(needsStatus
						? {
								status: [...stored.status]
									.sort((a, b) => a.localeCompare(b))
									.join(","),
							}
						: {}),
					...(needsView ? { view: stored.view } : {}),
					...(needsDay && stored.day ? { day: stored.day } : {}),
				} as typeof prev;
			},
			replace: true,
		});
		setPrefsHydrated(true);
	}, [navigate]);

	const customDay = useMemo(() => parseDay(search.day), [search.day]);

	const range = useMemo(() => {
		const fromUrl = parseRange(search.range);
		if (fromUrl !== undefined) return fromUrl;
		if (!prefsHydrated) return storedOnce?.range ?? "today";
		return "today";
	}, [search.range, prefsHydrated, storedOnce]);

	const rangeSegmentValue = useMemo((): ReservationDashboardRangeValue => {
		if (customDay) return "custom";
		return range;
	}, [customDay, range]);

	const viewMode = useMemo(() => {
		const fromUrl = parseView(search.view);
		if (fromUrl !== undefined) return fromUrl;
		if (!prefsHydrated) return storedOnce?.view ?? "cards";
		return "cards";
	}, [search.view, prefsHydrated, storedOnce]);

	const statusFilter = useMemo(() => {
		const fromUrl = parseStatusParam(search.status);
		if (search.status !== undefined) {
			return new Set(fromUrl ?? []);
		}
		if (!prefsHydrated) {
			return new Set(storedOnce?.status ?? []);
		}
		return new Set<ReservationStatus>();
	}, [search.status, prefsHydrated, storedOnce]);

	const persist = useCallback(
		(next: {
			range: ReservationRange;
			status: ReservationStatus[];
			view: ReservationsViewMode;
			day?: string;
		}) => {
			writeStoredPrefs({
				range: next.range,
				status: next.status,
				view: next.view,
				day: next.day,
			});
		},
		[]
	);

	const mergeNavigate = useCallback(
		(patch: Partial<ReservationsDashboardSearch>) => {
			navigate({
				// @ts-expect-error -- partial URL search patch with key deletion
				search: (prev) => {
					const base: Record<string, unknown> = { ...(prev as Record<string, unknown>) };
					for (const [key, val] of Object.entries(patch)) {
						if (val === undefined) {
							delete base[key];
						} else {
							base[key] = val;
						}
					}
					return base as typeof prev;
				},
				replace: true,
			});
		},
		[navigate]
	);

	const setRange = useCallback(
		(nextRange: ReservationRange) => {
			persist({
				range: nextRange,
				status: [...statusFilter],
				view: viewMode,
			});
			mergeNavigate({ range: nextRange, day: undefined });
		},
		[persist, mergeNavigate, statusFilter, viewMode]
	);

	const setCustomDay = useCallback(
		(ymd: string) => {
			if (!isValidYmd(ymd)) return;
			persist({
				range,
				status: [...statusFilter],
				view: viewMode,
				day: ymd,
			});
			mergeNavigate({ day: ymd, range: undefined });
		},
		[persist, mergeNavigate, range, statusFilter, viewMode]
	);

	const setViewMode = useCallback(
		(nextView: ReservationsViewMode) => {
			persist({
				range,
				status: [...statusFilter],
				view: nextView,
				day: customDay,
			});
			mergeNavigate({ view: nextView });
		},
		[persist, mergeNavigate, range, statusFilter, customDay]
	);

	const toggleStatus = useCallback(
		(value: ReservationStatus) => {
			const next = new Set(statusFilter);
			if (next.has(value)) next.delete(value);
			else next.add(value);

			const statusParam = statusesToParam(next);
			persist({
				range,
				status: [...next],
				view: viewMode,
				day: customDay,
			});
			mergeNavigate({ status: statusParam });
		},
		[persist, mergeNavigate, range, statusFilter, viewMode, customDay]
	);

	const setStatusFilter = useCallback(
		(next: Set<ReservationStatus>) => {
			persist({
				range,
				status: [...next],
				view: viewMode,
				day: customDay,
			});
			mergeNavigate({ status: statusesToParam(next) });
		},
		[persist, mergeNavigate, range, viewMode, customDay]
	);

	return {
		range,
		customDay,
		rangeSegmentValue,
		setRange,
		setCustomDay,
		viewMode,
		setViewMode,
		statusFilter,
		toggleStatus,
		setStatusFilter,
	};
}
