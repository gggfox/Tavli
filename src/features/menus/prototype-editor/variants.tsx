/**
 * PROTOTYPE — throwaway. Question: the item editor (name/price/description +
 * image) looks messy once opened. Where should it open, and how should it be
 * laid out? Four structurally different answers; everything else is held
 * constant in shared.tsx (colour selection, section select, right index).
 *
 *  A  Inspector lateral     editor docks in the right column, replacing the index
 *  B  Tarjeta en línea      the row grows into a tidy two-column card, in place
 *  C  Diálogo con siguiente  a centred dialog that steps through the section
 *  D  Edición directa        no editor: the row IS the form, image in a popover
 */
import { Check, ChevronLeft, ChevronRight, Eye, EyeOff, Trash2, X } from "lucide-react";
import {
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
	type ComponentType,
	type ReactNode,
} from "react";
import { OPTION_GROUPS, useMenuStore, type MockItem } from "./mock";
import {
	EditorPage,
	Field,
	IconButton,
	ImageWell,
	OptionGroupChips,
	PriceInput,
	STATION,
	StationPicker,
	Thumb,
	Toggle,
	inputClass,
	isOwnClick,
	rowSurface,
	useItemDraft,
	usePage,
	type ItemDraft,
} from "./shared";

// ─── shared bits of the "form" variants (A, B, C) ───────────────────────────

function useSaveShortcut(d: ItemDraft, onDone: () => void) {
	const ref = useRef({ d, onDone });
	ref.current = { d, onDone };
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				ref.current.onDone();
			}
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				ref.current.d.save();
				ref.current.onDone();
			}
		};
		globalThis.addEventListener("keydown", onKey);
		return () => globalThis.removeEventListener("keydown", onKey);
	}, []);
}

function Fields({ d, wide = false }: Readonly<{ d: ItemDraft; wide?: boolean }>) {
	const { draft, set } = d;
	return (
		<div className="space-y-4">
			<div className={wide ? "grid grid-cols-[1fr_11rem] gap-3" : "space-y-4"}>
				<Field label="Nombre">
					<input
						autoFocus
						value={draft.name}
						onChange={(e) => set("name", e.target.value)}
						className={inputClass}
					/>
				</Field>
				<Field label="Precio">
					<PriceInput value={draft.price} onChange={(v) => set("price", v)} />
				</Field>
			</div>
			<Field label="Descripción" hint={`${draft.description.length}/200`}>
				<textarea
					rows={3}
					maxLength={200}
					value={draft.description}
					onChange={(e) => set("description", e.target.value)}
					placeholder="Lo que el comensal lee bajo el nombre del platillo"
					className={`${inputClass} resize-none leading-relaxed`}
				/>
			</Field>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="space-y-1.5">
					<span className="block text-xs font-medium text-muted-foreground">Se prepara en</span>
					<StationPicker value={draft.station} onChange={(v) => set("station", v)} />
				</div>
				<Toggle
					checked={draft.available}
					onChange={(v) => set("available", v)}
					label={draft.available ? "Visible en el menú" : "Oculto del menú"}
				/>
			</div>
			<div className="space-y-2 border-t border-border pt-4">
				<span className="block text-xs font-medium text-muted-foreground">
					Opciones que elige el comensal
				</span>
				<OptionGroupChips value={draft.optionGroupIds} onChange={(v) => set("optionGroupIds", v)} />
			</div>
		</div>
	);
}

/** Every footer button shares one height: 44px touch targets on phones, 36px from md up. */
const BTN =
	"inline-flex h-11 items-center justify-center gap-1 rounded-lg px-4 text-sm font-medium disabled:opacity-40 md:h-9";

/**
 * Phone: the primary action full-width on top, Cancelar | Guardar as an even
 * pair below. From md up: one row, shortcut hint on the left.
 */
