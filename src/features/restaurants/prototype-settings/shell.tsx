/**
 * PROTOTYPE — throwaway. Stand-in app shell (grilling Q1 = fix the shell in
 * this prototype, Q8/Q9 = its shape):
 *
 *  - phone (< md):    top bar + hamburger → sidebar as a slide-over drawer
 *  - tablet (md–lg):  collapsed 4rem icon rail; expanding overlays, never pushes
 *  - desktop (≥ lg):  the sidebar as it is today
 *
 * A static replica of the real Sidebar's content: the real one needs auth and
 * restaurant context, and the question here is the shell's shape, not its data.
 */
import {
	Bell,
	CalendarClock,
	ChevronLeft,
	ChevronRight,
	ClipboardList,
	Clock,
	DollarSign,
	Landmark,
	LayoutGrid,
	ListOrdered,
	Menu,
	MessageSquare,
	PanelLeft,
	Settings,
	Store,
	Users,
	X,
	type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Switch } from "./sections";
import { useProtoStore } from "./mock";

const NAV: ReadonlyArray<readonly [string, LucideIcon, boolean?]> = [
	["Tablero", LayoutGrid],
	["Restaurantes", Store, true],
	["Menús", ClipboardList],
	["Pedidos", ListOrdered],
	["Pagos", DollarSign],
	["Depósitos", Landmark],
	["Reservaciones", CalendarClock],
	["WhatsApp", MessageSquare],
	["Miembros", Users],
	["Administración", Settings],
];

