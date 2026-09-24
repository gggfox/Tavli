import { SidebarKeys } from "@/global/i18n/keys/sidebar";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useToggleSidebar } from "./hooks";

/**
 * One sidebar, three placements (see `useSidebarViewport`):
 *
 * - phone: `fixed` off-canvas drawer, slid in by `overlayOpen`. The slot
 *   around it has no in-flow width, so the page gets the full screen.
 * - tablet: the slot reserves a 4rem rail; the aside is `absolute` inside
 *   it, so expanding widens the aside *over* the page instead of pushing
 *   the page into a sliver.
 * - desktop: the aside is back in the flow, collapsed or expanded by the
 *   saved preference, exactly as before.
 *
 * Positioning is CSS-only so SSR paints the right shape before hydration;
 * JS only decides what the content renders (rail vs. full).
 */
export function SidebarContainer({ children }: Readonly<{ children: React.ReactNode }>) {
	const { t } = useTranslation();
	const { isExpanded, overlayOpen, closeOverlay } = useToggleSidebar();

	useEffect(() => {
		if (!overlayOpen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") closeOverlay();
		};
		globalThis.addEventListener("keydown", onKey);
		return () => globalThis.removeEventListener("keydown", onKey);
	}, [overlayOpen, closeOverlay]);

	return (
		<div className="relative shrink-0 md:w-16 lg:w-auto">
			{overlayOpen ? (
				<button
					type="button"
					aria-label={t(SidebarKeys.CLOSE_MENU)}
					onClick={closeOverlay}
					className="fixed inset-0 z-40 bg-black/50 lg:hidden"
				/>
			) : null}
			<aside
				data-overlay-open={overlayOpen ? "true" : undefined}
				className={`tavli-sidebar-width fixed inset-y-0 left-0 z-50 flex h-full min-h-0 w-[85%] max-w-xs flex-col overflow-hidden border-r border-border bg-muted text-muted-foreground transition-[transform,width] duration-300 ease-in-out md:absolute md:max-w-none lg:relative lg:z-auto ${
					overlayOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full md:translate-x-0"
				} ${isExpanded ? "md:w-60" : "md:w-16"}`}
			>
				{children}
			</aside>
		</div>
	);
}
