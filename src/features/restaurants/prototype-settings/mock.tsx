/**
 * PROTOTYPE — throwaway. Restaurant settings layout exploration.
 *
 * In-memory mock of one restaurant plus the section/group map every variant
 * shares. Nothing here touches Convex: "Guardar" updates this store only.
 * Lives on branch proto/restaurant-settings-layout, never merged to main.
 */
import {
	Building2,
	Clock,
	CreditCard,
	FileText,
	Globe,
	LayoutGrid,
	MapPin,
	MessageCircle,
	Palette,
	ReceiptText,
	Store,
	Users,
	type LucideIcon,
} from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";

export interface MockRestaurant {
	name: string;
	slug: string;
	description: string;
	isActive: boolean;
	contactEmail: string;
	address: string;
	phone: string;
	phoneHasWhatsapp: boolean;
	instagram: string;
	facebook: string;
	tiktok: string;
	x: string;
	youtube: string;
	brandColor: string;
	font: string;
	hasLogo: boolean;
	hasHeader: boolean;
	timezone: string;
	openTime: string;
	closeTime: string;
	orderDayStart: string;
	orderNumberReset: "daily" | "weekly" | "biweekly" | "monthly";
	latitude: number;
	longitude: number;
	radius: number;
	bypassCode: string;
	releaseCash: boolean;
	whatsapp: "active" | "paused";
	rfc: string;
	razonSocial: string;
	fiscalAddress: string;
	stripe: "complete" | "actionNeeded";
	billing: "active" | "pastDue";
	managers: string[];
	organization: string;
}

export const INITIAL_RESTAURANT: MockRestaurant = {
	name: "pizza hut",
	slug: "pizza-hut",
	description: "",
	isActive: true,
	contactEmail: "",
	address: "Av. Constitución 1500, Centro, Monterrey, N.L.",
	phone: "+52 81 1234 5678",
	phoneHasWhatsapp: true,
	instagram: "pizzahutmx",
	facebook: "",
	tiktok: "",
	x: "",
	youtube: "",
	brandColor: "#e3342f",
	font: "Inter",
	hasLogo: true,
	hasHeader: false,
	timezone: "America/Monterrey",
	openTime: "13:00",
	closeTime: "23:00",
	orderDayStart: "04:00",
	orderNumberReset: "daily",
	latitude: 25.6714,
	longitude: -100.3094,
	radius: 150,
	bypassCode: "PIZZA24",
	releaseCash: false,
	whatsapp: "active",
	rfc: "PHM010101AB1",
	razonSocial: "Pizza Hut México S.A. de C.V.",
	fiscalAddress: "Av. Constitución 1500, Centro, 64000 Monterrey, N.L.",
	stripe: "actionNeeded",
	billing: "active",
	managers: ["Ana Torres", "Luis Méndez"],
	organization: "Grupo Vernáculo",
};

export type SectionId =
	| "general"
	| "location"
	| "hours"
	| "publicProfile"
	| "branding"
	| "orders"
	| "whatsapp"
	| "tables"
	| "tax"
	| "payments"
	| "managers"
	| "organization";

export type GroupId = "restaurant" | "publicPage" | "operations" | "business";

export interface SectionMeta {
	readonly id: SectionId;
	readonly title: string;
	readonly hint: string;
	readonly icon: LucideIcon;
	/** One-line current value, for index rows and summary cards. */
	readonly summary: (r: MockRestaurant) => string;
	/** Extra facts for variant D's summary cards. */
	readonly facts: (r: MockRestaurant) => ReadonlyArray<readonly [string, string]>;
}

const RESET_LABEL = {
	daily: "Diario",
	weekly: "Semanal",
	biweekly: "Quincenal",
	monthly: "Mensual",
} as const;

export const RESET_OPTIONS = Object.entries(RESET_LABEL) as ReadonlyArray<
	[MockRestaurant["orderNumberReset"], string]
>;

const orDash = (s: string) => (s.trim() ? s : "—");

