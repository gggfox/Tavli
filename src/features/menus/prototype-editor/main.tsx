/**
 * PROTOTYPE — throwaway entry. Four variants of the menu editor's item
 * editor, switchable via `?variant=A|B|C|D`, framed at phone/tablet/desktop
 * via `?device=`. Mock data in memory; nothing saves. Standalone Vite SPA
 * (vite.proto-menu.config.ts) so it needs no Clerk, Convex or Infisical:
 * `pnpm proto:menu` → http://localhost:3101/?variant=A
 *
 * Branch: proto/menu-editor-redesign. Never merged to main.
 */
import { PrototypeSwitcher, type PrototypeDevice } from "@/global/components/PrototypeSwitcher";
import {
	Bell,
	CalendarClock,
	ChevronDown,
	ChevronRight,
	ClipboardList,
	DollarSign,
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
import {
	StrictMode,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
	type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { MenuStoreProvider } from "./mock";
import { VARIANTS, type VariantKey } from "./variants";
import "./proto.css";

// ─── URL state ──────────────────────────────────────────────────────────────

interface Search {
	variant: VariantKey;
	device?: PrototypeDevice;
	embed: boolean;
}

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
	listeners.add(fn);
	globalThis.addEventListener("popstate", fn);
	return () => {
		listeners.delete(fn);
		globalThis.removeEventListener("popstate", fn);
	};
};

function parse(href: string): Search {
	const p = new URL(href).searchParams;
	const v = p.get("variant");
	const d = p.get("device");
	return {
		variant: v && v in VARIANTS ? (v as VariantKey) : "A",
		device: d === "phone" || d === "tablet" || d === "desktop" ? d : undefined,
		embed: p.get("embed") === "1",
	};
}

function setSearch(patch: Partial<Search>) {
	const url = new URL(location.href);
	for (const [k, v] of Object.entries(patch)) {
		if (v === undefined || v === false) url.searchParams.delete(k);
		else url.searchParams.set(k, v === true ? "1" : String(v));
	}
	history.replaceState(null, "", url);
	listeners.forEach((fn) => fn());
}

// ─── shell (static replica of the real sidebar, Menús active) ───────────────

const NAV: ReadonlyArray<readonly [string, LucideIcon, boolean?]> = [
	["Tablero", LayoutGrid],
	["Restaurantes", Store],
	["Menús", ClipboardList, true],
	["Pedidos", ListOrdered],
	["Finanzas", DollarSign],
	["Reservaciones", CalendarClock],
	["WhatsApp", MessageSquare],
	["Miembros", Users],
	["Administración", Settings],
];

function Sidebar({ onClose }: Readonly<{ onClose?: () => void }>) {
	return (
		<div className="flex h-full flex-col">
			<div className="flex h-12 items-center justify-between border-b border-border px-4">
				<span className="text-sm font-semibold text-foreground">Tavli</span>
				<div className="flex items-center gap-2 text-muted-foreground">
					<Bell size={16} />
					{onClose ? (
						<button type="button" aria-label="Cerrar menú" onClick={onClose}>
							<X size={18} />
						</button>
					) : (
						<PanelLeft size={16} />
					)}
				</div>
			</div>
			<div className="space-y-3 border-b border-border px-3 py-3 text-[10px] uppercase tracking-wider text-faint-foreground">
				{[
					["Organización", "test"],
					["Restaurante activo", "vernaculo"],
				].map(([k, v]) => (
					<div key={k}>
						<p className="mb-1">{k}</p>
						<div className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1.5 text-xs normal-case tracking-normal text-foreground">
							{v} <ChevronDown size={14} />
						</div>
					</div>
				))}
			</div>
			<nav className="flex-1 space-y-0.5 p-2">
				{NAV.map(([label, Icon, active]) => (
					<div
						key={label}
						className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${active ? "bg-active text-foreground" : "text-muted-foreground"}`}
					>
						<Icon size={17} /> {label}
						{label === "Miembros" ? <ChevronRight size={14} className="ml-auto" /> : null}
					</div>
				))}
			</nav>
			<div className="border-t border-border px-4 py-3 text-sm text-foreground">Gerardo Galan</div>
		</div>
	);
}

function Shell({ children }: Readonly<{ children: ReactNode }>) {
	const [open, setOpen] = useState(false);
	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-background lg:flex-row">
			<header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-muted px-2 lg:hidden">
				<button
					type="button"
					aria-label="Abrir menú"
					onClick={() => setOpen(true)}
					className="rounded-md p-2"
				>
					<Menu size={20} />
				</button>
				<span className="text-sm font-semibold">Tavli</span>
				<span className="text-faint-foreground">/</span>
				<span className="text-sm text-muted-foreground">Menús</span>
			</header>
			{open ? (
				<div className="fixed inset-0 z-50 lg:hidden">
					<button
						type="button"
						aria-label="Cerrar"
						className="absolute inset-0 bg-black/60"
						onClick={() => setOpen(false)}
					/>
					<aside className="absolute inset-y-0 left-0 w-72 border-r border-border bg-muted">
						<Sidebar onClose={() => setOpen(false)} />
					</aside>
				</div>
			) : null}
			<aside className="hidden w-60 shrink-0 border-r border-border bg-muted lg:block">
				<Sidebar />
			</aside>
			<main id="proto-scroll" className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
				{children}
			</main>
		</div>
	);
}

// ─── page ───────────────────────────────────────────────────────────────────

const DEVICE_SIZE: Record<PrototypeDevice, readonly [number, number]> = {
	phone: [390, 844],
	tablet: [820, 1180],
	desktop: [1440, 900],
};

function PrototypePage() {
	const search = parse(useSyncExternalStore(subscribe, () => location.href));
	const { variant } = search;
	const switcher = (
		<PrototypeSwitcher
			variants={Object.entries(VARIANTS).map(([k, v]) => [k as VariantKey, v.name] as const)}
			current={variant}
			onVariant={(v) => setSearch({ variant: v })}
			device={search.device}
			onDevice={(d) => setSearch({ device: d })}
		/>
	);

	if (search.device && !search.embed) {
		return (
			<>
				<DeviceFrame device={search.device} variant={variant} />
				{switcher}
			</>
		);
	}

	const { Component } = VARIANTS[variant];
	return (
		<MenuStoreProvider>
			<Shell>
				<Component key={variant} />
			</Shell>
			{search.embed ? null : switcher}
		</MenuStoreProvider>
	);
}

function DeviceFrame({
	device,
	variant,
}: Readonly<{ device: PrototypeDevice; variant: VariantKey }>) {
	const [w, h] = DEVICE_SIZE[device];
	const box = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const fit = () => setScale(Math.min(1, (el.clientWidth - 32) / w, (el.clientHeight - 112) / h));
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(el);
		return () => ro.disconnect();
	}, [w, h]);
	return (
		<div
			ref={box}
			className="flex h-dvh items-center justify-center overflow-hidden bg-[#0b0b0c] pb-16"
		>
			<div style={{ width: w * scale, height: h * scale }}>
				<iframe
					key={`${device}-${variant}`}
					title={`Prototipo ${variant} — ${device}`}
					src={`${location.pathname}?variant=${variant}&embed=1`}
					width={w}
					height={h}
					style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
					className="rounded-xl border-0 bg-background ring-1 ring-white/15"
				/>
			</div>
		</div>
	);
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<PrototypePage />
	</StrictMode>
);