function SaveButtons({
	d,
	onDone,
	extra,
}: Readonly<{ d: ItemDraft; onDone: () => void; extra?: ReactNode }>) {
	return (
		<div className="flex flex-col gap-2 md:flex-row md:items-center">
			<span className="mr-auto hidden text-[11px] text-faint-foreground md:block">
				{d.dirty ? (
					<span className="flex items-center gap-1.5 text-warning">
						<span className="h-1.5 w-1.5 rounded-full bg-warning" /> Sin guardar
					</span>
				) : (
					"Esc cierra · ⌘↵ guarda"
				)}
			</span>
			<div className="grid grid-cols-2 gap-2 md:flex">
				<button
					type="button"
					onClick={() => {
						d.reset();
						onDone();
					}}
					className={`${BTN} hover-btn-secondary`}
				>
					Cancelar
				</button>
				<button
					type="button"
					disabled={!d.dirty}
					onClick={() => {
						d.save();
						onDone();
					}}
					className={`${BTN} ${extra ? "hover-btn-secondary" : "hover-btn-primary"}`}
				>
					Guardar
				</button>
			</div>
			{extra ? <div className="order-first md:order-none">{extra}</div> : null}
		</div>
	);
}

// ─── A · Inspector lateral ──────────────────────────────────────────────────

function VariantA() {
	const [editingId, setEditingId] = useState<string | null>(null);
	const { items } = useMenuStore();
	const item = items.find((i) => i.id === editingId);
	return (
		<EditorPage
			editingId={editingId}
			onEdit={setEditingId}
			aside={
				item ? (
					<Inspector key={item.id} item={item} onClose={() => setEditingId(null)} />
				) : undefined
			}
		/>
	);
}

function Inspector({ item, onClose }: Readonly<{ item: MockItem; onClose: () => void }>) {
	const d = useItemDraft(item);
	const { categories } = useMenuStore();
	useSaveShortcut(d, onClose);
	return (
		<aside className="sticky top-24 flex max-h-[calc(100dvh-7.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-lg)]">
			<header className="flex items-center gap-2 border-b border-border px-4 py-3">
				<div className="min-w-0 flex-1">
					<p className="text-[11px] text-faint-foreground">
						{categories.find((c) => c.id === item.categoryId)?.name} · Editar producto
					</p>
					<h2 className="truncate text-sm font-semibold text-foreground">
						{d.draft.name || "Sin nombre"}
					</h2>
				</div>
				<IconButton label="Cerrar" onClick={onClose}>
					<X size={16} />
				</IconButton>
			</header>
			<div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
				<ImageWell d={d} compactActions aspect="aspect-[16/10]" />
				<Fields d={d} />
			</div>
			<footer className="border-t border-border bg-card px-4 py-3">
				<SaveButtons d={d} onDone={onClose} />
			</footer>
		</aside>
	);
}

// ─── B · Tarjeta en línea ───────────────────────────────────────────────────

function VariantB() {
	const [editingId, setEditingId] = useState<string | null>(null);
	const { items } = useMenuStore();
	return (
		<EditorPage
			editingId={editingId}
			onEdit={setEditingId}
			inlineEditor={(it) =>
				it.id === editingId ? (
					<InlineCard
						key={it.id}
						item={items.find((x) => x.id === it.id)!}
						onClose={() => setEditingId(null)}
					/>
				) : null
			}
		/>
	);
}

function InlineCard({ item, onClose }: Readonly<{ item: MockItem; onClose: () => void }>) {
	const d = useItemDraft(item);
	useSaveShortcut(d, onClose);
	return (
		<div className="@container rounded-b-lg border-x-2 border-b-2 border-primary/70 bg-card">
			<div className="grid gap-6 p-5 @2xl:grid-cols-[13rem_1fr]">
				<ImageWell d={d} className="max-w-52" />
				<Fields d={d} wide />
			</div>
			<footer className="border-t border-border px-5 py-3">
				<SaveButtons d={d} onDone={onClose} />
			</footer>
		</div>
	);
}

// ─── C · Diálogo con siguiente ──────────────────────────────────────────────

function VariantC() {
	const [editingId, setEditingId] = useState<string | null>(null);
	const { items } = useMenuStore();
	const item = items.find((i) => i.id === editingId);
	return (
		<EditorPage editingId={editingId} onEdit={setEditingId}>
			{item ? <EditDialog key={item.id} item={item} onGo={setEditingId} /> : null}
		</EditorPage>
	);
}

