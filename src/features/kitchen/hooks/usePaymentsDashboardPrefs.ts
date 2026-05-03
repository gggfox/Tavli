/**
 * URL-backed payments dashboard prefs with per-restaurant localStorage.
 * Hydrates missing URL keys from storage; clears URL `q` when the active restaurant changes.
 */
import {
	clampPaymentsSearchQuery,
	type PaymentsDashboardSearch,
	type PaymentsTimePeriod,
	parsePaymentsPeriod,
} from "@/features/kitchen/paymentsDashboardSearch";
import type { Id } from "convex/_generated/dataModel";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "tavli.payments.dashboard.preferences";
const STORAGE_VERSION = 1 as const;

type RestaurantPrefs = {
	readonly period: PaymentsTimePeriod;
	readonly q: string;
};

type StoredRoot = {
	readonly version: typeof STORAGE_VERSION;
	readonly restaurants: Record<string, RestaurantPrefs>;
};

function isRestaurantPrefs(v: unknown): v is RestaurantPrefs {
	if (!v || typeof v !== "object") return false;
	const o = v as Record<string, unknown>;
	return parsePaymentsPeriod(o.period) !== undefined && typeof o.q === "string";
}

function readStored(): StoredRoot | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<StoredRoot>;
		if (parsed.version !== STORAGE_VERSION) return null;
		if (!parsed.restaurants || typeof parsed.restaurants !== "object") return null;
		const restaurants: Record<string, RestaurantPrefs> = {};
		for (const [id, val] of Object.entries(parsed.restaurants)) {
			if (isRestaurantPrefs(val)) restaurants[id] = val;
		}
		return { version: STORAGE_VERSION, restaurants };
	} catch {
		return null;
	}
}

function writeStoredForRestaurant(
	restaurantId: Id<"restaurants">,
	next: { period: PaymentsTimePeriod; q: string }
): void {
	if (typeof window === "undefined") return;
	try {
		const prev = readStored();
		const restaurants = { ...(prev?.restaurants ?? {}) };
		restaurants[restaurantId] = {
			period: next.period,
			q: next.q,
		};
		const payload: StoredRoot = {
			version: STORAGE_VERSION,
			restaurants,
		};
		localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	} catch {
		// ignore quota / private mode
	}
}

export function usePaymentsDashboardPrefs(restaurantId: Id<"restaurants">) {
	const navigate = useNavigate({ from: "/admin/payments" });
	const search = useSearch({ from: "/admin/payments" });

	const prevRestaurantIdRef = useRef(restaurantId);
	const [prefsHydrated, setPrefsHydrated] = useState(false);

	const storedSnapshotForRestaurant = useMemo(() => {
		return readStored()?.restaurants[restaurantId] ?? null;
	}, [restaurantId]);

	useEffect(() => {
		const switched = prevRestaurantIdRef.current !== restaurantId;
		const stored = readStored();
		const entry = stored?.restaurants[restaurantId];

		navigate({
			search: (prev) => {
				const base: Record<string, unknown> = { ...(prev as Record<string, unknown>) };
				let changed = switched;
				if (switched) {
					delete base.q;
				}
				if (base.period === undefined && entry?.period) {
					base.period = entry.period;
					changed = true;
				}
				if (base.q === undefined && entry?.q) {
					base.q = entry.q;
					changed = true;
				}
				if (!changed) return prev as typeof prev;
				return base as typeof prev;
			},
			replace: true,
		});

		prevRestaurantIdRef.current = restaurantId;
		setPrefsHydrated(true);
	}, [navigate, restaurantId]);

	const period = useMemo((): PaymentsTimePeriod => {
		const fromUrl = search.period;
		if (fromUrl !== undefined) return fromUrl;
		if (!prefsHydrated) return storedSnapshotForRestaurant?.period ?? "today";
		return "today";
	}, [search.period, prefsHydrated, storedSnapshotForRestaurant]);

	const q = useMemo(() => {
		if (search.q !== undefined) return search.q;
		if (!prefsHydrated) return storedSnapshotForRestaurant?.q ?? "";
		return "";
	}, [search.q, prefsHydrated, storedSnapshotForRestaurant]);

	const mergeNavigate = useCallback(
		(patch: Partial<PaymentsDashboardSearch>) => {
			navigate({
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

	const setPeriod = useCallback(
		(nextPeriod: PaymentsTimePeriod) => {
			writeStoredForRestaurant(restaurantId, { period: nextPeriod, q });
			mergeNavigate({ period: nextPeriod });
		},
		[mergeNavigate, restaurantId, q]
	);

	const setSearch = useCallback(
		(raw: string) => {
			const forUrl = clampPaymentsSearchQuery(raw);
			const forStore = forUrl ?? "";
			writeStoredForRestaurant(restaurantId, { period, q: forStore });
			mergeNavigate({ q: forUrl });
		},
		[mergeNavigate, restaurantId, period]
	);

	return {
		period,
		setPeriod,
		q,
		setSearch,
	};
}
