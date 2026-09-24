/**
 * PROTOTYPE — throwaway. What every variant holds constant:
 *
 *  - Selection is colour, not checkboxes: click a row to select it, Shift+click
 *    for a range, the section header's pill selects the whole section. While
 *    anything is selected the toolbar turns into the bulk-action bar.
 *  - A sticky category index on the right (desktop), the same scrollspy
 *    pattern as the restaurant settings page, with counts and a selection tally.
 *  - Image and fields are ONE editor (no separate image button/panel).
 *
 * What varies is only where and how that editor opens — see variants.tsx.
 */
import {
	ArrowLeft,
	Check,
	ChevronDown,
	ChevronsDownUp,
	ChevronsUpDown,
	Download,
	Eye,
	EyeOff,
	Globe,
	ImagePlus,
	LayoutGrid,
	ListChecks,
	Loader2,
	Pencil,
	Plus,
	Search,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import {
	AI_RESULTS,
	OPTION_GROUPS,
	money,
	useMenuStore,
	type MockCategory,
	type MockItem,
	type Station,
} from "./mock";

// ─── helpers ────────────────────────────────────────────────────────────────

const fold = (s: string) =>
	s
		.normalize("NFD")
		.replaceAll(/\p{Diacritic}/gu, "")
		.toLowerCase();

export const STATION: Record<Station, { label: string; dot: string; chip: string }> = {
	kitchen: {
		label: "Cocina",
		dot: "bg-[var(--station-kitchen)]",
		chip: "bg-[var(--station-kitchen-light)] text-[var(--station-kitchen)]",
	},
	bar: {
		label: "Barra",
		dot: "bg-[var(--station-bar)]",
		chip: "bg-[var(--station-bar-light)] text-[var(--station-bar)]",
	},
};

// ─── page context (selection + editing) ─────────────────────────────────────

interface PageCtx {
	selected: ReadonlySet<string>;
	toggle: (id: string, e?: { shiftKey?: boolean }) => void;
	setMany: (ids: string[], on: boolean) => void;
	editingId: string | null;
	onEdit: (id: string | null) => void;
	visibleItemsOf: (categoryId: string) => MockItem[];
}
const PageContext = createContext<PageCtx | null>(null);
export const usePage = () => {
	const c = useContext(PageContext);
	if (!c) throw new Error("EditorPage missing");
	return c;
};

// ─── the page ───────────────────────────────────────────────────────────────

export interface EditorPageProps {
	editingId: string | null;
	onEdit: (id: string | null) => void;
	/** Rendered right under a row (variant B). */
	inlineEditor?: (item: MockItem) => ReactNode;
	/** Replaces the category index in the right column (variant A). */
	aside?: ReactNode;
	/** Replaces the default row entirely (variant D). */
	renderRow?: (item: MockItem) => ReactNode;
	/** Extra column headers above each section's rows (variant D). */
	sectionHeader?: ReactNode;
	/** Overlays (variant C's dialog). */
	children?: ReactNode;
}

export function EditorPage({
	editingId,
	onEdit,
	inlineEditor,
	aside,
	renderRow,
	sectionHeader,
	children,
}: Readonly<EditorPageProps>) {
	const store = useMenuStore();
	const [query, setQuery] = useState("");
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const anchor = useRef<string | null>(null);

	const q = fold(query.trim());
	const visibleItemsOf = useCallback(
		(categoryId: string) => {
			const cat = store.categories.find((c) => c.id === categoryId);
			const items = store.itemsOf(categoryId);
			if (!q || (cat && fold(cat.name).includes(q))) return items;
			return items.filter((i) => fold(i.name).includes(q));
		},
		[store, q]
	);
	const visibleCategories = store.categories.filter(
		(c) => !q || fold(c.name).includes(q) || visibleItemsOf(c.id).length > 0
	);
	const allVisibleIds = visibleCategories.flatMap((c) => visibleItemsOf(c.id).map((i) => i.id));

	// Items that vanish (deleted, filtered out) leave the selection.
	const visibleKey = allVisibleIds.join(",");
	useEffect(() => {
		const vis = new Set(visibleKey.split(","));
		setSelected((prev) => {
			const next = new Set([...prev].filter((id) => vis.has(id)));
			return next.size === prev.size ? prev : next;
		});
	}, [visibleKey]);

	const toggle = useCallback(
		(id: string, e?: { shiftKey?: boolean }) => {
			setSelected((prev) => {
				const next = new Set(prev);
				if (e?.shiftKey && anchor.current && anchor.current !== id) {
					const a = allVisibleIds.indexOf(anchor.current);
					const b = allVisibleIds.indexOf(id);
					if (a !== -1 && b !== -1) {
						const on = !prev.has(id);
						for (const rid of allVisibleIds.slice(Math.min(a, b), Math.max(a, b) + 1)) {
							if (on) next.add(rid);
							else next.delete(rid);
						}
						return next;
					}
				}
				if (next.has(id)) next.delete(id);
				else next.add(id);
				return next;
			});
			anchor.current = id;
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[visibleKey]
	);

	const setMany = useCallback((ids: string[], on: boolean) => {
		setSelected((prev) => {
			const next = new Set(prev);
			for (const id of ids) {
				if (on) next.add(id);
				else next.delete(id);
			}
			return next;
		});
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || editingId) return;
			setSelected(new Set());
		};
		globalThis.addEventListener("keydown", onKey);
		return () => globalThis.removeEventListener("keydown", onKey);
	}, [editingId]);

	const anyExpanded = visibleCategories.some((c) => !collapsed[c.id]);
	const ctx = useMemo<PageCtx>(
		() => ({ selected, toggle, setMany, editingId, onEdit, visibleItemsOf }),
		[selected, toggle, setMany, editingId, onEdit, visibleItemsOf]
	);

	return (
		<PageContext.Provider value={ctx}>
			<div className="px-4 pt-5 md:px-6">
				<div className="flex flex-wrap items-center gap-3">
					<button
						type="button"
						className="flex items-center gap-1.5 text-sm text-primary hover:underline"
					>
						<ArrowLeft size={15} /> Volver a todos los menús
					</button>
					<div className="ml-auto flex items-center gap-2">
						<button
							type="button"
							className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium hover-btn-primary"
						>
							<Plus size={16} /> Agregar categoría
						</button>
						<button
							type="button"
							className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm hover-btn-secondary"
						>
							<Download size={15} /> Exportar
						</button>
					</div>
				</div>
			</div>

			<Toolbar
				query={query}
				setQuery={setQuery}
				allVisibleIds={allVisibleIds}
				selected={selected}
				clear={() => setSelected(new Set())}
				selectAll={() => setSelected(new Set(allVisibleIds))}
				anyExpanded={anyExpanded}
				toggleAll={() => {
					const next: Record<string, boolean> = {};
					for (const c of visibleCategories) next[c.id] = anyExpanded;
					setCollapsed(next);
				}}
			/>

			<div className="flex gap-8 px-4 pb-32 pt-4 md:px-6">
				<div className="min-w-0 flex-1 space-y-5">
					{visibleCategories.length === 0 ? (
						<p className="py-10 text-center text-sm text-muted-foreground">
							Ningún producto ni categoría coincide con “{query}”.
						</p>
					) : null}
					{visibleCategories.map((c) => (
						<CategoryCard
							key={c.id}
							category={c}
							collapsed={!!collapsed[c.id]}
							onCollapsedChange={(v) => setCollapsed((p) => ({ ...p, [c.id]: v }))}
							inlineEditor={inlineEditor}
							renderRow={renderRow}
							sectionHeader={sectionHeader}
						/>
					))}
				</div>
				<div className="hidden w-56 shrink-0 lg:block" style={aside ? { width: 400 } : undefined}>
					{aside ?? (
						<CategoryIndex
							categories={visibleCategories}
							onJump={(id) => setCollapsed((p) => ({ ...p, [id]: false }))}
						/>
					)}
				</div>
			</div>
			{children}
		</PageContext.Provider>
	);
}

