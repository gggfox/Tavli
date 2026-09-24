/**
 * PROTOTYPE — throwaway. The redesigned *insides* of every settings section.
 *
 * Shared by all variants on purpose (grilling Q11): the variants disagree
 * about navigation, not about what a section looks like. The inner pattern
 * is "settings rows": label + one-line hint on the left, control on the
 * right, stacking to label-over-control when the *container* is narrow
 * (container queries, so a section in a 2-pane layout stacks even on desktop).
 */
import {
	Check,
	ChevronRight,
	Crosshair,
	Download,
	Eye,
	ExternalLink,
	Minus,
	Plus,
	RefreshCw,
	Upload,
	X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
	RESET_OPTIONS,
	SECTIONS,
	useProtoStore,
	type MockRestaurant,
	type SectionId,
} from "./mock";

// ─── primitives ─────────────────────────────────────────────────────────────

const inputBase =
	"rounded-lg border border-input-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-input-placeholder focus:outline-none focus:border-input-border-focus";
const inputClass = `${inputBase} w-full`;

export function Row({
	label,
	hint,
	children,
	htmlFor,
}: Readonly<{ label: string; hint?: string; children: ReactNode; htmlFor?: string }>) {
	return (
		<div className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 border-b border-border last:border-b-0 @xl:grid @xl:grid-cols-[13rem_minmax(0,1fr)] @xl:gap-8">
			<div className="min-w-0">
				<label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
					{label}
				</label>
				{hint ? <p className="mt-0.5 text-xs leading-snug text-faint-foreground">{hint}</p> : null}
			</div>
			<div className="min-w-0">{children}</div>
		</div>
	);
}

export function Switch({
	checked,
	onChange,
	label,
}: Readonly<{ checked: boolean; onChange: (v: boolean) => void; label: string }>) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			onClick={() => onChange(!checked)}
			className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
				checked ? "bg-success" : "bg-tertiary"
			}`}
		>
			<span
				className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
					checked ? "translate-x-5" : "translate-x-0.5"
				}`}
			/>
		</button>
	);
}

function Segmented<T extends string>({
	value,
	options,
	onChange,
}: Readonly<{ value: T; options: ReadonlyArray<readonly [T, string]>; onChange: (v: T) => void }>) {
	return (
		<div className="inline-flex w-full max-w-md rounded-lg border border-border bg-muted p-0.5">
			{options.map(([v, label]) => (
				<button
					key={v}
					type="button"
					onClick={() => onChange(v)}
					className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
						v === value
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					{label}
				</button>
			))}
		</div>
	);
}

function Chip({
	children,
	tone = "neutral",
}: Readonly<{ children: ReactNode; tone?: "neutral" | "success" | "warning" }>) {
	const tones = {
		neutral: "bg-neutral-subtle text-muted-foreground",
		success: "bg-success-subtle text-success",
		warning: "bg-warning-subtle text-warning",
	};
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
		>
			{children}
		</span>
	);
}

