/**
 * PROTOTYPE — throwaway. Four ways to navigate the same 12 sections
 * (grilling Q11). Everything else — shell, header, section insides, per-section
 * save, one URL per section — is held constant so only navigation differs.
 *
 *  A  Sub-nav por grupo     left sub-nav, one *group* page at a time
 *  B  Lista y detalle       iOS-style index; 2-pane on tablet/desktop, drill-in on phone
 *  C  Scroll con índice     everything on one scroll + scrollspy index
 *  D  Tarjetas resumen      read-only summary cards, edit in a sheet
 */
import { useIsNarrowViewport } from "@/global/hooks/useMediaQuery";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { GROUPS, SECTIONS, groupOf, useProtoStore, type SectionId, type SectionNav } from "./mock";
import { SectionBody, SectionCard, Sheet, Switch } from "./sections";
import { SettingsHeader } from "./shell";

export const VARIANTS = {
	A: { name: "Sub-nav por grupo", Component: VariantA },
	B: { name: "Lista y detalle", Component: VariantB },
	C: { name: "Scroll con índice", Component: VariantC },
	D: { name: "Tarjetas resumen", Component: VariantD },
} as const;

export type VariantKey = keyof typeof VARIANTS;

function scrollToSection(id: SectionId, behavior: ScrollBehavior = "smooth") {
	document.getElementById(`section-${id}`)?.scrollIntoView({ behavior, block: "start" });
}

function BackRow({ label, onClick }: Readonly<{ label: string; onClick: () => void }>) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
		>
			<ChevronLeft size={16} /> {label}
		</button>
	);
}

// ─── A ──────────────────────────────────────────────────────────────────────

