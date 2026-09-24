import type { SettingsNavGroup } from "@/features/restaurants/components/settings/settingsNav";
import type { RestaurantSettingsNavId } from "@/features/restaurants/constants";
import { useIsNarrowViewport } from "@/global/hooks";
import { RestaurantsKeys } from "@/global/i18n";
import type { Doc } from "convex/_generated/dataModel";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface SettingsLayoutProps {
	readonly restaurant: Doc<"restaurants">;
	/** Only the entries this viewer may see (see `visibleSettingsNav`). */
	readonly groups: readonly SettingsNavGroup[];
	readonly renderSection: (id: RestaurantSettingsNavId) => ReactNode;
	/** The `?section=` deep link; undefined on the phone list. */
	readonly section: RestaurantSettingsNavId | undefined;
	/** `replace` for scroll-driven updates, so scrolling doesn't fill history. */
	readonly onSectionChange: (
		section: RestaurantSettingsNavId | undefined,
		opts?: { replace?: boolean }
	) => void;
}

export function settingsAnchorId(id: RestaurantSettingsNavId): string {
	return `settings-anchor-${id}`;
}

/** Nearest scrolling ancestor — the canvas scrolls inside the route, not the window. */
function getScrollParent(el: HTMLElement | null): HTMLElement | null {
	let node = el?.parentElement ?? null;
	while (node) {
		const { overflowY } = getComputedStyle(node);
		if (overflowY === "auto" || overflowY === "scroll") return node;
		node = node.parentElement;
	}
	return null;
}

// ─── desktop: one scroll + "on this page" index ─────────────────────────────

/**
 * Desktop (>= 1024px): every section on one scroll, grouped, with a sticky
 * index that follows the reader. The index writes `?section=` with `replace`
 * so a link copied mid-scroll lands on the same section.
 */
export function SettingsScrollLayout({
	groups,
	renderSection,
	section,
	onSectionChange,
}: Readonly<SettingsLayoutProps>) {
	const { t } = useTranslation();
	const rootRef = useRef<HTMLDivElement>(null);
	const ids = groups.flatMap((g) => g.entries.map((e) => e.id));
	const [active, setActive] = useState<RestaurantSettingsNavId | undefined>(section ?? ids[0]);
	const activeRef = useRef(active);
	/** Ignore the scrollspy while a click-initiated smooth scroll is in flight. */
	const lockUntil = useRef(0);
	const onSectionChangeRef = useRef(onSectionChange);
	onSectionChangeRef.current = onSectionChange;

	// Land on a deep-linked section once, on mount.
	useEffect(() => {
		if (section) document.getElementById(settingsAnchorId(section))?.scrollIntoView?.();
		// eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
	}, []);

	useEffect(() => {
		const scroller = getScrollParent(rootRef.current);
		const target: HTMLElement | Window = scroller ?? globalThis.window;
		const onScroll = () => {
			if (Date.now() < lockUntil.current) return;
			const anchors = rootRef.current?.querySelectorAll<HTMLElement>("[data-settings-anchor]");
			if (!anchors?.length) return;
			const top = scroller ? scroller.getBoundingClientRect().top : 0;
			// A section is current once its top passes under the sticky header.
			const line = top + 120;
			let current = anchors[0].dataset.settingsAnchor as RestaurantSettingsNavId;
			for (const a of anchors) {
				if (a.getBoundingClientRect().top <= line) {
					current = a.dataset.settingsAnchor as RestaurantSettingsNavId;
				}
			}
			// The last sections can be too short to reach the line: at the bottom,
			// the last one is the current one.
			if (scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
				current = anchors[anchors.length - 1].dataset.settingsAnchor as RestaurantSettingsNavId;
			}
			if (current === activeRef.current) return;
			activeRef.current = current;
			setActive(current);
			onSectionChangeRef.current(current, { replace: true });
		};
		target.addEventListener("scroll", onScroll, { passive: true });
		return () => target.removeEventListener("scroll", onScroll);
	}, []);

	const jump = (id: RestaurantSettingsNavId) => {
		lockUntil.current = Date.now() + 800;
		activeRef.current = id;
		setActive(id);
		onSectionChange(id, { replace: true });
		document.getElementById(settingsAnchorId(id))?.scrollIntoView?.({ behavior: "smooth" });
	};

	return (
		<div ref={rootRef} className="flex gap-10 px-6 py-6">
			<div className="min-w-0 max-w-4xl flex-1 space-y-10 pb-16">
				{groups.map((g) => (
					<section key={g.id} aria-labelledby={`settings-group-${g.id}`} className="space-y-4">
						<h2
							id={`settings-group-${g.id}`}
							className="text-xs font-semibold uppercase tracking-wider text-faint-foreground"
						>
							{t(g.titleKey)}
						</h2>
						{g.entries.map((e) => (
							<div
								key={e.id}
								id={settingsAnchorId(e.id)}
								data-settings-anchor={e.id}
								className="scroll-mt-24"
							>
								{renderSection(e.id)}
							</div>
						))}
					</section>
				))}
			</div>
			<nav aria-label={t(RestaurantsKeys.SETTINGS_NAV_LABEL)} className="w-52 shrink-0">
				<div className="sticky top-24 space-y-5">
					{groups.map((g) => (
						<div key={g.id}>
							<p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint-foreground">
								{t(g.titleKey)}
							</p>
							<ul className="space-y-0.5 border-l border-border">
								{g.entries.map((e) => {
									const isActive = e.id === active;
									return (
										<li key={e.id}>
											<button
												type="button"
												onClick={() => jump(e.id)}
												aria-current={isActive ? "location" : undefined}
												className={`-ml-px block w-full border-l-2 py-1 pl-3 text-left text-sm ${
													isActive
														? "border-foreground text-foreground"
														: "border-transparent text-muted-foreground hover:text-foreground"
												}`}
											>
												{t(e.titleKey)}
											</button>
										</li>
									);
								})}
							</ul>
						</div>
					))}
				</div>
			</nav>
		</div>
	);
}

