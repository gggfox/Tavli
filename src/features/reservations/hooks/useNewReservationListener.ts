/**
 * Subscribes to the "recently created pending reservations" query and pushes
 * a toast for any reservation that wasn't already shown.
 *
 * Mounted once in the staff layout. Convex's reactivity does the heavy
 * lifting -- when a customer creates a reservation, this query reruns and
 * the new row triggers a toast within the network round-trip.
 */
import { pushToast } from "@/global/components";
import { unwrapQuery } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useEffect, useRef } from "react";

export function useNewReservationListener(restaurantId: Id<"restaurants"> | undefined) {
	// Anchor "since" to the moment the listener mounts so existing pending
	// rows don't all toast on first load.
	const sinceMsRef = useRef<number>(Date.now());
	const seenIds = useRef<Set<string>>(new Set());

	const { data: rawResult } = useQuery({
		...convexQuery(
			api.reservations.listRecentPending,
			restaurantId
				? { restaurantId, sinceMs: sinceMsRef.current }
				: "skip"
		),
		enabled: Boolean(restaurantId),
	});

	const { data: pending } = unwrapQuery(rawResult);

	useEffect(() => {
		if (!pending) return;
		for (const r of pending) {
			if (seenIds.current.has(r._id)) continue;
			seenIds.current.add(r._id);
			pushToast({
				id: `reservation-${r._id}`,
				kind: "reservation",
				title: `New reservation: ${r.contact.name}`,
				body: `Party of ${r.partySize} at ${new Date(r.startsAt).toLocaleString(undefined, {
					weekday: "short",
					month: "short",
					day: "numeric",
					hour: "numeric",
					minute: "2-digit",
				})}`,
				actionHref: `/admin/reservations?focus=${r._id}`,
				actionLabel: "Review",
			});
		}
	}, [pending]);
}
