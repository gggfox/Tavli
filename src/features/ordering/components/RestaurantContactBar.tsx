import { SOCIAL_ICON } from "@/global/components/icons/SocialIcons";
import { CustomerKeys } from "@/global/i18n";
import {
	SOCIAL_PLATFORM,
	SOCIAL_PLATFORMS,
	toTelHref,
	type SocialPlatform,
} from "convex/publicProfileHelpers";
import type { PublicRestaurant } from "convex/restaurants";
import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * The Restaurant's **Public profile** as a persistent bar pinned below the
 * order bar, rather than a block at the end of the menu.
 *
 * At the end of a long scroll the social links were effectively unreachable —
 * a diner had to scroll past every category to find them. Here they are always
 * on screen, at the cost of a fixed slice of viewport, so the bar is capped at
 * **two rows**: one of social icons, one of contact details. The details row
 * scrolls horizontally instead of wrapping, which is what keeps that cap real
 * on a narrow phone.
 *
 * The restaurant's name is deliberately absent — it lives in the sticky header
 * above, and repeating it here would spend one of the two rows on it.
 *
 * Renders `null` when the restaurant has published nothing, so an unconfigured
 * restaurant loses no vertical space at all.
 */

const SOCIAL_NAME_KEY: Record<SocialPlatform, string> = {
	[SOCIAL_PLATFORM.INSTAGRAM]: CustomerKeys.SOCIAL_INSTAGRAM,
	[SOCIAL_PLATFORM.FACEBOOK]: CustomerKeys.SOCIAL_FACEBOOK,
	[SOCIAL_PLATFORM.TIKTOK]: CustomerKeys.SOCIAL_TIKTOK,
	[SOCIAL_PLATFORM.X]: CustomerKeys.SOCIAL_X,
	[SOCIAL_PLATFORM.YOUTUBE]: CustomerKeys.SOCIAL_YOUTUBE,
};

const ITEM_CLASS = "flex items-center gap-1.5 shrink-0 text-foreground";
const ICON_CLASS = "shrink-0 text-muted-foreground";

interface RestaurantContactBarProps {
	readonly restaurant: PublicRestaurant;
}

export function RestaurantContactBar({ restaurant }: Readonly<RestaurantContactBarProps>) {
	const { t } = useTranslation();
	const contact = restaurant.contact;

	if (!contact) return null;

	const socials = contact.socials;
	const presentSocials = SOCIAL_PLATFORMS.filter((p) => socials?.[p]);
	const hours =
		restaurant.openTime && restaurant.closeTime
			? { open: restaurant.openTime, close: restaurant.closeTime }
			: null;
	const hasDetails = Boolean(hours || contact.address || contact.email || contact.phone);

	if (presentSocials.length === 0 && !hasDetails) return null;

	/**
	 * Coordinates already exist for the geofence and are public information, so
	 * a pin is more reliable than geocoding the typed address at render time.
	 */
	const directionsUrl =
		restaurant.latitude != null && restaurant.longitude != null
			? `https://www.google.com/maps/search/?api=1&query=${restaurant.latitude},${restaurant.longitude}`
			: null;

	return (
		<section
			aria-label={t(CustomerKeys.INFO_HEADING)}
			// Last element in the column, so it owns the home-indicator inset.
			className="shrink-0 border-t border-border bg-muted px-4 pt-2 space-y-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
		>
			{presentSocials.length > 0 ? (
				<div className="flex items-center gap-1">
					{presentSocials.map((platform) => {
						const Icon = SOCIAL_ICON[platform];
						return (
							<a
								key={platform}
								href={socials?.[platform]}
								target="_blank"
								rel="noopener noreferrer nofollow"
								aria-label={t(CustomerKeys.INFO_SOCIAL_ARIA, {
									platform: t(SOCIAL_NAME_KEY[platform]),
								})}
								className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-hover hover:text-foreground"
							>
								<Icon size={18} />
							</a>
						);
					})}
				</div>
			) : null}

			{hasDetails ? (
				// Scrolls rather than wraps: wrapping is what would push this past
				// the two-row cap on a narrow screen.
				<div className="flex items-center gap-x-4 overflow-x-auto whitespace-nowrap text-xs">
					{hours ? (
						<span className={ITEM_CLASS}>
							<Clock size={14} className={ICON_CLASS} aria-hidden />
							<span className="sr-only">{t(CustomerKeys.INFO_HOURS_LABEL)}</span>
							{t(CustomerKeys.INFO_HOURS_VALUE, hours)}
						</span>
					) : null}

					{contact.address ? (
						<span className={ITEM_CLASS}>
							<MapPin size={14} className={ICON_CLASS} aria-hidden />
							<span className="sr-only">{t(CustomerKeys.INFO_ADDRESS_LABEL)}</span>
							{contact.address}
							{directionsUrl ? (
								<>
									{" · "}
									<a
										href={directionsUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="underline"
									>
										{t(CustomerKeys.INFO_DIRECTIONS)}
									</a>
								</>
							) : null}
						</span>
					) : null}

					{contact.email ? (
						<a href={`mailto:${contact.email}`} className={ITEM_CLASS}>
							<Mail size={14} className={ICON_CLASS} aria-hidden />
							<span className="sr-only">{t(CustomerKeys.INFO_EMAIL_LABEL)}</span>
							{contact.email}
						</a>
					) : null}

					{contact.phone ? (
						<a href={toTelHref(contact.phone)} className={ITEM_CLASS}>
							<Phone size={14} className={ICON_CLASS} aria-hidden />
							<span className="sr-only">{t(CustomerKeys.INFO_PHONE_LABEL)}</span>
							{contact.phone}
						</a>
					) : null}

					{contact.whatsAppUrl ? (
						<a
							href={contact.whatsAppUrl}
							target="_blank"
							rel="noopener noreferrer"
							className={ITEM_CLASS}
						>
							<MessageCircle size={14} className={ICON_CLASS} aria-hidden />
							{t(CustomerKeys.INFO_WHATSAPP_LABEL)}
						</a>
					) : null}
				</div>
			) : null}
		</section>
	);
}
