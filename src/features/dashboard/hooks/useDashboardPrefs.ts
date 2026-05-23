/**
 * URL + localStorage prefs for the dashboard route.
 *
 * The URL is the source of truth for "what is the active layout right now"
 * (so deep links work). localStorage hydrates defaults so navigating away
 * and back preserves the user's last view.
 */
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardScopeKind } from "../types";

const STORAGE_KEY = "tavli.dashboard.preferences";
const STORAGE_VERSION = 1 as const;

type StoredPrefs = {
	readonly version: typeof STORAGE_VERSION;
	readonly scope?: DashboardScopeKind;
	readonly layoutId?: string;
};

export type DashboardSearchParams = {
	readonly scope?: DashboardScopeKind;
	readonly layoutId?: string;
	readonly edit?: "1";
};

function parseScope(raw: unknown): DashboardScopeKind | undefined {
	if (raw === "restaurant" || raw === "portfolio") return raw;
	return undefined;
}

function readStoredPrefs(): StoredPrefs | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
		if (parsed.version !== STORAGE_VERSION) return null;
		return {
			version: STORAGE_VERSION,
			scope: parseScope(parsed.scope),
			layoutId: typeof parsed.layoutId === "string" ? parsed.layoutId : undefined,
		};
	} catch {
		return null;
	}
}

function writeStoredPrefs(prefs: Omit<StoredPrefs, "version">): void {
	if (typeof window === "undefined") return;
	try {
		const payload: StoredPrefs = { version: STORAGE_VERSION, ...prefs };
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	} catch {
		/* ignore quota / private mode */
	}
}

export function useDashboardPrefs() {
	const navigate = useNavigate();
	const search = useSearch({ strict: false }) as DashboardSearchParams;

	const storedOnce = useMemo(() => readStoredPrefs(), []);
	const [hydrated, setHydrated] = useState(false);

	useEffect(() => {
		const stored = readStoredPrefs();
		if (!stored) {
			setHydrated(true);
			return;
		}
		navigate({
			// @ts-expect-error -- partial search merge preserves other keys
			search: (prev: DashboardSearchParams) => {
				const needsScope = prev.scope === undefined && stored.scope !== undefined;
				const needsLayoutId = prev.layoutId === undefined && stored.layoutId !== undefined;
				if (!needsScope && !needsLayoutId) return prev;
				return {
					...prev,
					...(needsScope ? { scope: stored.scope } : {}),
					...(needsLayoutId ? { layoutId: stored.layoutId } : {}),
				};
			},
			replace: true,
		});
		setHydrated(true);
	}, [navigate]);

	const scope = useMemo<DashboardScopeKind>(() => {
		const fromUrl = parseScope(search.scope);
		if (fromUrl) return fromUrl;
		if (!hydrated && storedOnce?.scope) return storedOnce.scope;
		return "restaurant";
	}, [search.scope, hydrated, storedOnce]);

	const activeLayoutId = useMemo(() => {
		if (typeof search.layoutId === "string") return search.layoutId;
		if (!hydrated) return storedOnce?.layoutId;
		return undefined;
	}, [search.layoutId, hydrated, storedOnce]);

	const editMode = search.edit === "1";

	const mergeNavigate = useCallback(
		(patch: Partial<DashboardSearchParams>) => {
			navigate({
				// @ts-expect-error -- partial URL search patch
				search: (prev) => {
					const base: Record<string, unknown> = { ...(prev as Record<string, unknown>) };
					for (const [key, val] of Object.entries(patch)) {
						if (val === undefined) delete base[key];
						else base[key] = val;
					}
					return base as typeof prev;
				},
				replace: true,
			});
		},
		[navigate]
	);

	const setScope = useCallback(
		(next: DashboardScopeKind) => {
			writeStoredPrefs({ scope: next, layoutId: undefined });
			mergeNavigate({ scope: next, layoutId: undefined });
		},
		[mergeNavigate]
	);

	const setActiveLayoutId = useCallback(
		(layoutId: string | undefined) => {
			writeStoredPrefs({ scope, layoutId });
			mergeNavigate({ layoutId });
		},
		[mergeNavigate, scope]
	);

	const setEditMode = useCallback(
		(editing: boolean) => {
			mergeNavigate({ edit: editing ? "1" : undefined });
		},
		[mergeNavigate]
	);

	return {
		scope,
		activeLayoutId,
		editMode,
		setScope,
		setActiveLayoutId,
		setEditMode,
	};
}