export const SECTIONS: Record<SectionId, SectionMeta> = {
	general: {
		id: "general",
		title: "General",
		hint: "Nombre, enlace público y descripción.",
		icon: Store,
		summary: (r) => `${r.name} · /r/${r.slug}`,
		facts: (r) => [
			["Nombre", r.name],
			["Enlace", `/r/${r.slug}`],
			["Descripción", orDash(r.description)],
		],
	},
	location: {
		id: "location",
		title: "Ubicación y geocerca",
		hint: "Dónde está el restaurante y qué tan cerca debe estar un comensal para pedir en línea.",
		icon: MapPin,
		summary: (r) => `Radio ${r.radius} m · código ${r.bypassCode}`,
		facts: (r) => [
			["Radio", `${r.radius} m`],
			["Código de acceso", r.bypassCode],
		],
	},
	hours: {
		id: "hours",
		title: "Horario y zona horaria",
		hint: "Define reportes, turnos y el día de pedidos.",
		icon: Clock,
		summary: (r) => `${r.openTime}–${r.closeTime} · ${r.timezone.split("/")[1]}`,
		facts: (r) => [
			["Horario", `${r.openTime}–${r.closeTime}`],
			["Zona", r.timezone],
			["Reinicio de orden", RESET_LABEL[r.orderNumberReset]],
		],
	},
	publicProfile: {
		id: "publicProfile",
		title: "Perfil público",
		hint: "Cómo te contactan los comensales desde tu menú y recibos.",
		icon: Globe,
		summary: (r) =>
			[r.phone, r.contactEmail].filter(Boolean).join(" · ") || "Sin datos de contacto",
		facts: (r) => [
			["Teléfono", orDash(r.phone)],
			["Correo", orDash(r.contactEmail)],
			["Instagram", r.instagram ? `@${r.instagram}` : "—"],
		],
	},
	branding: {
		id: "branding",
		title: "Identidad",
		hint: "Color, tipografía, logo e imagen de encabezado de tus páginas.",
		icon: Palette,
		summary: (r) => `${r.brandColor} · ${r.font}`,
		facts: (r) => [
			["Color", r.brandColor],
			["Tipografía", r.font],
			["Logo", r.hasLogo ? "Subido" : "—"],
		],
	},
	orders: {
		id: "orders",
		title: "Pedidos",
		hint: "Cómo llega una ronda a la cocina.",
		icon: ReceiptText,
		summary: (r) =>
			r.releaseCash ? "Efectivo va directo a cocina" : "Efectivo espera confirmación",
		facts: (r) => [["Pago en persona", r.releaseCash ? "Directo a cocina" : "Espera al personal"]],
	},
	whatsapp: {
		id: "whatsapp",
		title: "Asistente de WhatsApp",
		hint: "Pedidos y reservaciones por WhatsApp con el QR de cada mesa.",
		icon: MessageCircle,
		summary: (r) => (r.whatsapp === "active" ? "Activo" : "En pausa"),
		facts: (r) => [["Estado", r.whatsapp === "active" ? "Activo" : "En pausa"]],
	},
	tables: {
		id: "tables",
		title: "Mesas y secciones",
		hint: "Plano del salón, mesas y sus QR.",
		icon: LayoutGrid,
		summary: () => "14 mesas en 3 secciones",
		facts: () => [
			["Mesas", "14"],
			["Secciones", "Terraza, Salón, Barra"],
		],
	},
	tax: {
		id: "tax",
		title: "Información fiscal",
		hint: "Aparece en los recibos por correo. Tavli no emite facturas.",
		icon: FileText,
		summary: (r) => orDash(r.rfc),
		facts: (r) => [
			["RFC", orDash(r.rfc)],
			["Razón social", orDash(r.razonSocial)],
		],
	},
	payments: {
		id: "payments",
		title: "Pagos y suscripción",
		hint: "Cuenta de Stripe para cobrar y la suscripción a Tavli.",
		icon: CreditCard,
		summary: (r) => (r.stripe === "complete" ? "Stripe conectado" : "Stripe: falta información"),
		facts: (r) => [
			["Stripe", r.stripe === "complete" ? "Conectado" : "Falta información"],
			["Suscripción", r.billing === "active" ? "Activa" : "Pago vencido"],
		],
	},
	managers: {
		id: "managers",
		title: "Gerentes",
		hint: "Quién administra este restaurante.",
		icon: Users,
		summary: (r) => (r.managers.length ? r.managers.join(", ") : "Sin gerentes"),
		facts: (r) => [["Gerentes", r.managers.length ? r.managers.join(", ") : "—"]],
	},
	organization: {
		id: "organization",
		title: "Organización",
		hint: "Qué organización es dueña del restaurante. Solo administradores.",
		icon: Building2,
		summary: (r) => r.organization,
		facts: (r) => [["Organización", r.organization]],
	},
};

export interface GroupMeta {
	readonly id: GroupId;
	readonly title: string;
	readonly sections: readonly SectionId[];
}

export const GROUPS: readonly GroupMeta[] = [
	{ id: "restaurant", title: "Restaurante", sections: ["general", "location", "hours"] },
	{ id: "publicPage", title: "Página pública", sections: ["publicProfile", "branding"] },
	{ id: "operations", title: "Operación", sections: ["orders", "whatsapp", "tables"] },
	{ id: "business", title: "Negocio", sections: ["tax", "payments", "managers", "organization"] },
];

export const ALL_SECTIONS: readonly SectionId[] = GROUPS.flatMap((g) => g.sections);

export function groupOf(section: SectionId): GroupMeta {
	return GROUPS.find((g) => g.sections.includes(section)) ?? GROUPS[0];
}

export function isSectionId(value: unknown): value is SectionId {
	return typeof value === "string" && (ALL_SECTIONS as readonly string[]).includes(value);
}

interface Store {
	readonly restaurant: MockRestaurant;
	readonly update: (patch: Partial<MockRestaurant>) => void;
}

const StoreContext = createContext<Store | null>(null);

export function ProtoStoreProvider({ children }: Readonly<{ children: ReactNode }>) {
	const [restaurant, setRestaurant] = useState(INITIAL_RESTAURANT);
	const update = (patch: Partial<MockRestaurant>) => setRestaurant((r) => ({ ...r, ...patch }));
	return <StoreContext.Provider value={{ restaurant, update }}>{children}</StoreContext.Provider>;
}

export function useProtoStore(): Store {
	const store = useContext(StoreContext);
	if (!store) throw new Error("useProtoStore outside ProtoStoreProvider");
	return store;
}

/** Section navigation, injected by the route so variants stay router-agnostic. */
export interface SectionNav {
	readonly section: SectionId | undefined;
	/** push = true adds a history entry (drill-in); false replaces (scrollspy). */
	readonly go: (section: SectionId | undefined, opts?: { replace?: boolean }) => void;
}