// ─── toolbar ↔ bulk bar ─────────────────────────────────────────────────────

function Toolbar({
	query,
	setQuery,
	allVisibleIds,
	selected,
	clear,
	selectAll,
	anyExpanded,
	toggleAll,
}: Readonly<{
	query: string;
	setQuery: (q: string) => void;
	allVisibleIds: string[];
	selected: ReadonlySet<string>;
	clear: () => void;
	selectAll: () => void;
	anyExpanded: boolean;
	toggleAll: () => void;
}>) {
	const store = useMenuStore();
	const [lang, setLang] = useState<"en" | "es">("es");
	const n = selected.size;
	const cats = new Set(store.items.filter((i) => selected.has(i.id)).map((i) => i.categoryId)).size;
	const act = (fn: () => void) => () => {
		fn();
		clear();
	};

	return (
		<div className="sticky top-0 z-20 bg-background/95 px-4 pt-3 backdrop-blur md:px-6">
			<div className="border-b border-border pb-3">
				{n > 0 ? (
					<div className="flex min-h-10 flex-wrap items-center gap-2 rounded-xl bg-primary/12 py-1 pl-1.5 pr-2 ring-1 ring-primary/45">
						<button
							type="button"
							onClick={clear}
							aria-label="Quitar selección"
							className="rounded-lg p-1.5 text-foreground hover:bg-primary/20"
						>
							<X size={16} />
						</button>
						<span className="text-sm font-medium text-foreground">
							{n} {n === 1 ? "seleccionado" : "seleccionados"}
							<span className="ml-1.5 font-normal text-muted-foreground">
								en {cats} {cats === 1 ? "categoría" : "categorías"}
							</span>
						</span>
						{n < allVisibleIds.length ? (
							<button
								type="button"
								onClick={selectAll}
								className="ml-1 text-xs text-primary hover:underline"
							>
								Seleccionar los {allVisibleIds.length}
							</button>
						) : null}
						<div className="ml-auto flex flex-wrap items-center gap-1">
							<BulkButton onClick={act(() => store.updateItems(selected, { available: false }))}>
								<EyeOff size={14} /> Ocultar
							</BulkButton>
							<BulkButton onClick={act(() => store.updateItems(selected, { available: true }))}>
								<Eye size={14} /> Mostrar
							</BulkButton>
							<span className="mx-1 h-5 w-px bg-border" />
							<BulkButton onClick={act(() => store.updateItems(selected, { station: "kitchen" }))}>
								<span className={`h-2 w-2 rounded-full ${STATION.kitchen.dot}`} /> A cocina
							</BulkButton>
							<BulkButton onClick={act(() => store.updateItems(selected, { station: "bar" }))}>
								<span className={`h-2 w-2 rounded-full ${STATION.bar.dot}`} /> A barra
							</BulkButton>
							<span className="mx-1 h-5 w-px bg-border" />
							<BulkButton
								danger
								onClick={act(() => {
									if (confirm(`¿Eliminar ${n} productos?`)) store.removeItems(selected);
								})}
							>
								<Trash2 size={14} /> Eliminar
							</BulkButton>
						</div>
					</div>
				) : (
					<div className="flex min-h-10 flex-wrap items-center gap-3">
						<button
							type="button"
							onClick={selectAll}
							className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-hover"
						>
							<ListChecks size={16} /> Seleccionar todo
						</button>
						<label className="flex h-9 min-w-48 max-w-md flex-1 items-center gap-2 rounded-lg border border-input-border bg-input px-3 focus-within:border-input-border-focus">
							<Search size={15} className="text-faint-foreground" />
							<input
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="Filtrar categorías y productos"
								className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-input-placeholder"
							/>
						</label>
						<div className="ml-auto flex items-center gap-1">
							<button
								type="button"
								onClick={toggleAll}
								className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-faint-foreground hover:bg-hover"
							>
								{anyExpanded ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
								<span className="hidden xl:inline">
									{anyExpanded ? "Contraer todo" : "Expandir todo"}
								</span>
							</button>
							<div className="flex rounded-lg bg-muted p-0.5 text-xs">
								{(["en", "es"] as const).map((l) => (
									<button
										key={l}
										type="button"
										onClick={() => setLang(l)}
										className={`rounded-md px-3 py-1.5 ${lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
									>
										{l === "en" ? "English" : "Español"}
										{l === "es" ? (
											<span className="ml-1 text-[10px] opacity-70">(default)</span>
										) : null}
									</button>
								))}
							</div>
							<button
								type="button"
								className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-faint-foreground hover:bg-hover"
							>
								<Globe size={16} /> <span className="hidden xl:inline">Idiomas</span>
							</button>
							<button
								type="button"
								className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-faint-foreground hover:bg-hover"
							>
								<LayoutGrid size={16} /> <span className="hidden xl:inline">Opciones</span>
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function BulkButton({
	children,
	onClick,
	danger,
}: Readonly<{ children: ReactNode; onClick: () => void; danger?: boolean }>) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium hover:bg-primary/20 ${danger ? "text-destructive" : "text-foreground"}`}
		>
			{children}
		</button>
	);
}

// ─── category card ──────────────────────────────────────────────────────────

export const anchorId = (categoryId: string) => `cat-${categoryId}`;

function CategoryCard({
	category,
	collapsed,
	onCollapsedChange,
	inlineEditor,
	renderRow,
	sectionHeader,
}: Readonly<{
	category: MockCategory;
	collapsed: boolean;
	onCollapsedChange: (v: boolean) => void;
	inlineEditor?: (item: MockItem) => ReactNode;
	renderRow?: (item: MockItem) => ReactNode;
	sectionHeader?: ReactNode;
}>) {
	const store = useMenuStore();
	const { selected, setMany, visibleItemsOf } = usePage();
	const items = visibleItemsOf(category.id);
	const ids = items.map((i) => i.id);
	const count = ids.filter((id) => selected.has(id)).length;
	const all = ids.length > 0 && count === ids.length;

	return (
		<section
			id={anchorId(category.id)}
			data-cat-anchor={category.id}
			className={`group/cat scroll-mt-20 rounded-xl border transition-colors ${
				all ? "border-primary/50 bg-primary/[0.06]" : "border-border bg-muted/40"
			}`}
		>
			<header className="flex items-center gap-2 py-2 pl-2 pr-3">
				<button
					type="button"
					onClick={() => onCollapsedChange(!collapsed)}
					aria-expanded={!collapsed}
					className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
				>
					<ChevronDown
						size={16}
						className={`shrink-0 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`}
					/>
					<span className="truncate text-[15px] font-semibold text-foreground">
						{category.name}
					</span>
					<span className="text-xs tabular-nums text-faint-foreground">{items.length}</span>
				</button>
				{ids.length > 0 ? (
					<button
						type="button"
						onClick={() => setMany(ids, !all)}
						className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition ${
							all
								? "bg-primary text-primary-foreground"
								: count > 0
									? "bg-primary/15 text-primary ring-1 ring-primary/50"
									: "text-muted-foreground opacity-0 ring-1 ring-border group-hover/cat:opacity-100 hover:text-foreground focus-visible:opacity-100"
						}`}
					>
						{all ? <Check size={13} /> : null}
						{all
							? "Sección seleccionada"
							: count > 0
								? `${count} de ${ids.length}`
								: "Seleccionar sección"}
					</button>
				) : null}
				<button
					type="button"
					onClick={() => {
						if (confirm(`¿Eliminar la categoría ${category.name} y sus productos?`))
							store.removeCategory(category.id);
					}}
					aria-label={`Eliminar ${category.name}`}
					className="rounded-md p-1.5 text-faint-foreground hover:bg-hover hover:text-destructive"
				>
					<Trash2 size={15} />
				</button>
			</header>
			{collapsed ? null : (
				<div className="space-y-1.5 px-2 pb-2">
					{sectionHeader}
					{items.map((item) =>
						renderRow ? (
							<div key={item.id}>{renderRow(item)}</div>
						) : (
							<div key={item.id}>
								<ItemRow item={item} attached={!!inlineEditor && !!inlineEditor(item)} />
								{inlineEditor?.(item)}
							</div>
						)
					)}
					<button
						type="button"
						className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-primary hover:bg-hover"
					>
						<Plus size={15} /> Agregar producto
					</button>
				</div>
			)}
		</section>
	);
}

// ─── the default row ────────────────────────────────────────────────────────

/** Row surface shared by the default row and variant D's editable row. */
export function rowSurface(isSelected: boolean, isEditing: boolean) {
	if (isEditing) return "bg-background ring-2 ring-primary/70";
	if (isSelected)
		return "bg-primary/[0.14] ring-1 ring-primary/55 shadow-[inset_3px_0_0_var(--color-primary)]";
	return "bg-background ring-1 ring-border hover:bg-hover";
}

/** Toggle selection from a click on the row's own surface, not its controls. */
export function isOwnClick(e: React.MouseEvent) {
	return !(e.target as HTMLElement).closest("button, input, textarea, a, label, [data-no-select]");
}

function ItemRow({ item, attached }: Readonly<{ item: MockItem; attached: boolean }>) {
	const store = useMenuStore();
	const { selected, toggle, editingId, onEdit } = usePage();
	const isSelected = selected.has(item.id);
	const isEditing = editingId === item.id;

	return (
		<div
			role="checkbox"
			aria-checked={isSelected}
			aria-label={item.name}
			tabIndex={0}
			onClick={(e) => {
				if (isOwnClick(e)) toggle(item.id, e);
			}}
			onDoubleClick={(e) => {
				if (isOwnClick(e)) onEdit(item.id);
			}}
			onKeyDown={(e) => {
				if (e.target !== e.currentTarget) return;
				if (e.key === " ") {
					e.preventDefault();
					toggle(item.id, e);
				}
				if (e.key === "Enter") onEdit(item.id);
			}}
			className={`group/row flex cursor-pointer select-none items-center gap-3 rounded-lg px-2.5 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary ${rowSurface(isSelected, isEditing)} ${attached ? "rounded-b-none" : ""}`}
		>
			<Thumb item={item} />
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
					<span
						className={`text-sm font-medium ${item.available ? "text-foreground" : "text-faint-foreground line-through decoration-1"}`}
					>
						{item.name}
					</span>
					<span className="text-sm tabular-nums text-muted-foreground">{money(item.price)}</span>
					<ItemBadges item={item} />
				</div>
				{item.description ? (
					<p className="truncate text-xs text-faint-foreground">{item.description}</p>
				) : null}
			</div>
			<div className="flex items-center gap-0.5">
				<IconButton
					label="Editar"
					onClick={() => onEdit(isEditing ? null : item.id)}
					active={isEditing}
				>
					<Pencil size={15} />
				</IconButton>
				<IconButton
					label={item.available ? "Ocultar del menú" : "Mostrar en el menú"}
					onClick={() => store.updateItem(item.id, { available: !item.available })}
				>
					{item.available ? <Eye size={16} className="text-success" /> : <EyeOff size={16} />}
				</IconButton>
				<IconButton
					label="Eliminar"
					danger
					onClick={() => {
						if (confirm(`¿Eliminar ${item.name}?`)) store.removeItems([item.id]);
					}}
				>
					<Trash2 size={15} />
				</IconButton>
			</div>
		</div>
	);
}

export function ItemBadges({ item }: Readonly<{ item: MockItem }>) {
	return (
		<>
			<span
				className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[11px] ${STATION[item.station].chip}`}
			>
				{STATION[item.station].label}
			</span>
			{item.optionGroupIds.map((g) => (
				<span
					key={g}
					className="rounded-full bg-tertiary px-1.5 py-px text-[11px] text-muted-foreground"
				>
					{OPTION_GROUPS.find((o) => o.id === g)?.name}
				</span>
			))}
			{item.available ? null : (
				<span className="rounded-full bg-warning-subtle px-1.5 py-px text-[11px] text-warning">
					Oculto
				</span>
			)}
		</>
	);
}

export function Thumb({ item, size = 44 }: Readonly<{ item: MockItem; size?: number }>) {
	return (
		<span className="relative shrink-0" style={{ width: size, height: size }}>
			{item.image ? (
				<img
					src={item.image}
					alt=""
					className={`h-full w-full rounded-md object-cover ${item.available ? "" : "opacity-40 grayscale"}`}
				/>
			) : (
				<span className="flex h-full w-full items-center justify-center rounded-md border border-dashed border-border-strong text-faint-foreground">
					<ImagePlus size={16} />
				</span>
			)}
			{item.imageSource === "ai" && item.image ? (
				<AIBadge className="absolute -bottom-1 -right-1" />
			) : null}
		</span>
	);
}

export function AIBadge({ className = "" }: Readonly<{ className?: string }>) {
	return (
		<span
			className={`rounded bg-primary px-1 text-[9px] font-bold leading-[14px] text-primary-foreground ${className}`}
		>
			IA
		</span>
	);
}

export function IconButton({
	children,
	label,
	onClick,
	active,
	danger,
}: Readonly<{
	children: ReactNode;
	label: string;
	onClick: () => void;
	active?: boolean;
	danger?: boolean;
}>) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			onClick={onClick}
			className={`rounded-md p-1.5 hover:bg-hover ${
				active
					? "text-primary"
					: danger
						? "text-faint-foreground hover:text-destructive"
						: "text-faint-foreground hover:text-foreground"
			}`}
		>
			{children}
		</button>
	);
}

// ─── category index (right rail) ────────────────────────────────────────────

function CategoryIndex({
	categories,
	onJump,
}: Readonly<{ categories: MockCategory[]; onJump: (id: string) => void }>) {
	const { selected, visibleItemsOf } = usePage();
	const [active, setActive] = useState<string | undefined>(categories[0]?.id);
	const lockUntil = useRef(0);

	useEffect(() => {
		const scroller = document.getElementById("proto-scroll");
		if (!scroller) return;
		const onScroll = () => {
			if (Date.now() < lockUntil.current) return;
			const anchors = scroller.querySelectorAll<HTMLElement>("[data-cat-anchor]");
			if (!anchors.length) return;
			const line = scroller.getBoundingClientRect().top + 110;
			let current = anchors[0].dataset.catAnchor;
			for (const a of anchors)
				if (a.getBoundingClientRect().top <= line) current = a.dataset.catAnchor;
			if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4)
				current = anchors[anchors.length - 1].dataset.catAnchor;
			setActive(current);
		};
		onScroll();
		scroller.addEventListener("scroll", onScroll, { passive: true });
		return () => scroller.removeEventListener("scroll", onScroll);
	}, []);

	const jump = (id: string) => {
		onJump(id);
		lockUntil.current = Date.now() + 800;
		setActive(id);
		requestAnimationFrame(() =>
			document.getElementById(anchorId(id))?.scrollIntoView({ behavior: "smooth", block: "start" })
		);
	};

	return (
		<nav aria-label="Categorías" className="sticky top-24">
			<p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint-foreground">
				Categorías
			</p>
			<ul className="border-l border-border">
				{categories.map((c) => {
					const items = visibleItemsOf(c.id);
					const sel = items.filter((i) => selected.has(i.id)).length;
					const isActive = c.id === active;
					return (
						<li key={c.id}>
							<button
								type="button"
								onClick={() => jump(c.id)}
								aria-current={isActive ? "location" : undefined}
								className={`-ml-px flex w-full items-center gap-2 border-l-2 py-1.5 pl-3 pr-1 text-left text-sm ${
									isActive
										? "border-foreground text-foreground"
										: "border-transparent text-muted-foreground hover:text-foreground"
								}`}
							>
								<span className="min-w-0 flex-1 truncate">{c.name}</span>
								{sel > 0 ? (
									<span className="rounded-full bg-primary/20 px-1.5 text-[11px] font-medium tabular-nums text-primary">
										{sel}/{items.length}
									</span>
								) : (
									<span className="text-xs tabular-nums text-faint-foreground">{items.length}</span>
								)}
							</button>
						</li>
					);
				})}
			</ul>
			<button
				type="button"
				className="mt-3 flex items-center gap-1.5 pl-3 text-xs text-faint-foreground hover:text-foreground"
			>
				<Plus size={13} /> Agregar categoría
			</button>
			<p className="mt-6 pl-3 text-[11px] leading-relaxed text-faint-foreground">
				Clic en un producto para seleccionarlo · Mayús+clic para un rango · doble clic o Enter para
				editar · Esc limpia la selección
			</p>
		</nav>
	);
}

// ─── editor draft (fields + image as one unit) ──────────────────────────────

export interface Draft {
	name: string;
	price: string;
	description: string;
	station: Station;
	available: boolean;
	optionGroupIds: string[];
	image: string | null;
	imageSource?: "upload" | "ai";
}

const toDraft = (i: MockItem): Draft => ({
	name: i.name,
	price: (i.price / 100).toFixed(2),
	description: i.description,
	station: i.station,
	available: i.available,
	optionGroupIds: i.optionGroupIds,
	image: i.image,
	imageSource: i.imageSource,
});

let aiTurn = 0;

/** One draft for everything the editor touches; Save commits it all at once. */
export function useItemDraft(item: MockItem) {
	const store = useMenuStore();
	const [draft, setDraft] = useState(() => toDraft(item));
	const [generating, setGenerating] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	useEffect(() => setDraft(toDraft(item)), [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

	const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
	const base = toDraft(item);
	const dirty = JSON.stringify(base) !== JSON.stringify(draft);
	const imageDirty = base.image !== draft.image;

	const applyFile = (file: File | undefined | null) => {
		if (!file?.type.startsWith("image/")) return;
		setDraft((d) => ({ ...d, image: URL.createObjectURL(file), imageSource: "upload" }));
	};

	return {
		draft,
		set,
		dirty,
		imageDirty,
		generating,
		reset: () => setDraft(base),
		save: () => {
			const cents = Math.round(Number.parseFloat(draft.price || "0") * 100);
			store.updateItem(item.id, {
				name: draft.name.trim() || item.name,
				price: Number.isNaN(cents) ? item.price : cents,
				description: draft.description,
				station: draft.station,
				available: draft.available,
				optionGroupIds: draft.optionGroupIds,
				image: draft.image,
				imageSource: draft.imageSource,
			});
		},
		pickFile: () => fileRef.current?.click(),
		onPaste: (e: React.ClipboardEvent) => {
			const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/"));
			if (f) {
				e.preventDefault();
				applyFile(f);
			}
		},
		onDrop: (e: React.DragEvent) => {
			e.preventDefault();
			applyFile(e.dataTransfer.files[0]);
		},
		generate: () => {
			setGenerating(true);
			setTimeout(() => {
				setGenerating(false);
				setDraft((d) => ({
					...d,
					image: AI_RESULTS[aiTurn++ % AI_RESULTS.length],
					imageSource: "ai",
				}));
			}, 1600);
		},
		removeImage: () => setDraft((d) => ({ ...d, image: null, imageSource: undefined })),
		fileInput: (
			<input
				ref={fileRef}
				type="file"
				accept="image/*"
				hidden
				onChange={(e) => applyFile(e.target.files?.[0])}
			/>
		),
	};
}
export type ItemDraft = ReturnType<typeof useItemDraft>;

// ─── form primitives ────────────────────────────────────────────────────────

export function Field({
	label,
	hint,
	children,
	className = "",
}: Readonly<{ label: string; hint?: string; children: ReactNode; className?: string }>) {
	return (
		<label className={`block space-y-1.5 ${className}`}>
			<span className="flex items-baseline justify-between text-xs font-medium text-muted-foreground">
				{label}
				{hint ? <span className="font-normal text-faint-foreground">{hint}</span> : null}
			</span>
			{children}
		</label>
	);
}

export const inputClass =
	"w-full rounded-lg border border-input-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-input-placeholder focus:border-input-border-focus";

export function PriceInput({
	value,
	onChange,
	className = "",
}: Readonly<{ value: string; onChange: (v: string) => void; className?: string }>) {
	return (
		<div
			className={`flex items-center rounded-lg border border-input-border bg-input focus-within:border-input-border-focus ${className}`}
		>
			<span className="pl-3 text-sm text-faint-foreground">$</span>
			<input
				inputMode="decimal"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="w-full min-w-0 bg-transparent px-2 py-2 text-right text-sm tabular-nums text-foreground outline-none"
			/>
			<span className="pr-3 text-xs text-faint-foreground">MXN</span>
		</div>
	);
}

export function StationPicker({
	value,
	onChange,
}: Readonly<{ value: Station; onChange: (s: Station) => void }>) {
	return (
		<div
			role="radiogroup"
			aria-label="Estación de preparación"
			className="inline-flex rounded-lg bg-tertiary/60 p-0.5"
		>
			{(["kitchen", "bar"] as const).map((s) => (
				<button
					key={s}
					type="button"
					role="radio"
					aria-checked={value === s}
					onClick={() => onChange(s)}
					className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
						value === s
							? "bg-card text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					<span className={`h-2 w-2 rounded-full ${STATION[s].dot}`} />
					{STATION[s].label}
				</button>
			))}
		</div>
	);
}

export function Toggle({
	checked,
	onChange,
	label,
}: Readonly<{ checked: boolean; onChange: (v: boolean) => void; label: string }>) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={() => onChange(!checked)}
			className="inline-flex items-center gap-2 text-xs text-muted-foreground"
		>
			<span
				className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-success" : "bg-tertiary"}`}
			>
				<span
					className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? "left-[18px]" : "left-0.5"}`}
				/>
			</span>
			{label}
		</button>
	);
}

/** Option groups as toggle chips — part of the same draft, saved with the rest. */
export function OptionGroupChips({
	value,
	onChange,
}: Readonly<{ value: string[]; onChange: (ids: string[]) => void }>) {
	return (
		<div className="flex flex-wrap gap-1.5">
			{OPTION_GROUPS.map((g) => {
				const on = value.includes(g.id);
				return (
					<button
						key={g.id}
						type="button"
						aria-pressed={on}
						onClick={() => onChange(on ? value.filter((x) => x !== g.id) : [...value, g.id])}
						className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ring-1 ${
							on
								? "bg-primary/15 text-foreground ring-primary/55"
								: "text-muted-foreground ring-border hover:text-foreground"
						}`}
					>
						{on ? <Check size={12} className="text-primary" /> : <Plus size={12} />}
						{g.name}
						<span className="text-faint-foreground">· {g.mode}</span>
					</button>
				);
			})}
			<button type="button" className="rounded-full px-2 py-1 text-xs text-primary hover:underline">
				Administrar grupos
			</button>
		</div>
	);
}

