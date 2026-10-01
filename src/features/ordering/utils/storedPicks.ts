/**
 * The dishes a signed-out diner picked, kept in the browser across sign-in.
 *
 * Browsing signed out, the picks live only in `MenuBrowser`'s state, and the
 * "Sign in to order" button is a Clerk redirect: the page reloads on the way
 * back and the picks were gone, so the diner had to choose everything again.
 * They are written here on every change while browsing and read back once
 * when the menu next mounts (see `useRestoredPicks`).
 *
 * `sessionStorage`, not `localStorage`: it survives the same-tab redirect,
 * which is the whole window this has to cover, and does not leak a stale
 * selection into a visit days later. Keyed by restaurant slug only — not by
 * language — so switching language on the way back keeps the picks. Storage
 * can be missing or throw (private windows, blocked site data); every access
 * is guarded and the fallback is the old behaviour, an empty menu.
 *
 * Only the picks are kept. The table and the order notes live in the review
 * panel, which a signed-out diner cannot open (the order bar is the sign-in
 * button), so there is nothing of theirs to keep.
 */
import type { Id } from "convex/_generated/dataModel";
import type { SelectedOption } from "../types";
import { type DraftLine, draftLinesFromPicks, type MenuPick } from "./menuPicks";

/**
 * How long stored picks stay restorable. Long enough to cover a slow sign-up
 * (email code, password manager, a phone call in between), short enough that
 * a tab left open from lunch does not put lunch back on the dinner menu.
 */
export const STORED_PICKS_TTL_MS = 2 * 60 * 60 * 1000;

/** Bumped if the stored shape changes; an entry of another version is ignored. */
const STORED_PICKS_VERSION = 1;

interface StoredPicks {
	version: typeof STORED_PICKS_VERSION;
	/** Epoch ms of the last change; drives `STORED_PICKS_TTL_MS`. */
	savedAt: number;
	lines: DraftLine[];
}

export const storedPicksKey = (slug: string) => `tavli:menu-picks:${slug}`;

/**
 * Remembers the picks for this restaurant, replacing whatever was stored. No
 * picks means nothing to keep, so the entry is removed — a diner who empties
 * their selection does not get it back after signing in.
 */
export function saveStoredPicks(
	slug: string,
	picks: ReadonlyMap<string, MenuPick>,
	now: number = Date.now()
): void {
	if (picks.size === 0) {
		clearStoredPicks(slug);
		return;
	}
	const value: StoredPicks = {
		version: STORED_PICKS_VERSION,
		savedAt: now,
		lines: draftLinesFromPicks(picks),
	};
	try {
		globalThis.sessionStorage?.setItem(storedPicksKey(slug), JSON.stringify(value));
	} catch {
		// Storage unavailable or full: the picks still hold for this page.
	}
}

export function clearStoredPicks(slug: string): void {
	try {
		globalThis.sessionStorage?.removeItem(storedPicksKey(slug));
	} catch {
		// Nothing stored, nothing to clear.
	}
}

/**
 * The stored picks for this restaurant as draft lines, or `null` when there
 * are none, they have expired, or the entry is not something this code wrote.
 * An expired or unreadable entry is removed on the way.
 *
 * Shape is checked, not trusted: storage is writable by anything on the
 * origin. Whether the dishes and options still exist is a separate question,
 * answered against the live menu by `validateRestoredLines`.
 */
export function loadStoredPicks(slug: string, now: number = Date.now()): DraftLine[] | null {
	let raw: string | null;
	try {
		raw = globalThis.sessionStorage?.getItem(storedPicksKey(slug)) ?? null;
	} catch {
		return null;
	}
	if (!raw) return null;
	const stored = parse(raw);
	if (!stored || now - stored.savedAt > STORED_PICKS_TTL_MS || stored.savedAt > now) {
		clearStoredPicks(slug);
		return null;
	}
	return stored.lines.length > 0 ? stored.lines : null;
}

function parse(raw: string): StoredPicks | null {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isRecord(value) || value.version !== STORED_PICKS_VERSION) return null;
	if (typeof value.savedAt !== "number" || !Array.isArray(value.lines)) return null;
	const lines: DraftLine[] = [];
	for (const line of value.lines) {
		const parsed = parseLine(line);
		if (!parsed) return null;
		lines.push(parsed);
	}
	return { version: STORED_PICKS_VERSION, savedAt: value.savedAt, lines };
}

function parseLine(value: unknown): DraftLine | null {
	if (!isRecord(value)) return null;
	const { menuItemId, quantity, unitPrice, selectedOptions } = value;
	if (typeof menuItemId !== "string" || typeof quantity !== "number") return null;
	if (typeof unitPrice !== "number" || !Array.isArray(selectedOptions)) return null;
	if (!selectedOptions.every(isSelectedOption)) return null;
	return {
		menuItemId: menuItemId as Id<"menuItems">,
		quantity,
		unitPrice,
		selectedOptions: selectedOptions as SelectedOption[],
	};
}

function isSelectedOption(value: unknown): value is SelectedOption {
	return (
		isRecord(value) &&
		typeof value.optionGroupId === "string" &&
		typeof value.optionGroupName === "string" &&
		typeof value.optionId === "string" &&
		typeof value.optionName === "string" &&
		typeof value.priceModifier === "number"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