// ─── tablet + phone: list and detail ────────────────────────────────────────

function SettingsIndexList({
	restaurant,
	groups,
	active,
	onPick,
	showIcons,
}: Readonly<{
	restaurant: Doc<"restaurants">;
	groups: readonly SettingsNavGroup[];
	active?: RestaurantSettingsNavId;
	onPick: (id: RestaurantSettingsNavId) => void;
	/**
	 * Off in the tablet side list: at 17rem the icon tiles were what made
	 * titles wrap and summaries truncate (prototype finding).
	 */
	showIcons: boolean;
}>) {
	const { t } = useTranslation();
	return (
		<nav aria-label={t(RestaurantsKeys.SETTINGS_NAV_LABEL)} className="space-y-5">
			{groups.map((g) => (
				<div key={g.id}>
					<p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-faint-foreground">
						{t(g.titleKey)}
					</p>
					<ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-muted/30">
						{g.entries.map((e) => {
							const Icon = e.icon;
							const isActive = e.id === active;
							return (
								<li key={e.id}>
									<button
										type="button"
										onClick={() => onPick(e.id)}
										aria-current={isActive ? "page" : undefined}
										className={`flex w-full items-center gap-3 px-3 py-3 text-left ${
											isActive ? "bg-active" : "hover:bg-hover"
										}`}
									>
										{showIcons ? (
											<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-tertiary text-foreground">
												<Icon size={16} aria-hidden />
											</span>
										) : null}
										<span className="min-w-0 flex-1">
											<span className="block text-sm font-medium text-foreground">
												{t(e.titleKey)}
											</span>
											<span className="block truncate text-xs text-faint-foreground">
												{e.summary(restaurant, t)}
											</span>
										</span>
										<ChevronRight
											size={16}
											className="shrink-0 text-faint-foreground"
											aria-hidden
										/>
									</button>
								</li>
							);
						})}
					</ul>
				</div>
			))}
		</nav>
	);
}

/**
 * Below desktop: the settings list with each section's current value.
 * Tablet shows list and section side by side; a phone drills in, and back
 * (or the browser's back, since picking pushes history) returns to the list.
 */
export function SettingsListDetailLayout({
	restaurant,
	groups,
	renderSection,
	section,
	onSectionChange,
}: Readonly<SettingsLayoutProps>) {
	const { t } = useTranslation();
	const isPhone = useIsNarrowViewport();
	const rootRef = useRef<HTMLDivElement>(null);
	const first = groups[0]?.entries[0]?.id;

	// Changing section replaces the detail (the whole screen on a phone):
	// start it at the top. Not on mount — the page is already there.
	const mounted = useRef(false);
	useEffect(() => {
		if (!mounted.current) {
			mounted.current = true;
			return;
		}
		rootRef.current?.scrollIntoView?.({ block: "start" });
	}, [section]);

	if (isPhone) {
		return (
			<div ref={rootRef} className="scroll-mt-24 px-3 py-4">
				{section ? (
					<>
						<button
							type="button"
							onClick={() => onSectionChange(undefined)}
							className="mb-3 inline-flex items-center gap-1 rounded-md py-1 text-sm text-muted-foreground hover:text-foreground"
						>
							<ChevronLeft size={16} aria-hidden />
							{t(RestaurantsKeys.SETTINGS_NAV_BACK)}
						</button>
						{renderSection(section)}
					</>
				) : (
					<SettingsIndexList
						restaurant={restaurant}
						groups={groups}
						onPick={(id) => onSectionChange(id)}
						showIcons
					/>
				)}
			</div>
		);
	}

	const current = section ?? first;
	return (
		<div ref={rootRef} className="grid grid-cols-[17rem_minmax(0,1fr)] gap-5 px-4 py-4">
			<div className="sticky top-20 max-h-[calc(100dvh-7rem)] self-start overflow-y-auto">
				<SettingsIndexList
					restaurant={restaurant}
					groups={groups}
					active={current}
					onPick={(id) => onSectionChange(id)}
					showIcons={false}
				/>
			</div>
			<div className="min-w-0 pb-16">{current ? renderSection(current) : null}</div>
		</div>
	);
}