export function ActionButton({
	children,
	onClick,
	variant = "secondary",
	disabled,
}: Readonly<{
	children: ReactNode;
	onClick?: () => void;
	variant?: "primary" | "secondary" | "ghost";
	disabled?: boolean;
}>) {
	const variants = {
		primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
		secondary: "border border-border bg-background text-foreground hover:bg-hover",
		ghost: "text-muted-foreground hover:bg-hover hover:text-foreground",
	};
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]}`}
		>
			{children}
		</button>
	);
}

/**
 * Right panel on tablet/desktop, full screen on a phone. Used by variant D's
 * edit sheets, the location map and the branding preview.
 */
export function Sheet({
	open,
	onClose,
	title,
	children,
	wide,
}: Readonly<{
	open: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
	wide?: boolean;
}>) {
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		globalThis.addEventListener("keydown", onKey);
		return () => globalThis.removeEventListener("keydown", onKey);
	}, [open, onClose]);
	if (!open) return null;
	return (
		<div className="fixed inset-0 z-50 flex justify-end">
			<button
				type="button"
				aria-label="Cerrar"
				onClick={onClose}
				className="hidden md:block absolute inset-0 bg-black/50"
			/>
			<div
				className={`relative flex h-full w-full flex-col bg-background md:border-l md:border-border md:shadow-2xl ${
					wide ? "md:max-w-3xl" : "md:max-w-xl"
				}`}
			>
				<div className="flex items-center gap-2 border-b border-border px-4 py-3">
					<button
						type="button"
						onClick={onClose}
						aria-label="Cerrar"
						className="-ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-hover"
					>
						<X size={18} />
					</button>
					<h2 className="text-base font-semibold text-foreground truncate">{title}</h2>
				</div>
				<div className="@container min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
					{children}
				</div>
			</div>
		</div>
	);
}

// ─── per-section draft + save (grilling Q4: saves stay per section) ─────────

type Status = "idle" | "saving" | "saved";

function useDraft<K extends keyof MockRestaurant>(keys: readonly K[]) {
	const { restaurant, update } = useProtoStore();
	const pick = () =>
		Object.fromEntries(keys.map((k) => [k, restaurant[k]])) as Pick<MockRestaurant, K>;
	const [draft, setDraft] = useState(pick);
	const [status, setStatus] = useState<Status>("idle");
	const dirty = keys.some((k) => draft[k] !== restaurant[k]);
	const set = <P extends K>(key: P, value: MockRestaurant[P]) => {
		setDraft((d) => ({ ...d, [key]: value }));
		setStatus("idle");
	};
	const save = () => {
		setStatus("saving");
		setTimeout(() => {
			update(draft);
			setStatus("saved");
		}, 600);
	};
	const discard = () => setDraft(pick());
	return { draft, set, dirty, save, discard, status };
}

function SaveBar({
	dirty,
	status,
	onSave,
	onDiscard,
}: Readonly<{ dirty: boolean; status: Status; onSave: () => void; onDiscard: () => void }>) {
	if (!dirty && status !== "saved") return null;
	return (
		<div className="sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-end gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur @xl:-mx-6 @xl:px-6">
			{status === "saved" && !dirty ? (
				<span className="inline-flex items-center gap-1 text-sm text-success">
					<Check size={16} /> Guardado
				</span>
			) : (
				<>
					<span className="mr-auto text-xs text-faint-foreground">Cambios sin guardar</span>
					<ActionButton variant="ghost" onClick={onDiscard} disabled={status === "saving"}>
						Descartar
					</ActionButton>
					<ActionButton variant="primary" onClick={onSave} disabled={status === "saving"}>
						{status === "saving" ? "Guardando…" : "Guardar"}
					</ActionButton>
				</>
			)}
		</div>
	);
}

// ─── section bodies ─────────────────────────────────────────────────────────

function GeneralBody() {
	const d = useDraft(["name", "slug", "description"] as const);
	return (
		<>
			<Row label="Nombre" htmlFor="p-name">
				<input
					id="p-name"
					className={`${inputClass} max-w-md`}
					value={d.draft.name}
					onChange={(e) => d.set("name", e.target.value)}
				/>
			</Row>
			<Row label="Enlace público" hint="Cambiarlo rompe los QR impresos." htmlFor="p-slug">
				<div className="flex max-w-md items-stretch overflow-hidden rounded-lg border border-input-border bg-input focus-within:border-input-border-focus">
					<span className="flex items-center border-r border-input-border bg-muted px-2.5 text-xs text-faint-foreground">
						tavliai.com/r/
					</span>
					<input
						id="p-slug"
						className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-sm text-foreground focus:outline-none"
						value={d.draft.slug}
						onChange={(e) => d.set("slug", e.target.value)}
					/>
				</div>
				<a
					className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
					href="#"
					onClick={(e) => e.preventDefault()}
				>
					<ExternalLink size={12} /> Abrir menú
				</a>
			</Row>
			<Row label="Descripción" hint="Se muestra bajo el nombre en tu menú." htmlFor="p-desc">
				<textarea
					id="p-desc"
					rows={3}
					className={inputClass}
					placeholder="Pizza al horno de leña desde 1998…"
					value={d.draft.description}
					onChange={(e) => d.set("description", e.target.value)}
				/>
			</Row>
			<SaveBar dirty={d.dirty} status={d.status} onSave={d.save} onDiscard={d.discard} />
		</>
	);
}

function FakeMap({
	radius,
	pin,
	onPick,
	tall,
}: Readonly<{
	radius: number;
	pin: { x: number; y: number };
	onPick?: (p: { x: number; y: number }) => void;
	tall?: boolean;
}>) {
	const r = Math.max(24, Math.min(140, radius / 2));
	return (
		<div
			onClick={(e) => {
				if (!onPick) return;
				const rect = e.currentTarget.getBoundingClientRect();
				onPick({
					x: ((e.clientX - rect.left) / rect.width) * 100,
					y: ((e.clientY - rect.top) / rect.height) * 100,
				});
			}}
			className={`relative w-full overflow-hidden rounded-lg border border-border ${tall ? "h-full min-h-[60vh]" : "h-40"} ${onPick ? "cursor-crosshair" : ""}`}
			style={{
				backgroundColor: "#1d2a24",
				backgroundImage:
					"linear-gradient(#2c3b33 1px, transparent 1px), linear-gradient(90deg, #2c3b33 1px, transparent 1px), linear-gradient(35deg, transparent 48%, #3a4a41 48%, #3a4a41 52%, transparent 52%)",
				backgroundSize: "28px 28px, 28px 28px, 100% 100%",
			}}
		>
			<div
				className="absolute rounded-full border-2 border-primary/80 bg-primary/15"
				style={{
					width: r * 2,
					height: r * 2,
					left: `calc(${pin.x}% - ${r}px)`,
					top: `calc(${pin.y}% - ${r}px)`,
				}}
			/>
			<div
				className="absolute -translate-x-1/2 -translate-y-full text-destructive"
				style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
			>
				<svg width="22" height="30" viewBox="0 0 22 30">
					<path
						d="M11 0C5 0 0 5 0 11c0 8 11 19 11 19s11-11 11-19C22 5 17 0 11 0z"
						fill="currentColor"
					/>
					<circle cx="11" cy="11" r="4" fill="white" />
				</svg>
			</div>
		</div>
	);
}

function LocationBody() {
	const d = useDraft(["latitude", "longitude", "radius", "bypassCode"] as const);
	const [mapOpen, setMapOpen] = useState(false);
	const [pin, setPin] = useState({ x: 50, y: 50 });
	return (
		<>
			<Row
				label="Ubicación"
				hint="Los comensales siempre ven el menú; para pedir en línea deben estar dentro del círculo."
			>
				<FakeMap radius={d.draft.radius} pin={pin} />
				<div className="mt-2 flex flex-wrap items-center gap-2">
					<ActionButton onClick={() => setMapOpen(true)}>
						<Crosshair size={14} /> Ajustar pin
					</ActionButton>
					<span className="text-xs text-faint-foreground tabular-nums">
						{d.draft.latitude.toFixed(4)}, {d.draft.longitude.toFixed(4)}
					</span>
				</div>
			</Row>
			<Row label="Radio de pedidos" hint="En metros, alrededor del pin.">
				<div className="flex items-center gap-2">
					<button
						type="button"
						className="rounded-lg border border-border p-2 hover:bg-hover"
						onClick={() => d.set("radius", Math.max(25, d.draft.radius - 25))}
					>
						<Minus size={14} />
					</button>
					<input
						inputMode="numeric"
						className={`${inputBase} w-24 text-center tabular-nums`}
						value={d.draft.radius}
						onChange={(e) => d.set("radius", Number(e.target.value.replace(/\D/g, "")) || 0)}
					/>
					<button
						type="button"
						className="rounded-lg border border-border p-2 hover:bg-hover"
						onClick={() => d.set("radius", d.draft.radius + 25)}
					>
						<Plus size={14} />
					</button>
					<span className="text-sm text-muted-foreground">m</span>
				</div>
			</Row>
			<Row
				label="Código de acceso"
				hint="El personal lo comparte para que alguien fuera del radio pueda pedir."
				htmlFor="p-bypass"
			>
				<input
					id="p-bypass"
					className={`${inputClass} max-w-[12rem] font-mono uppercase tracking-wider`}
					value={d.draft.bypassCode}
					onChange={(e) => d.set("bypassCode", e.target.value.toUpperCase())}
				/>
			</Row>
			<SaveBar dirty={d.dirty} status={d.status} onSave={d.save} onDiscard={d.discard} />
			<Sheet open={mapOpen} onClose={() => setMapOpen(false)} title="Ajustar ubicación" wide>
				<div className="flex h-full flex-col gap-3">
					<div className="flex gap-2">
						<input className={inputClass} placeholder="Buscar dirección…" />
						<ActionButton>Buscar</ActionButton>
					</div>
					<p className="text-xs text-faint-foreground">Toca el mapa para mover el pin.</p>
					<div className="min-h-0 flex-1">
						<FakeMap
							tall
							radius={d.draft.radius}
							pin={pin}
							onPick={(p) => {
								setPin(p);
								d.set("latitude", 25.6714 + (50 - p.y) / 5000);
								d.set("longitude", -100.3094 + (p.x - 50) / 5000);
							}}
						/>
					</div>
					<div className="flex justify-end gap-2">
						<ActionButton onClick={() => setMapOpen(false)}>Listo</ActionButton>
					</div>
				</div>
			</Sheet>
		</>
	);
}

function HoursBody() {
	const d = useDraft([
		"timezone",
		"openTime",
		"closeTime",
		"orderDayStart",
		"orderNumberReset",
	] as const);
	return (
		<>
			<Row label="Zona horaria" htmlFor="p-tz">
				<select
					id="p-tz"
					className={`${inputClass} max-w-md`}
					value={d.draft.timezone}
					onChange={(e) => d.set("timezone", e.target.value)}
				>
					<option value="America/Mexico_City">Ciudad de México</option>
					<option value="America/Monterrey">Monterrey</option>
					<option value="America/Cancun">Cancún</option>
					<option value="America/Tijuana">Tijuana</option>
				</select>
			</Row>
			<Row
				label="Horario de operación"
				hint="Rango visible en la línea de tiempo de reservaciones."
			>
				<div className="flex items-center gap-2">
					<input
						type="time"
						aria-label="Apertura"
						className={`${inputBase} w-32 tabular-nums`}
						value={d.draft.openTime}
						onChange={(e) => d.set("openTime", e.target.value)}
					/>
					<span className="text-muted-foreground">–</span>
					<input
						type="time"
						aria-label="Cierre"
						className={`${inputBase} w-32 tabular-nums`}
						value={d.draft.closeTime}
						onChange={(e) => d.set("closeTime", e.target.value)}
					/>
				</div>
			</Row>
			<Row
				label="Inicio del día de pedidos"
				hint="Ventas después de medianoche cuentan para el día anterior hasta esta hora."
			>
				<input
					type="time"
					className={`${inputBase} w-32 tabular-nums`}
					value={d.draft.orderDayStart}
					onChange={(e) => d.set("orderDayStart", e.target.value)}
				/>
			</Row>
			<Row label="Reinicio de número de orden" hint="Cada cuánto el contador vuelve a 1.">
				<Segmented
					value={d.draft.orderNumberReset}
					options={RESET_OPTIONS}
					onChange={(v) => d.set("orderNumberReset", v)}
				/>
				<div className="mt-1.5">
					<Chip>Solo administradores</Chip>
				</div>
			</Row>
			<SaveBar dirty={d.dirty} status={d.status} onSave={d.save} onDiscard={d.discard} />
		</>
	);
}

function PublicProfileBody() {
	const d = useDraft([
		"contactEmail",
		"address",
		"phone",
		"phoneHasWhatsapp",
		"instagram",
		"facebook",
		"tiktok",
		"x",
		"youtube",
	] as const);
	const socials = [
		["instagram", "Instagram"],
		["facebook", "Facebook"],
		["tiktok", "TikTok"],
		["x", "X"],
		["youtube", "YouTube"],
	] as const;
	return (
		<>
			<Row
				label="Correo de contacto"
				hint="En tu menú y recibos. También recibe reportes y facturación."
				htmlFor="p-email"
			>
				<input
					id="p-email"
					type="email"
					className={`${inputClass} max-w-md`}
					placeholder="hola@turestaurante.mx"
					value={d.draft.contactEmail}
					onChange={(e) => d.set("contactEmail", e.target.value)}
				/>
			</Row>
			<Row label="Teléfono" hint="Con clave de país." htmlFor="p-phone">
				<input
					id="p-phone"
					type="tel"
					className={`${inputClass} max-w-xs`}
					value={d.draft.phone}
					onChange={(e) => d.set("phone", e.target.value)}
				/>
				<label className="mt-2 flex items-center gap-2 text-sm text-foreground">
					<Switch
						checked={d.draft.phoneHasWhatsapp}
						onChange={(v) => d.set("phoneHasWhatsapp", v)}
						label="Tiene WhatsApp"
					/>
					Mostrar botón de WhatsApp
				</label>
			</Row>
			<Row label="Dirección" hint="A dónde llegan los comensales (no la fiscal)." htmlFor="p-addr">
				<input
					id="p-addr"
					className={inputClass}
					value={d.draft.address}
					onChange={(e) => d.set("address", e.target.value)}
				/>
			</Row>
			<Row label="Redes sociales" hint="Tu usuario o el enlace completo.">
				<div className="grid gap-2 @md:grid-cols-2">
					{socials.map(([key, label]) => (
						<div
							key={key}
							className="flex items-stretch overflow-hidden rounded-lg border border-input-border bg-input focus-within:border-input-border-focus"
						>
							<span className="flex w-20 shrink-0 items-center border-r border-input-border bg-muted px-2 text-xs text-faint-foreground">
								{label}
							</span>
							<input
								aria-label={label}
								className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-sm text-foreground focus:outline-none"
								placeholder="@usuario"
								value={d.draft[key]}
								onChange={(e) => d.set(key, e.target.value)}
							/>
						</div>
					))}
				</div>
			</Row>
			<SaveBar dirty={d.dirty} status={d.status} onSave={d.save} onDiscard={d.discard} />
		</>
	);
}

function BrandPreview({
	color,
	font,
	hasLogo,
}: Readonly<{ color: string; font: string; hasLogo: boolean }>) {
	return (
		<div
			className="mx-auto w-full max-w-[18rem] overflow-hidden rounded-2xl border border-border bg-white text-neutral-900 shadow-lg"
			style={{ fontFamily: font === "Sistema" ? undefined : font }}
		>
			<div
				className="h-20"
				style={{ background: `linear-gradient(135deg, ${color}, ${color}99)` }}
			/>
			<div className="-mt-7 px-4">
				<div
					className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-neutral-100 text-lg font-bold"
					style={{ color }}
				>
					{hasLogo ? "PH" : "?"}
				</div>
				<p className="mt-2 text-base font-semibold">pizza hut</p>
				<p className="text-xs text-neutral-500">Pizzas · Monterrey</p>
			</div>
			<div className="flex gap-1.5 px-4 pt-3">
				{["Pizzas", "Bebidas", "Postres"].map((c, i) => (
					<span
						key={c}
						className="rounded-full px-2.5 py-1 text-[11px] font-medium"
						style={i === 0 ? { background: color, color: "white" } : { background: "#f1f1f1" }}
					>
						{c}
					</span>
				))}
			</div>
			<div className="m-4 rounded-xl border border-neutral-200 p-3">
				<p className="text-sm font-medium">Pepperoni grande</p>
				<p className="text-xs text-neutral-500">$245.00</p>
				<button
					type="button"
					className="mt-2 w-full rounded-lg py-2 text-sm font-medium text-white"
					style={{ background: color }}
				>
					Agregar al pedido
				</button>
			</div>
		</div>
	);
}

function UploadTile({
	label,
	filled,
	onToggle,
}: Readonly<{ label: string; filled: boolean; onToggle: () => void }>) {
	return (
		<div className="flex items-center gap-3">
			<div
				className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border ${filled ? "border-border bg-muted text-foreground" : "border-dashed border-border-strong text-faint-foreground"}`}
			>
				{filled ? <span className="text-xs font-semibold">{label}</span> : <Upload size={18} />}
			</div>
			<div className="flex flex-wrap gap-2">
				<ActionButton onClick={onToggle}>{filled ? "Reemplazar" : "Subir"}</ActionButton>
				{filled ? (
					<ActionButton variant="ghost" onClick={onToggle}>
						Quitar
					</ActionButton>
				) : null}
			</div>
		</div>
	);
}