function EditDialog({
	item,
	onGo,
}: Readonly<{ item: MockItem; onGo: (id: string | null) => void }>) {
	const d = useItemDraft(item);
	const { categories } = useMenuStore();
	const { visibleItemsOf } = usePage();
	const siblings = visibleItemsOf(item.categoryId);
	const idx = siblings.findIndex((s) => s.id === item.id);
	const prev = siblings[idx - 1];
	const next = siblings[idx + 1];
	const close = () => onGo(null);
	useSaveShortcut(d, close);

	const go = (to: MockItem | undefined) => {
		if (!to) return;
		if (d.dirty && !confirm("Tienes cambios sin guardar. ¿Descartarlos?")) return;
		onGo(to.id);
	};

	return (
		// Phone: a full-screen sheet. md+: a centred dialog.
		<div className="fixed inset-0 z-40 flex md:items-center md:justify-center md:p-4">
			<button
				type="button"
				aria-label="Cerrar"
				onClick={close}
				className="absolute inset-0 hidden bg-black/60 backdrop-blur-[2px] md:block"
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={`Editar ${item.name}`}
				className="relative flex h-full w-full flex-col overflow-hidden bg-card md:h-auto md:max-h-[92dvh] md:max-w-3xl md:rounded-2xl md:border md:border-border md:shadow-[var(--shadow-lg)]"
			>
				<header className="flex items-center gap-1 border-b border-border py-2 pl-4 pr-2 md:py-3 md:pl-5 md:pr-3">
					<div className="min-w-0 flex-1">
						<p className="truncate text-[11px] text-faint-foreground md:hidden">
							{categories.find((c) => c.id === item.categoryId)?.name} · {idx + 1} de{" "}
							{siblings.length}
						</p>
						<p className="truncate text-sm">
							<span className="hidden text-faint-foreground md:inline">
								{categories.find((c) => c.id === item.categoryId)?.name} ·{" "}
							</span>
							<span className="font-semibold text-foreground">{d.draft.name || "Sin nombre"}</span>
						</p>
					</div>
					<span className="mr-1 hidden text-xs tabular-nums text-faint-foreground md:inline">
						{idx + 1} de {siblings.length}
					</span>
					<IconButton label="Producto anterior" onClick={() => go(prev)} className={HEADER_ICON}>
						<ChevronLeft size={20} className={prev ? "" : "opacity-30"} />
					</IconButton>
					<IconButton label="Producto siguiente" onClick={() => go(next)} className={HEADER_ICON}>
						<ChevronRight size={20} className={next ? "" : "opacity-30"} />
					</IconButton>
					<span className="mx-1 h-5 w-px bg-border" />
					<IconButton label="Cerrar" onClick={close} className={HEADER_ICON}>
						<X size={20} />
					</IconButton>
				</header>
				<div className="grid min-h-0 flex-1 content-start gap-6 overflow-y-auto p-4 md:grid-cols-[16rem_1fr] md:p-5">
					<ImageWell d={d} compactActions aspect="aspect-[16/10] md:aspect-square" />
					<Fields d={d} />
				</div>
				<footer className="border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-5">
					<SaveButtons
						d={d}
						onDone={close}
						extra={
							next ? (
								<button
									type="button"
									onClick={() => {
										d.save();
										onGo(next.id);
									}}
									className={`${BTN} w-full hover-btn-primary md:w-auto`}
								>
									Guardar y siguiente <ChevronRight size={16} />
								</button>
							) : undefined
						}
					/>
				</footer>
			</div>
		</div>
	);
}

/** 40px square on phones, 32px from md up — the three header icons match. */
const HEADER_ICON = "flex h-10 w-10 items-center justify-center md:h-8 md:w-8";

// ─── E · Elegida: A en escritorio, C debajo ─────────────────────────────────

const desktopQuery = "(min-width: 1024px)";
function useIsDesktop() {
	return useSyncExternalStore(
		(fn) => {
			const mq = globalThis.matchMedia(desktopQuery);
			mq.addEventListener("change", fn);
			return () => mq.removeEventListener("change", fn);
		},
		() => globalThis.matchMedia(desktopQuery).matches
	);
}

