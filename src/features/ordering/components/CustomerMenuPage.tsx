import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { OrderingKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { useAuth } from "@clerk/tanstack-react-start";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCart } from "../hooks/useCart";
import { showsGeofenceNotice, useGeofence } from "../hooks/useGeofence";
import { useBranding } from "../hooks/useBranding";
import { useSessionStore } from "../hooks/useSession";
import type { SelectedOption } from "../types";
import { describeMenuSubmitError, type MenuSubmitError } from "../utils/submitError";
import { GeofenceNotice } from "./GeofenceNotice";
import { MenuBrowser } from "./MenuBrowser";
import { MenuHero } from "./MenuHero";
import { MenuBrowserSkeleton } from "./MenuBrowserSkeleton";
import { WhatsappAssistantLink } from "@/features/whatsapp";
import { RestaurantContactBar } from "./RestaurantContactBar";
import { SignInToOrder } from "./SignInToOrder";

interface CustomerMenuPageProps {
	slug: string;
	lang?: string;
	/**
	 * ADR 008 pay-at-submit: the built draft heads to the per-order checkout,
	 * where the diner pays (or commits to cash) before the kitchen sees it.
	 */
	onProceedToCheckout: (orderId: string) => void;
}

export function CustomerMenuPage({
	slug,
	lang,
	onProceedToCheckout,
}: Readonly<CustomerMenuPageProps>) {
	const { t } = useTranslation();
	const { sessionId, restaurantId } = useSessionStore();
	const { isLoaded: authLoaded, isSignedIn } = useAuth();
	/**
	 * Browse mode: a signed-out diner reads the real menu with no Session at
	 * all — none is faked, and nothing below that needs one is reachable. The
	 * gate moves from the whole page to the order bar, which becomes a sign-in
	 * call to action. Signed in, the layout only renders this page once the
	 * Session exists, so the skeleton below is just the brief handover.
	 */
	const browsing = authLoaded && !isSignedIn;
	const { saveDraftFromMenu } = useCart();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<MenuSubmitError | null>(null);
	// The draft is the source of truth for what this visit has picked so far:
	// submitting replaces its lines, so the menu must open holding them.
	const { data: sessionOrders } = useQuery(
		convexQuery(api.orders.getOrdersBySession, sessionId ? { sessionId } : "skip")
	);

	const { data: restaurant } = useQuery(convexQuery(api.restaurants.getBySlug, { slug }));
	// From the route loader, so the hero's dimensions are known before the
	// first paint rather than after the query settles.
	const branding = useBranding();
	// undefined = still loading (keeps status "checking"); a missing restaurant
	// behaves as unconfigured — the session layer already handles that error.
	const geofence = useGeofence(slug, restaurant === null ? {} : restaurant);

	// Browsing reads the restaurant from the slug; ordering keeps the one the
	// Session is bound to, exactly as before. Ordering also waits for the
	// session's orders: `MenuBrowser` reads its draft seed once, on mount.
	const menuRestaurantId = browsing ? restaurant?._id : restaurantId;
	if (!menuRestaurantId || (!browsing && (!sessionId || sessionOrders === undefined))) {
		return <MenuBrowserSkeleton />;
	}

	const draft = sessionOrders?.find((order) => order.status === "draft");
	const initialDraft = draft
		? {
				lines: draft.items,
				tableId: draft.tableId,
				...(draft.specialInstructions !== undefined && {
					specialInstructions: draft.specialInstructions,
				}),
			}
		: undefined;

	const handleSubmitOrder = async (data: {
		items: Array<{
			menuItemId: Id<"menuItems">;
			quantity: number;
			selectedOptions: SelectedOption[];
		}>;
		specialInstructions?: string;
		tableId: Id<"tables">;
	}) => {
		// Unreachable while browsing (the order bar is the sign-in CTA), but the
		// type no longer proves it.
		if (!sessionId) return;
		setIsSubmitting(true);
		setSubmitError(null);
		try {
			// One atomic call: the draft's lines become exactly these picks, with
			// the table and the notes — which must live on the draft row before
			// checkout, since pay-at-submit has no diner-side submit call to carry
			// them (ADR 008). A refusal changes nothing, so a retry is safe.
			const orderId = unwrapResult<Id<"orders">>(
				await saveDraftFromMenu({
					sessionId,
					tableId: data.tableId,
					items: data.items,
					...(data.specialInstructions !== undefined && {
						specialInstructions: data.specialInstructions,
					}),
					...(lang ? { lang } : {}),
				})
			);
			onProceedToCheckout(orderId);
		} catch (error) {
			setSubmitError(describeMenuSubmitError(error, data.items, t));
		} finally {
			setIsSubmitting(false);
		}
	};

	// Menu is always browsable; ordering unlocks only when inside the geofence
	// (or staff bypass). Unconfigured geofence = online ordering off.
	// Signed out, the order bar asks for sign-in first — unless this restaurant
	// takes no online orders at all, where an account would unlock nothing and
	// the honest answer is the same "unavailable" everyone gets.
	const orderingBlocked = browsing || geofence.status !== "inside";

	const blockedNotice =
		geofence.status === "unconfigured" ? (
			<p className="text-sm text-center text-muted-foreground py-2">
				{t(OrderingKeys.MENU_ORDERING_UNAVAILABLE)}
			</p>
		) : browsing ? (
			<SignInToOrder />
		) : showsGeofenceNotice(geofence.status) ? (
			<GeofenceNotice
				slug={slug}
				status={geofence.status}
				onRetry={geofence.retry}
				onBypass={geofence.bypass}
			/>
		) : undefined;

	return (
		<MenuBrowser
			restaurantId={menuRestaurantId}
			{...(lang ? { lang } : {})}
			onSubmitOrder={handleSubmitOrder}
			isSubmitting={isSubmitting}
			{...(initialDraft ? { initialDraft } : {})}
			submitError={submitError}
			onDismissSubmitError={() => setSubmitError(null)}
			orderingBlocked={orderingBlocked}
			blockedNotice={blockedNotice}
			// Reuses the restaurant already fetched above for the geofence — the
			// public profile rides along on the same query. The assistant line sits
			// above it and renders nothing at all when the restaurant is not enabled,
			// so the two are independent of each other.
			hero={<MenuHero branding={branding} restaurantName={restaurant?.name ?? ""} />}
			contactBar={
				restaurant ? (
					<>
						<WhatsappAssistantLink slug={slug} />
						<RestaurantContactBar restaurant={restaurant} />
					</>
				) : null
			}
		/>
	);
}