function BrandingBody() {
	const d = useDraft(["brandColor", "font", "hasLogo", "hasHeader"] as const);
	const [previewOpen, setPreviewOpen] = useState(false);
	const preview = (
		<BrandPreview color={d.draft.brandColor} font={d.draft.font} hasLogo={d.draft.hasLogo} />
	);
	return (
		<>
			<div className="@3xl:grid @3xl:grid-cols-[minmax(0,1fr)_19rem] @3xl:gap-8">
				<div>
					<Row label="Color de marca" hint="Ajustamos el contraste por ti en modo claro y oscuro.">
						<div className="flex items-center gap-2">
							<input
								type="color"
								aria-label="Elegir color"
								value={d.draft.brandColor}
								onChange={(e) => d.set("brandColor", e.target.value)}
								className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-transparent"
							/>
							<input
								className={`${inputBase} w-32 font-mono`}
								value={d.draft.brandColor}
								onChange={(e) => d.set("brandColor", e.target.value)}
							/>
						</div>
					</Row>
					<Row label="Tipografía">
						<select
							className={`${inputClass} max-w-xs`}
							value={d.draft.font}
							onChange={(e) => d.set("font", e.target.value)}
						>
							{["Sistema", "Inter", "Playfair Display", "Poppins", "Lora"].map((f) => (
								<option key={f}>{f}</option>
							))}
						</select>
					</Row>
					<Row label="Logo" hint="Se escala, nunca se recorta.">
						<UploadTile
							label="PH"
							filled={d.draft.hasLogo}
							onToggle={() => d.set("hasLogo", !d.draft.hasLogo)}
						/>
					</Row>
					<Row label="Imagen de encabezado" hint="Creamos las versiones de tablet y teléfono.">
						<UploadTile
							label="IMG"
							filled={d.draft.hasHeader}
							onToggle={() => d.set("hasHeader", !d.draft.hasHeader)}
						/>
					</Row>
					<div className="pt-4 @3xl:hidden">
						<ActionButton onClick={() => setPreviewOpen(true)}>
							<Eye size={14} /> Vista previa
						</ActionButton>
					</div>
				</div>
				<aside className="hidden @3xl:block">
					<p className="mb-2 text-xs font-medium uppercase tracking-wide text-faint-foreground">
						Vista previa
					</p>
					<div className="sticky top-4">{preview}</div>
				</aside>
			</div>
			<SaveBar dirty={d.dirty} status={d.status} onSave={d.save} onDiscard={d.discard} />
			<Sheet open={previewOpen} onClose={() => setPreviewOpen(false)} title="Vista previa">
				<div className="py-4">{preview}</div>
			</Sheet>
		</>
	);
}

