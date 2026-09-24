import { NotificationBell } from "@/features/notifications";
import { useRestaurant } from "@/features/restaurants";
import { SidebarKeys } from "@/global/i18n/keys/sidebar";
import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSidebarStore } from "./hooks";

/**
 * Phone-only chrome (< md). The sidebar is off screen there, so this bar is
 * what's left of the staff header: open the menu, see which restaurant you
 * are acting on, and keep the notification bell one tap away.
 */
export function MobileTopBar() {
	const { t } = useTranslation();
	const { restaurant } = useRestaurant();
	const setOverlayOpen = useSidebarStore((state) => state.setOverlayOpen);

	return (
		<header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-muted px-2 pt-[env(safe-area-inset-top)] md:hidden">
			<button
				type="button"
				onClick={() => setOverlayOpen(true)}
				aria-label={t(SidebarKeys.OPEN_MENU)}
				className="rounded-md p-2 text-foreground hover-icon"
			>
				<Menu size={20} />
			</button>
			<span className="text-sm font-semibold tracking-tight text-foreground">
				{t(SidebarKeys.BRAND_NAME)}
			</span>
			{restaurant ? (
				<>
					<span className="text-faint-foreground" aria-hidden>
						/
					</span>
					<span className="min-w-0 truncate text-sm text-muted-foreground">{restaurant.name}</span>
				</>
			) : null}
			<div className="ml-auto">
				<NotificationBell />
			</div>
		</header>
	);
}