function VariantA({ nav }: Readonly<{ nav: SectionNav }>) {
	const isPhone = useIsNarrowViewport();
	const active = nav.section ?? "general";
	const group = groupOf(active);

	useEffect(() => {
		if (!nav.section) return;
		if (group.sections[0] === nav.section)
			document.getElementById("proto-scroll")?.scrollTo({ top: 0 });
		else scrollToSection(nav.section);
	}, [nav.section, group]);

	const subNav = (
		<nav className="space-y-5">
			{GROUPS.map((g) => (
				<div key={g.id}>
					<button
						type="button"
						onClick={() => nav.go(g.sections[0])}
						className={`w-full text-left text-xs font-semibold uppercase tracking-wider ${g.id === group.id ? "text-foreground" : "text-faint-foreground hover:text-muted-foreground"}`}
					>
						{g.title}
					</button>
					<ul className="mt-1.5 space-y-0.5">
						{g.sections.map((s) => {
							const Icon = SECTIONS[s].icon;
							const isActive = s === active && g.id === group.id;
							return (
								<li key={s}>
									<button
										type="button"
										onClick={() => nav.go(s)}
										className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
											isActive
												? "bg-active text-foreground"
												: g.id === group.id
													? "text-muted-foreground hover:bg-hover"
													: "text-faint-foreground hover:bg-hover"
										}`}
									>
										<Icon size={15} /> {SECTIONS[s].title}
									</button>
								</li>
							);
						})}
					</ul>
				</div>
			))}
		</nav>
	);

	const groupPage = (
		<div className="space-y-4">
			<h2 className="text-base font-semibold text-foreground">{group.title}</h2>
			{group.sections.map((s) => (
				<SectionCard key={s} id={s} />
			))}
		</div>
	);

	return (
		<>
			<SettingsHeader />
			{/* phone: group index → group page */}
			{isPhone ? (
				<div className="px-3 py-4">
					{nav.section ? (
						<>
							<BackRow label="Configuración" onClick={() => nav.go(undefined)} />
							{groupPage}
						</>
					) : (
						<ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
							{GROUPS.map((g) => (
								<li key={g.id}>
									<button
										type="button"
										onClick={() => nav.go(g.sections[0])}
										className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-hover"
									>
										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium text-foreground">{g.title}</p>
											<p className="truncate text-xs text-faint-foreground">
												{g.sections.map((s) => SECTIONS[s].title).join(" · ")}
											</p>
										</div>
										<ChevronRight size={16} className="text-faint-foreground" />
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			) : (
				/* tablet/desktop: sub-nav + group page */
				<div className="flex gap-8 px-6 py-6">
					<aside className="w-52 shrink-0">
						<div className="sticky top-24">{subNav}</div>
					</aside>
					<div className="min-w-0 max-w-4xl flex-1 pb-24">{groupPage}</div>
				</div>
			)}
		</>
	);
}

// ─── B ──────────────────────────────────────────────────────────────────────

function IndexList({
	active,
	onPick,
}: Readonly<{ active?: SectionId; onPick: (s: SectionId) => void }>) {
	const { restaurant } = useProtoStore();
	return (
		<div className="space-y-5">
			{GROUPS.map((g) => (
				<div key={g.id}>
					<p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-faint-foreground">
						{g.title}
					</p>
					<ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
						{g.sections.map((s) => {
							const meta = SECTIONS[s];
							const Icon = meta.icon;
							return (
								<li key={s}>
									<button
										type="button"
										onClick={() => onPick(s)}
										className={`flex w-full items-center gap-3 px-3 py-3 text-left ${s === active ? "bg-active" : "hover:bg-hover"}`}
									>
										<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-tertiary text-foreground">
											<Icon size={16} />
										</span>
										<span className="min-w-0 flex-1">
											<span className="block text-sm font-medium text-foreground">
												{meta.title}
											</span>
											<span className="block truncate text-xs text-faint-foreground">
												{meta.summary(restaurant)}
											</span>
										</span>
										<ChevronRight size={16} className="shrink-0 text-faint-foreground" />
									</button>
								</li>
							);
						})}
					</ul>
				</div>
			))}
		</div>
	);
}

function DetailPane({ id }: Readonly<{ id: SectionId }>) {
	const meta = SECTIONS[id];
	return (
		<div className="@container">
			<p className="text-xs text-faint-foreground">{groupOf(id).title}</p>
			<h2 className="text-xl font-semibold text-foreground">{meta.title}</h2>
			<p className="mb-6 mt-1 text-sm text-muted-foreground">{meta.hint}</p>
			{/* key: a fresh draft per section */}
			<SectionBody key={id} id={id} />
		</div>
	);
}

function VariantB({ nav }: Readonly<{ nav: SectionNav }>) {
	const isPhone = useIsNarrowViewport();
	return (
		<>
			<SettingsHeader />
			{/* phone: drill-in */}
			{isPhone ? (
				<div className="px-3 py-4">
					{nav.section ? (
						<>
							<BackRow label="Configuración" onClick={() => nav.go(undefined)} />
							<DetailPane id={nav.section} />
						</>
					) : (
						<IndexList onPick={(s) => nav.go(s)} />
					)}
				</div>
			) : (
				/* tablet/desktop: master–detail */
				<div className="grid grid-cols-[17rem_minmax(0,1fr)] lg:grid-cols-[20rem_minmax(0,1fr)]">
					<aside className="sticky top-[61px] h-[calc(100dvh-61px)] overflow-y-auto border-r border-border p-4">
						<IndexList active={nav.section ?? "general"} onPick={(s) => nav.go(s)} />
					</aside>
					<div className="min-w-0 max-w-4xl px-8 py-6 pb-24">
						<DetailPane id={nav.section ?? "general"} />
					</div>
				</div>
			)}
		</>
	);
}

// ─── C ──────────────────────────────────────────────────────────────────────

function VariantC({ nav }: Readonly<{ nav: SectionNav }>) {
	const [active, setActive] = useState<SectionId>(nav.section ?? "general");
	const activeRef = useRef(active);
	const clickLock = useRef(0);
	const chipBar = useRef<HTMLDivElement>(null);
	const navRef = useRef(nav);
	navRef.current = nav;

	// Deep link: land on the section once.
	useEffect(() => {
		if (nav.section) scrollToSection(nav.section, "instant");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Scrollspy → active chip + URL (replace, so scrolling doesn't spam history).
	// Active = the last section whose top has passed the sticky chrome.
	useEffect(() => {
		const root = document.getElementById("proto-scroll");
		if (!root) return;
		const onScroll = () => {
			if (Date.now() < clickLock.current) return;
			const line = root.getBoundingClientRect().top + 140;
			const els = [...document.querySelectorAll<HTMLElement>("[data-section]")];
			let id = els[0]?.dataset.section as SectionId | undefined;
			for (const el of els)
				if (el.getBoundingClientRect().top <= line) id = el.dataset.section as SectionId;
			if (!id) return;
			if (id === activeRef.current) return;
			activeRef.current = id;
			setActive(id);
			navRef.current.go(id, { replace: true });
		};
		root.addEventListener("scroll", onScroll, { passive: true });
		return () => root.removeEventListener("scroll", onScroll);
	}, []);

	useEffect(() => {
		chipBar.current
			?.querySelector(`[data-chip="${active}"]`)
			?.scrollIntoView({ inline: "center", block: "nearest" });
	}, [active]);

	const jump = (s: SectionId) => {
		clickLock.current = Date.now() + 800;
		activeRef.current = s;
		setActive(s);
		nav.go(s, { replace: true });
		scrollToSection(s);
	};

	return (
		<>
			<SettingsHeader />
			{/* phone/tablet: sticky chip bar */}
			<div
				ref={chipBar}
				className="sticky top-[61px] z-10 flex gap-1.5 overflow-x-auto border-b border-border bg-background/95 px-3 py-2 backdrop-blur [scrollbar-width:none] lg:hidden"
			>
				{GROUPS.flatMap((g) => g.sections).map((s) => (
					<button
						key={s}
						data-chip={s}
						type="button"
						onClick={() => jump(s)}
						className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${s === active ? "bg-foreground text-background" : "bg-muted text-muted-foreground"}`}
					>
						{SECTIONS[s].title}
					</button>
				))}
			</div>
			<div className="flex gap-8 px-3 py-4 md:px-6 lg:py-6">
				<div className="min-w-0 max-w-4xl flex-1 space-y-8 pb-[50vh]">
					{GROUPS.map((g) => (
						<div key={g.id} className="space-y-4">
							<h2 className="text-xs font-semibold uppercase tracking-wider text-faint-foreground">
								{g.title}
							</h2>
							{g.sections.map((s) => (
								<SectionCard key={s} id={s} />
							))}
						</div>
					))}
				</div>
				{/* desktop: "on this page" index */}
				<aside className="hidden w-52 shrink-0 lg:block">
					<nav className="sticky top-24 space-y-4">
						{GROUPS.map((g) => (
							<div key={g.id}>
								<p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint-foreground">
									{g.title}
								</p>
								<ul className="space-y-0.5 border-l border-border">
									{g.sections.map((s) => (
										<li key={s}>
											<button
												type="button"
												onClick={() => jump(s)}
												className={`-ml-px block border-l-2 py-1 pl-3 text-left text-sm ${s === active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
											>
												{SECTIONS[s].title}
											</button>
										</li>
									))}
								</ul>
							</div>
						))}
					</nav>
				</aside>
			</div>
		</>
	);
}

// ─── D ──────────────────────────────────────────────────────────────────────

function VariantD({ nav }: Readonly<{ nav: SectionNav }>) {
	const { restaurant, update } = useProtoStore();
	// Quick toggles live on the card itself: no sheet for a one-tap change.
	const quick: Partial<Record<SectionId, ReactNode>> = {
		whatsapp: (
			<Switch
				checked={restaurant.whatsapp === "active"}
				onChange={(v) => update({ whatsapp: v ? "active" : "paused" })}
				label="Asistente activo"
			/>
		),
		orders: (
			<Switch
				checked={restaurant.releaseCash}
				onChange={(v) => update({ releaseCash: v })}
				label="Efectivo directo a cocina"
			/>
		),
	};
	return (
		<>
			<SettingsHeader />
			<div className="space-y-8 px-3 py-4 pb-24 md:px-6 md:py-6">
				{GROUPS.map((g) => (
					<div key={g.id}>
						<h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-faint-foreground">
							{g.title}
						</h2>
						<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
							{g.sections.map((s) => {
								const meta = SECTIONS[s];
								const Icon = meta.icon;
								return (
									<div
										key={s}
										className="flex flex-col rounded-xl border border-border bg-card p-4"
									>
										<div className="flex items-start gap-3">
											<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-tertiary text-foreground">
												<Icon size={16} />
											</span>
											<div className="min-w-0 flex-1">
												<p className="text-sm font-semibold text-foreground">{meta.title}</p>
												<p className="text-xs text-faint-foreground">{meta.hint}</p>
											</div>
											{quick[s] ?? null}
										</div>
										<dl className="mt-3 flex-1 space-y-1">
											{meta.facts(restaurant).map(([k, v]) => (
												<div key={k} className="flex gap-2 text-xs">
													<dt className="w-28 shrink-0 text-faint-foreground">{k}</dt>
													<dd className="min-w-0 truncate text-foreground">{v}</dd>
												</div>
											))}
										</dl>
										<button
											type="button"
											onClick={() => nav.go(s)}
											className="mt-3 self-start rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover"
										>
											{s === "tables" ? "Administrar" : "Editar"}
										</button>
									</div>
								);
							})}
						</div>
					</div>
				))}
			</div>
			<Sheet
				open={Boolean(nav.section)}
				onClose={() => nav.go(undefined)}
				title={nav.section ? SECTIONS[nav.section].title : ""}
				wide={nav.section === "branding"}
			>
				{nav.section ? (
					<>
						<p className="mb-5 text-sm text-muted-foreground">{SECTIONS[nav.section].hint}</p>
						<SectionBody key={nav.section} id={nav.section} />
					</>
				) : null}
			</Sheet>
		</>
	);
}