function OrdersBody() {
	const { restaurant, update } = useProtoStore();
	return (
		<Row
			label="Pedidos con pago en persona"
			hint="Apagado: la ronda espera en Pedidos hasta que el personal la marque pagada."
		>
			<label className="flex items-center gap-3 text-sm text-foreground">
				<Switch
					checked={restaurant.releaseCash}
					onChange={(v) => update({ releaseCash: v })}
					label="Mandar directo a cocina"
				/>
				{restaurant.releaseCash ? "Van directo a cocina" : "Esperan confirmación de pago"}
			</label>
			<p className="mt-1.5 text-[11px] text-faint-foreground">Se guarda al cambiarlo.</p>
		</Row>
	);
}

function FakeQr() {
	const cells = Array.from({ length: 121 }, (_, i) => ((i * 7919) % 13) % 3 === 0);
	return (
		<div className="grid h-24 w-24 shrink-0 grid-cols-11 gap-px rounded-md bg-white p-1.5">
			{cells.map((on, i) => (
				<span key={i} className={on ? "bg-neutral-900" : ""} />
			))}
		</div>
	);
}

function WhatsappBody() {
	const { restaurant, update } = useProtoStore();
	const active = restaurant.whatsapp === "active";
	return (
		<>
			<Row label="Asistente" hint="Contesta pedidos y reservaciones de los comensales.">
				<div className="flex items-center gap-3">
					<Switch
						checked={active}
						onChange={(v) => update({ whatsapp: v ? "active" : "paused" })}
						label="Asistente activo"
					/>
					<Chip tone={active ? "success" : "warning"}>{active ? "Activo" : "En pausa"}</Chip>
				</div>
				<div className="mt-1.5">
					<Chip>Solo administradores</Chip>
				</div>
			</Row>
			<Row label="QR de las mesas" hint="Imprímelo y ponlo en cada mesa.">
				<div className="flex items-center gap-4">
					<FakeQr />
					<div className="flex flex-col items-start gap-2">
						<ActionButton>
							<Download size={14} /> Descargar QR
						</ActionButton>
						<ActionButton variant="ghost">
							<RefreshCw size={14} /> Regenerar código
						</ActionButton>
					</div>
				</div>
			</Row>
		</>
	);
}