/**
 * The verdict: desktop (>= 1024px, where the right column exists) edits in
 * A's inspector; tablet and phone edit in C's dialog / full-screen sheet.
 * One editingId, so crossing the breakpoint keeps the same item open.
 */
function VariantE() {
	const [editingId, setEditingId] = useState<string | null>(null);
	const isDesktop = useIsDesktop();
	const { items } = useMenuStore();
	const item = items.find((i) => i.id === editingId);
	return (
		<EditorPage
			editingId={editingId}
			onEdit={setEditingId}
			aside={
				isDesktop && item ? (
					<Inspector key={item.id} item={item} onClose={() => setEditingId(null)} />
				) : undefined
			}
		>
			{!isDesktop && item ? <EditDialog key={item.id} item={item} onGo={setEditingId} /> : null}
		</EditorPage>
	);
}

// ─── D · Edición directa ────────────────────────────────────────────────────

function VariantD() {
	return (
		<EditorPage
			editingId={null}
			onEdit={() => {}}
			sectionHeader={
				<div className="grid grid-cols-[44px_1fr_8.5rem_6rem_auto] items-center gap-3 px-2.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-faint-foreground">
					<span />
					<span>Producto · descripción</span>
					<span className="text-right">Precio</span>
					<span>Estación</span>
					<span className="w-[4.5rem]" />
				</div>
			}
			renderRow={(item) => <DirectRow item={item} />}
		/>
	);
}

/** A text that is an input: looks like text until hovered/focused. Saves on blur/Enter. */
function CellInput({
	value,
	onCommit,
	className = "",
	placeholder,
	align = "left",
}: Readonly<{
	value: string;
	onCommit: (v: string) => void;
	className?: string;
	placeholder?: string;
	align?: "left" | "right";
}>) {
	const [v, setV] = useState(value);
	useEffect(() => setV(value), [value]);
	return (
		<input
			value={v}
			placeholder={placeholder}
			onChange={(e) => setV(e.target.value)}
			onBlur={() => v !== value && onCommit(v)}
			onKeyDown={(e) => {
				if (e.key === "Enter") e.currentTarget.blur();
				if (e.key === "Escape") {
					setV(value);
					requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
				}
			}}
			className={`w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 outline-none hover:border-border focus:border-input-border-focus focus:bg-input ${align === "right" ? "text-right tabular-nums" : ""} ${className}`}
		/>
	);
}

