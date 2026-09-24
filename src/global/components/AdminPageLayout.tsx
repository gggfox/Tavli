import { useEffect, useRef, type ReactNode } from "react";
import {
	AdminPageChromeContext,
	useAdminPageChromeState,
} from "@/global/hooks/useAdminPageToolbar";

interface AdminPageLayoutProps {
	readonly breadcrumb?: ReactNode;
	/** Rendered in the sticky chrome row (e.g. Export, primary actions). */
	readonly actions?: ReactNode;
	/** Optional toolbar supplied by the route; dashboards register via useAdminPageToolbar. */
	readonly toolbar?: ReactNode;
	readonly children: ReactNode;
}

export function AdminPageLayout({
	breadcrumb,
	actions,
	toolbar: externalToolbar,
	children,
}: AdminPageLayoutProps) {
	const { registeredToolbar, value } = useAdminPageChromeState();
	const toolbar = externalToolbar ?? registeredToolbar;
	const showBreadcrumb = Boolean(breadcrumb);
	const showStickyChrome = showBreadcrumb || Boolean(actions || toolbar);
	const scrollRef = useRef<HTMLDivElement>(null);
	const chromeRef = useRef<HTMLDivElement>(null);

	// Publish the sticky chrome's live height as `--admin-chrome-height` so
	// content can stick just below it (e.g. the menu editor's category index).
	// It changes with the toolbar — a wrapped bulk-action bar is taller.
	useEffect(() => {
		const scroller = scrollRef.current;
		const chrome = chromeRef.current;
		if (!scroller || !chrome || typeof ResizeObserver === "undefined") return;
		const publish = () =>
			scroller.style.setProperty("--admin-chrome-height", `${chrome.offsetHeight}px`);
		publish();
		const observer = new ResizeObserver(publish);
		observer.observe(chrome);
		return () => observer.disconnect();
	}, [showStickyChrome]);

	return (
		<AdminPageChromeContext.Provider value={value}>
			<div className="flex h-full min-h-0 flex-col p-6">
				<div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
					{showStickyChrome ? (
						<div
							ref={chromeRef}
							className="sticky top-0 z-20 -mx-6 mb-4 border-b border-border bg-background px-6 pb-3"
						>
							{showBreadcrumb || actions ? (
								<div className="flex items-center justify-between gap-4">
									{showBreadcrumb ? <div>{breadcrumb}</div> : null}
									{actions ? (
										<div className="ml-auto flex shrink-0 items-center justify-end gap-2">
											{actions}
										</div>
									) : null}
								</div>
							) : null}
							{toolbar ? (
								<div className={showBreadcrumb || actions ? "mt-3" : undefined}>{toolbar}</div>
							) : null}
						</div>
					) : null}

					<div className="flex min-h-0 flex-1 flex-col">{children}</div>
				</div>
			</div>
		</AdminPageChromeContext.Provider>
	);
}