function TablesBody() {
	return (
		<Row label="Salón" hint="Mesas, secciones y QR se editan en su propio lienzo.">
			<div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
				<div>
					<p className="text-sm font-medium text-foreground">14 mesas · 3 secciones</p>
					<p className="text-xs text-faint-foreground">Terraza, Salón, Barra</p>
				</div>
				<ActionButton
					onClick={() => alert("Prototipo: aquí se abre el lienzo de mesas (?manage=<id>).")}
				>
					Administrar <ChevronRight size={14} />
				</ActionButton>
			</div>
		</Row>
	);
}

function TaxBody() {
	const d = useDraft(["rfc", "razonSocial", "fiscalAddress"] as const);
	return (
		<>
			<Row label="RFC" htmlFor="p-rfc">
				<input
					id="p-rfc"
					className={`${inputClass} max-w-xs font-mono uppercase`}
					value={d.draft.rfc}
					onChange={(e) => d.set("rfc", e.target.value.toUpperCase())}
				/>
			</Row>
			<Row label="Razón social" htmlFor="p-rs">
				<input
					id="p-rs"
					className={`${inputClass} max-w-md`}
					value={d.draft.razonSocial}
					onChange={(e) => d.set("razonSocial", e.target.value)}
				/>
			</Row>
			<Row label="Domicilio fiscal" htmlFor="p-fa">
				<textarea
					id="p-fa"
					rows={2}
					className={inputClass}
					value={d.draft.fiscalAddress}
					onChange={(e) => d.set("fiscalAddress", e.target.value)}
				/>
			</Row>
			<SaveBar dirty={d.dirty} status={d.status} onSave={d.save} onDiscard={d.discard} />
		</>
	);
}

