import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { OrderingKeys } from "@/global/i18n";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
	const { t } = useTranslation();
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

	// Menu is always browsable; ordering unlocks only when inside the geofence
	// (or staff bypass). Unconfigured geofence = online ordering off.
	const orderingBlocked = geofence.status !== "inside";

	const blockedNotice =
		geofence.status === "unconfigured" ? (
			<p className="text-sm text-center text-muted-foreground py-2">
				{t(OrderingKeys.MENU_ORDERING_UNAVAILABLE)}
			</p>
		) : geofence.status === "outside" || geofence.status === "unavailable" ? (
			<GeofenceNotice
				slug={slug}
				status={geofence.status}
				onRetry={geofence.retry}
				onBypass={geofence.bypass}
			/>
		) : undefined;

	return (
		<MenuBrowser
			restaurantId={restaurantId}
			{...(lang ? { lang } : {})}
			onSubmitOrder={handleSubmitOrder}
			isSubmitting={isSubmitting}
			orderingBlocked={orderingBlocked}
			blockedNotice={blockedNotice}
		/>
	);
}
