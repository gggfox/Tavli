import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useState } from "react";
import { useCart } from "../hooks/useCart";
import { useGeofence } from "../hooks/useGeofence";
import { useSessionStore } from "../hooks/useSession";
import type { SelectedOption } from "../types";
import { GeofenceNotice } from "./GeofenceNotice";
import { MenuBrowser } from "./MenuBrowser";
import { MenuBrowserSkeleton } from "./MenuBrowserSkeleton";

interface CustomerMenuPageProps {
	slug: string;
	lang?: string;
	/**
	 * TAVLI-6: orders go straight to the kitchen; payment happens at the end
	 * of the visit from the tab view. Navigates to the session's tab.
	 */
	onOrderSubmitted: (orderId: string) => void;
}

export function CustomerMenuPage({
	slug,
	lang,
	onOrderSubmitted,
}: Readonly<CustomerMenuPageProps>) {
	const { sessionId, restaurantId } = useSessionStore();
	const { createDraft, addItem, submitOrder } = useCart();
	const [isSubmitting, setIsSubmitting] = useState(false);

	const { data: restaurant } = useQuery(convexQuery(api.restaurants.getBySlug, { slug }));
	// undefined = still loading (keeps status "checking"); a missing restaurant
	// behaves as unconfigured — the session layer already handles that error.
	const geofence = useGeofence(slug, restaurant === null ? {} : restaurant);

	if (!restaurantId || !sessionId) {
		return <MenuBrowserSkeleton />;
	}

	const handleSubmitOrder = async (data: {
		items: Array<{
			menuItemId: Id<"menuItems">;
			quantity: number;
			selectedOptions: SelectedOption[];
		}>;
		specialInstructions?: string;
		tableId: Id<"tables">;
	}) => {
		setIsSubmitting(true);
		try {
			const orderId = (await createDraft({ sessionId, tableId: data.tableId })) as Id<"orders">;
			for (const item of data.items) {
				await addItem({ orderId, ...item, ...(lang ? { lang } : {}) });
			}
			await submitOrder({
				orderId,
				specialInstructions: data.specialInstructions,
			});
			onOrderSubmitted(orderId);
		} finally {
			setIsSubmitting(false);
		}
	};

	// The menu is always browsable; ordering is gated while the device is
	// outside the geofence (or location is denied). "checking" hides the
	// order controls without the warning banner to avoid a flash.
	const orderingBlocked = geofence.status === "outside" || geofence.status === "unavailable";

	return (
		<MenuBrowser
			restaurantId={restaurantId}
			{...(lang ? { lang } : {})}
			onSubmitOrder={handleSubmitOrder}
			isSubmitting={isSubmitting}
			orderingBlocked={orderingBlocked}
			blockedNotice={
				orderingBlocked ? (
					<GeofenceNotice
						slug={slug}
						status={geofence.status}
						onRetry={geofence.retry}
						onBypass={geofence.bypass}
					/>
				) : undefined
			}
		/>
	);
}