function PaymentsBody() {
	const { restaurant, update } = useProtoStore();
	const ok = restaurant.stripe === "complete";
	return (
		<>
			<Row label="Cobros con Stripe" hint="Donde caen los pagos de tus comensales.">
				<div
					className={`rounded-lg border p-3 ${ok ? "border-border bg-background" : "border-warning/40 bg-warning-subtle"}`}
				>
					<div className="flex items-center gap-2">
						<Chip tone={ok ? "success" : "warning"}>{ok ? "Conectado" : "Falta información"}</Chip>
					</div>
					{ok ? null : (
						<p className="mt-2 text-xs text-foreground">
							Stripe necesita tu cuenta bancaria para enviarte depósitos.
						</p>
					)}
					<div className="mt-3 flex flex-wrap gap-2">
						{ok ? (
							<ActionButton>
								Abrir panel de Stripe <ExternalLink size={12} />
							</ActionButton>
						) : (
							<ActionButton variant="primary" onClick={() => update({ stripe: "complete" })}>
								Continuar en Stripe <ExternalLink size={12} />
							</ActionButton>
						)}
					</div>
				</div>
			</Row>
			<Row label="Suscripción a Tavli" hint="Distinta de los cobros a comensales.">
				<div className="flex flex-wrap items-center gap-3">
					<Chip tone={restaurant.billing === "active" ? "success" : "warning"}>
						{restaurant.billing === "active" ? "Activa" : "Pago vencido"}
					</Chip>
					<ActionButton>
						Administrar suscripción <ExternalLink size={12} />
					</ActionButton>
				</div>
			</Row>
		</>
	);
}

