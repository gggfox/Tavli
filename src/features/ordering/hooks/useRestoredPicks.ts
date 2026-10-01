import { convexQuery } from "@convex-dev/react-query";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useEffect, useState } from "react";
import type { DraftLine } from "../utils/menuPicks";
import {
	type RestorableOptionGroup,
	type RestoredLines,
	validateRestoredLines,
} from "../utils/restorePicks";
import { clearStoredPicks, loadStoredPicks } from "../utils/storedPicks";

export type RestoredPicks =
	| { status: "pending" }
	| {
			status: "settled";
			/** Picks to seed the menu with; `undefined` when there are none to restore. */
			lines: DraftLine[] | undefined;
			/** Some stored picks could not be restored — tell the diner. */
			droppedSome: boolean;
	  };

const PENDING: RestoredPicks = { status: "pending" };
const NOTHING: RestoredPicks = { status: "settled", lines: undefined, droppedSome: false };

/**
 * The picks a diner made signed out, ready to seed the menu (`storedPicks`).
 *
 * Read once per menu mount, on the client after hydration — the server render
 * has no storage — and read again when the diner switches between browsing
 * and ordering, since the menu remounts across that switch. Until the read and
 * the menu check behind it are done the result is `pending` and the caller
 * holds its skeleton: `MenuBrowser` reads its seed once, on mount, so seeding
 * late would be seeding never. Once settled the result is frozen for that
 * read, so a dish going off the menu afterwards does not rewrite history.
 *
 * Precedence: a session that already has a draft keeps the draft. The draft
 * is the source of truth for this visit — submitting replaces its lines — and
 * stored picks predate it, so they are discarded rather than merged. Picks are
 * only restored into the menu; nothing touches the draft until the diner
 * reviews and submits as usual.
 *
 * Signed in, stored picks are cleared once consumed (seeded or overruled).
 * While browsing they are left alone: the menu writes its checked picks
 * straight back, and clearing from here would race that write — a child's
 * effects run before its parent's.
 */
export function useRestoredPicks({
	slug,
	restaurantId,
	browsing,
	ready,
	hasDraft,
	lang,
}: Readonly<{
	slug: string;
	restaurantId: Id<"restaurants"> | null | undefined;
	browsing: boolean;
	/** Everything else the menu waits for has arrived (signed in: the session's orders). */
	ready: boolean;
	hasDraft: boolean;
	lang?: string;
}>): RestoredPicks {
	const mode = browsing ? "browse" : "order";
	const [read, setRead] = useState<{ mode: string; lines: DraftLine[] | null } | undefined>();
	useEffect(() => {
		if (ready) setRead({ mode, lines: loadStoredPicks(slug) });
	}, [ready, mode, slug]);
	// A read made in the other mode belongs to a menu that has since unmounted.
	const current = ready && read?.mode === mode ? read : undefined;
	const candidate = current && !hasDraft ? current.lines : null;

	const { data: menuItems, isError: menuItemsFailed } = useQuery(
		convexQuery(
			api.menuItems.getByRestaurant,
			candidate && restaurantId ? { restaurantId } : "skip"
		)
	);
	const itemsById = new Map((menuItems ?? []).map((item) => [item._id as string, item]));
	// Options are checked only for dishes still on the menu, so a stored id
	// that is not a real dish id never reaches the query's argument validator.
	const dishesWithOptions = [
		...new Set(
			(candidate ?? [])
				.filter((line) => line.selectedOptions.length > 0 && itemsById.has(line.menuItemId))
				.map((line) => line.menuItemId)
		),
	];
	const optionGroupResults = useQueries({
		queries: dishesWithOptions.map((menuItemId) =>
			convexQuery(api.optionGroups.getGroupsForMenuItem, { menuItemId })
		),
	});

	const [frozen, setFrozen] = useState<{ read: typeof read; result: RestoredPicks }>();
	let result: RestoredPicks = PENDING;
	if (current && frozen?.read === current) {
		result = frozen.result;
	} else if (current) {
		const menuMissing = !restaurantId || menuItemsFailed;
		const optionsPending = optionGroupResults.some((r) => r.data === undefined && !r.isError);
		if (!candidate) {
			result = NOTHING;
		} else if (menuMissing) {
			// Nothing to check the picks against: restore none rather than hold
			// the menu hostage. Every pick is reported as dropped.
			result = { status: "settled", lines: undefined, droppedSome: true };
		} else if (menuItems && !optionsPending) {
			const optionGroupsByItem = new Map<string, readonly RestorableOptionGroup[]>();
			dishesWithOptions.forEach((menuItemId, i) => {
				const groups = optionGroupResults[i]?.data;
				if (groups) {
					optionGroupsByItem.set(
						menuItemId,
						groups.filter((g): g is NonNullable<typeof g> => g != null)
					);
				}
			});
			result = settledResult(
				validateRestoredLines(candidate, {
					items: itemsById,
					optionGroupsByItem,
					dayOfWeek: new Date().getDay(),
					...(lang ? { lang } : {}),
				})
			);
		}
		// Adjusting state while rendering, React's pattern for "remember what an
		// earlier render saw": the next render returns the frozen result.
		if (result.status === "settled") setFrozen({ read: current, result });
	}

	const consumed = current !== undefined && current.lines !== null && !browsing;
	const isSettled = result.status === "settled";
	useEffect(() => {
		if (consumed && isSettled) clearStoredPicks(slug);
	}, [consumed, isSettled, slug]);

	return result;
}

function settledResult({ lines, droppedSome }: RestoredLines): RestoredPicks {
	return { status: "settled", lines: lines.length > 0 ? lines : undefined, droppedSome };
}