function DirectRow({ item }: Readonly<{ item: MockItem }>) {
	const store = useMenuStore();
	const { selected, toggle } = usePage();
	const isSelected = selected.has(item.id);
	const [saved, setSaved] = useState(false);
	const [imgOpen, setImgOpen] = useState(false);
	const [optsOpen, setOptsOpen] = useState(false);

	const commit = (patch: Partial<MockItem>) => {
		store.updateItem(item.id, patch);
		setSaved(true);
		setTimeout(() => setSaved(false), 1200);
	};

	return (
		<div
			role="checkbox"
			aria-checked={isSelected}
			aria-label={item.name}
			onClick={(e) => {
				if (isOwnClick(e)) toggle(item.id, e);
			}}
			className={`relative grid cursor-pointer grid-cols-[44px_1fr_8.5rem_6rem_auto] items-center gap-3 rounded-lg px-2.5 py-1.5 transition-colors ${rowSurface(isSelected, false)}`}
		>
			<button
				type="button"
				onClick={() => setImgOpen((o) => !o)}
				aria-label="Imagen del producto"
				className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary"
			>
				<Thumb item={item} />
			</button>
			<div className="min-w-0">
				<div className="flex items-center gap-1">
					<CellInput
						value={item.name}
						onCommit={(v) => commit({ name: v.trim() || item.name })}
						className={`text-sm font-medium ${item.available ? "text-foreground" : "text-faint-foreground line-through"}`}
					/>
					<div className="relative flex shrink-0 items-center gap-1" data-no-select>
						{item.optionGroupIds.map((g) => (
							<span
								key={g}
								className="rounded-full bg-tertiary px-1.5 py-px text-[11px] text-muted-foreground"
							>
								{OPTION_GROUPS.find((o) => o.id === g)?.name}
							</span>
						))}
						<button
							type="button"
							onClick={() => setOptsOpen((o) => !o)}
							className="rounded-full px-1.5 py-px text-[11px] text-faint-foreground ring-1 ring-border hover:text-foreground"
						>
							+ opciones
						</button>
						{optsOpen ? (
							<Popover onClose={() => setOptsOpen(false)} className="left-0 top-7 w-72">
								<p className="mb-2 text-xs font-medium text-muted-foreground">
									Opciones que elige el comensal
								</p>
								<OptionGroupChips
									value={item.optionGroupIds}
									onChange={(v) => commit({ optionGroupIds: v })}
								/>
							</Popover>
						) : null}
					</div>
				</div>
				<CellInput
					value={item.description}
					placeholder="Agregar descripción…"
					onCommit={(v) => commit({ description: v })}
					className="text-xs text-faint-foreground placeholder:text-faint-foreground/60"
				/>
			</div>
			<CellInput
				value={(item.price / 100).toFixed(2)}
				align="right"
				onCommit={(v) => {
					const c = Math.round(Number.parseFloat(v) * 100);
					if (!Number.isNaN(c)) commit({ price: c });
				}}
				className="text-sm text-muted-foreground"
			/>
			<button
				type="button"
				title="Cambiar estación"
				onClick={() => commit({ station: item.station === "kitchen" ? "bar" : "kitchen" })}
				className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${STATION[item.station].chip}`}
			>
				<span className={`h-1.5 w-1.5 rounded-full ${STATION[item.station].dot}`} />
				{STATION[item.station].label}
			</button>
			<div className="flex w-[4.5rem] items-center justify-end gap-0.5">
				{saved ? (
					<span className="flex items-center gap-1 text-[11px] text-success">
						<Check size={12} /> Guardado
					</span>
				) : (
					<>
						<IconButton
							label={item.available ? "Ocultar del menú" : "Mostrar en el menú"}
							onClick={() => commit({ available: !item.available })}
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
					</>
				)}
			</div>
			{imgOpen ? (
				<Popover onClose={() => setImgOpen(false)} className="left-1 top-14 w-72">
					<ImagePopover item={item} onDone={() => setImgOpen(false)} />
				</Popover>
			) : null}
		</div>
	);
}

function Popover({
	children,
	onClose,
	className = "",
}: Readonly<{ children: ReactNode; onClose: () => void; className?: string }>) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			if (!ref.current?.contains(e.target as Node)) onClose();
		};
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		setTimeout(() => document.addEventListener("mousedown", onDown));
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [onClose]);
	return (
		<div
			ref={ref}
			data-no-select
			className={`absolute z-30 cursor-default rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-lg)] ${className}`}
		>
			{children}
		</div>
	);
}

/** D's image editor: preview + the three actions; an image change needs one "Usar" click. */
function ImagePopover({ item, onDone }: Readonly<{ item: MockItem; onDone: () => void }>) {
	const d = useItemDraft(item);
	return (
		<div className="space-y-2">
			<ImageWell d={d} compactActions />
			{d.imageDirty ? (
				<div className="flex gap-1.5">
					<button
						type="button"
						onClick={d.reset}
						className="flex-1 rounded-lg py-1.5 text-xs hover-btn-secondary"
					>
						Descartar
					</button>
					<button
						type="button"
						onClick={() => {
							d.save();
							onDone();
						}}
						className="flex-1 rounded-lg py-1.5 text-xs font-medium hover-btn-primary"
					>
						Usar esta imagen
					</button>
				</div>
			) : null}
		</div>
	);
}

// ─── registry ───────────────────────────────────────────────────────────────

export const VARIANTS = {
	A: { name: "Inspector lateral", Component: VariantA },
	B: { name: "Tarjeta en línea", Component: VariantB },
	C: { name: "Diálogo con siguiente", Component: VariantC },
	D: { name: "Edición directa", Component: VariantD },
	E: { name: "Elegida: A escritorio · C tablet/teléfono", Component: VariantE },
} satisfies Record<string, { name: string; Component: ComponentType }>;

export type VariantKey = keyof typeof VARIANTS;