function ManagersBody() {
	const { restaurant, update } = useProtoStore();
	const candidates = ["María López", "Jorge Ruiz", "Sofía Garza"].filter(
		(n) => !restaurant.managers.includes(n)
	);
	const [pick, setPick] = useState("");
	return (
		<Row
			label="Gerentes"
			hint="Pueden editar menús, mesas, horarios y pedidos de este restaurante."
		>
			<ul className="divide-y divide-border rounded-lg border border-border">
				{restaurant.managers.map((m) => (
					<li key={m} className="flex items-center gap-3 px-3 py-2">
						<span className="flex h-7 w-7 items-center justify-center rounded-full bg-tertiary text-[11px] font-semibold text-foreground">
							{m
								.split(" ")
								.map((p) => p[0])
								.join("")}
						</span>
						<span className="flex-1 truncate text-sm text-foreground">{m}</span>
						<button
							type="button"
							className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-hover"
							onClick={() => update({ managers: restaurant.managers.filter((x) => x !== m) })}
						>
							Quitar
						</button>
					</li>
				))}
				{restaurant.managers.length === 0 ? (
					<li className="px-3 py-2 text-sm text-faint-foreground">Sin gerentes</li>
				) : null}
			</ul>
			<div className="mt-2 flex gap-2">
				<select
					className={`${inputClass} max-w-xs`}
					value={pick}
					onChange={(e) => setPick(e.target.value)}
				>
					<option value="">Agregar gerente…</option>
					{candidates.map((c) => (
						<option key={c}>{c}</option>
					))}
				</select>
				<ActionButton
					disabled={!pick}
					onClick={() => {
						update({ managers: [...restaurant.managers, pick] });
						setPick("");
					}}
				>
					Agregar
				</ActionButton>
			</div>
		</Row>
	);
}