function SidebarContent({
	collapsed,
	onClose,
}: Readonly<{ collapsed?: boolean; onClose?: () => void }>) {
	return (
		<div className="flex h-full flex-col">
			<div
				className={`flex h-14 items-center border-b border-border ${collapsed ? "justify-center" : "justify-between px-4"}`}
			>
				{collapsed ? (
					<span className="text-sm font-bold text-foreground">T</span>
				) : (
					<>
						<span className="text-sm font-semibold text-foreground">Tavli</span>
						<div className="flex items-center gap-1 text-muted-foreground">
							<Bell size={16} />
							{onClose ? (
								<button
									type="button"
									aria-label="Cerrar menú"
									onClick={onClose}
									className="ml-2 rounded-md p-1 hover:bg-hover"
								>
									<X size={18} />
								</button>
							) : (
								<PanelLeft size={16} className="ml-2" />
							)}
						</div>
					</>
				)}
			</div>
			{collapsed ? null : (
				<div className="border-b border-border px-4 py-3">
					<p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-faint-foreground">
						Restaurante activo
					</p>
					<select className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
						<option>vernaculo</option>
						<option>pizza hut</option>
					</select>
				</div>
			)}
			<nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
				{NAV.map(([label, Icon, active]) => (
					<a
						key={label}
						href="#"
						onClick={(e) => e.preventDefault()}
						title={collapsed ? label : undefined}
						className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${collapsed ? "justify-center px-0" : ""} ${
							active ? "bg-active text-foreground" : "text-muted-foreground hover:bg-hover"
						}`}
					>
						<Icon size={18} />
						{collapsed ? null : label}
					</a>
				))}
			</nav>
			{collapsed ? null : (
				<div className="space-y-3 border-t border-border p-3">
					<div className="flex items-center gap-2 text-sm">
						<Clock size={16} className="text-info" />
						<span className="flex-1 text-foreground">Reloj</span>
						<span className="rounded-md border border-border px-2 py-0.5 text-xs text-foreground">
							Entrada
						</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="flex h-8 w-8 items-center justify-center rounded-full bg-tertiary text-xs font-semibold text-foreground">
							GG
						</span>
						<div className="min-w-0">
							<p className="truncate text-sm text-foreground">Gerardo Galan</p>
							<p className="truncate text-xs text-faint-foreground">gerardo@…</p>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

export function ProtoShell({ children }: Readonly<{ children: ReactNode }>) {
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [railExpanded, setRailExpanded] = useState(false);

	useEffect(() => {
		if (!drawerOpen && !railExpanded) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setDrawerOpen(false);
				setRailExpanded(false);
			}
		};
		globalThis.addEventListener("keydown", onKey);
		return () => globalThis.removeEventListener("keydown", onKey);
	}, [drawerOpen, railExpanded]);

	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-background md:flex-row">
			{/* phone: top bar */}
			<header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-muted px-2 md:hidden">
				<button
					type="button"
					aria-label="Abrir menú"
					onClick={() => setDrawerOpen(true)}
					className="rounded-md p-2 text-foreground hover:bg-hover"
				>
					<Menu size={20} />
				</button>
				<span className="text-sm font-semibold text-foreground">Tavli</span>
				<span className="text-faint-foreground">/</span>
				<span className="truncate text-sm text-muted-foreground">vernaculo</span>
				<Bell size={18} className="ml-auto mr-2 text-muted-foreground" />
			</header>

			{/* phone: drawer */}
			{drawerOpen ? (
				<div className="fixed inset-0 z-40 md:hidden">
					<button
						type="button"
						aria-label="Cerrar menú"
						className="absolute inset-0 bg-black/60"
						onClick={() => setDrawerOpen(false)}
					/>
					<aside className="absolute inset-y-0 left-0 w-[85%] max-w-xs border-r border-border bg-muted shadow-2xl">
						<SidebarContent onClose={() => setDrawerOpen(false)} />
					</aside>
				</div>
			) : null}

			{/* tablet: rail (+ overlay when expanded) */}
			<aside className="relative hidden w-16 shrink-0 border-r border-border bg-muted md:block lg:hidden">
				<SidebarContent collapsed />
				<button
					type="button"
					aria-label="Expandir menú"
					onClick={() => setRailExpanded(true)}
					className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md p-2 text-muted-foreground hover:bg-hover"
				>
					<ChevronRight size={18} />
				</button>
			</aside>
			{railExpanded ? (
				<div className="fixed inset-0 z-40 hidden md:block lg:hidden">
					<button
						type="button"
						aria-label="Cerrar menú"
						className="absolute inset-0 bg-black/40"
						onClick={() => setRailExpanded(false)}
					/>
					<aside className="absolute inset-y-0 left-0 w-60 border-r border-border bg-muted shadow-2xl">
						<SidebarContent onClose={() => setRailExpanded(false)} />
					</aside>
				</div>
			) : null}

			{/* desktop: sidebar as today */}
			<aside className="hidden w-60 shrink-0 border-r border-border bg-muted lg:block">
				<SidebarContent />
			</aside>

			<main id="proto-scroll" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
				{children}
			</main>
		</div>
	);
}

/**
 * Settings page header: one back control (not chevron + X), and the
 * Active/Inactive toggle promoted out of General (grilling Q2). No currency.
 */
export function SettingsHeader({
	onBack,
	sticky = true,
}: Readonly<{ onBack?: () => void; sticky?: boolean }>) {
	const { restaurant, update } = useProtoStore();
	return (
		<div
			className={`${sticky ? "sticky top-0" : ""} z-20 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-3 backdrop-blur md:px-6`}
		>
			<button
				type="button"
				onClick={onBack ?? (() => alert("Prototipo: regresa a la lista de restaurantes."))}
				aria-label="Regresar"
				className="rounded-md p-1.5 text-muted-foreground hover:bg-hover"
			>
				<ChevronLeft size={20} />
			</button>
			<div className="min-w-0 flex-1">
				<p className="text-[11px] leading-none text-faint-foreground">Configuración</p>
				<h1 className="truncate text-lg font-semibold text-foreground">{restaurant.name}</h1>
			</div>
			<label className="flex shrink-0 items-center gap-2 rounded-full border border-border py-1 pl-3 pr-1">
				<span
					className={`text-xs font-medium ${restaurant.isActive ? "text-success" : "text-muted-foreground"}`}
				>
					{restaurant.isActive ? "Activo" : "Inactivo"}
				</span>
				<Switch
					checked={restaurant.isActive}
					label="Restaurante activo"
					onChange={(v) => {
						if (
							!v &&
							!confirm("¿Desactivar el restaurante? Los comensales no podrán pedir ni reservar.")
						)
							return;
						update({ isActive: v });
					}}
				/>
			</label>
		</div>
	);
}