/**
 * The image as a single well: the picture itself, drop/paste target, and its
 * three actions — no separate panel, no floating "Eliminar" chip.
 */
export function ImageWell({
	d,
	className = "",
	compactActions = false,
	aspect = "aspect-square",
}: Readonly<{ d: ItemDraft; className?: string; compactActions?: boolean; aspect?: string }>) {
	const { draft, generating } = d;
	return (
		<div className={className}>
			{d.fileInput}
			<div
				tabIndex={0}
				onPaste={d.onPaste}
				onDragOver={(e) => e.preventDefault()}
				onDrop={d.onDrop}
				className={`group/well relative ${aspect} overflow-hidden rounded-xl bg-tertiary/40 outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-primary`}
			>
				{draft.image ? (
					<>
						<img src={draft.image} alt="" className="h-full w-full object-cover" />
						{draft.imageSource === "ai" ? <AIBadge className="absolute left-2 top-2" /> : null}
						{d.imageDirty ? (
							<span className="absolute right-2 top-2 rounded bg-warning px-1.5 text-[10px] font-semibold leading-4 text-inverse-foreground">
								Sin guardar
							</span>
						) : null}
						<button
							type="button"
							onClick={d.removeImage}
							aria-label="Quitar imagen"
							className="absolute bottom-2 right-2 rounded-lg bg-black/60 p-1.5 text-white opacity-0 backdrop-blur transition group-hover/well:opacity-100 focus-visible:opacity-100 hover:bg-destructive"
						>
							<Trash2 size={14} />
						</button>
					</>
				) : (
					<button
						type="button"
						onClick={d.pickFile}
						className="flex h-full w-full flex-col items-center justify-center gap-2 border-2 border-dashed border-border-strong text-center text-xs text-faint-foreground hover:text-muted-foreground"
						style={{ borderRadius: "inherit" }}
					>
						<ImagePlus size={22} />
						<span className="px-4">
							Suelta una foto aquí,
							<br />
							pégala o elige un archivo
						</span>
					</button>
				)}
				{generating ? (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/65 text-xs text-white backdrop-blur-sm">
						<Loader2 size={20} className="animate-spin" />
						Generando imagen…
					</div>
				) : null}
			</div>
			<div className={`mt-2 flex gap-1.5 ${compactActions ? "" : "flex-col"}`}>
				<button
					type="button"
					onClick={d.pickFile}
					className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground ring-1 ring-border hover:bg-hover hover:text-foreground"
				>
					<ImagePlus size={14} /> {draft.image ? "Cambiar foto" : "Subir foto"}
				</button>
				<button
					type="button"
					onClick={d.generate}
					disabled={generating}
					className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground ring-1 ring-border hover:bg-hover hover:text-foreground disabled:opacity-50"
				>
					<Sparkles size={14} className="text-primary" /> Generar con IA
				</button>
			</div>
		</div>
	);
}