function OrganizationBody() {
	const d = useDraft(["organization"] as const);
	return (
		<>
			<Row label="Organización dueña" hint="Solo administradores de la plataforma pueden moverlo.">
				<select
					className={`${inputClass} max-w-md`}
					value={d.draft.organization}
					onChange={(e) => d.set("organization", e.target.value)}
				>
					{["Grupo Vernáculo", "Pizza Hut México", "Demo"].map((o) => (
						<option key={o}>{o}</option>
					))}
				</select>
			</Row>
			<SaveBar dirty={d.dirty} status={d.status} onSave={d.save} onDiscard={d.discard} />
		</>
	);
}

const BODIES: Record<SectionId, () => ReactNode> = {
	general: GeneralBody,
	location: LocationBody,
	hours: HoursBody,
	publicProfile: PublicProfileBody,
	branding: BrandingBody,
	orders: OrdersBody,
	whatsapp: WhatsappBody,
	tables: TablesBody,
	tax: TaxBody,
	payments: PaymentsBody,
	managers: ManagersBody,
	organization: OrganizationBody,
};

/** Just the rows + save bar; the caller decides the chrome around it. */
export function SectionBody({ id }: Readonly<{ id: SectionId }>) {
	const Body = BODIES[id];
	return <Body />;
}

/** Section with its own card chrome and heading. */
export function SectionCard({
	id,
	headingLevel = "h3",
}: Readonly<{ id: SectionId; headingLevel?: "h2" | "h3" }>) {
	const meta = SECTIONS[id];
	const Heading = headingLevel;
	return (
		<section
			id={`section-${id}`}
			data-section={id}
			className="@container scroll-mt-32 lg:scroll-mt-20 rounded-xl border border-border bg-card px-4 pt-4 pb-4 @xl:px-6 @xl:pt-5"
		>
			<header className="mb-4">
				<Heading className="text-sm font-semibold text-foreground">{meta.title}</Heading>
				<p className="mt-0.5 text-xs text-faint-foreground">{meta.hint}</p>
			</header>
			<SectionBody id={id} />
		</section>
	);
}
