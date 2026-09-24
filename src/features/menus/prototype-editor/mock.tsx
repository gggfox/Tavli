/**
 * PROTOTYPE — throwaway. Menu editor redesign exploration.
 *
 * In-memory mock of one menu (the "vernaculo" data from the client's
 * screenshots, padded out so the category index has something to index).
 * Nothing touches Convex: every edit updates this store only.
 * Branch proto/menu-editor-redesign, never merged to main.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Station = "kitchen" | "bar";

export interface MockItem {
	id: string;
	categoryId: string;
	name: string;
	description: string;
	/** cents */
	price: number;
	station: Station;
	available: boolean;
	image: string | null;
	imageSource?: "upload" | "ai";
	optionGroupIds: string[];
}

export interface MockCategory {
	id: string;
	name: string;
}

export interface MockOptionGroup {
	id: string;
	name: string;
	mode: "Único" | "Múltiple";
}

const photo = (id: string) => `https://images.unsplash.com/photo-${id}?w=640&h=640&fit=crop&q=70`;

/** Photos the fake "Generar con IA" hands back, in turn. */
export const AI_RESULTS = [
	photo("1504674900247-0877df9cc836"),
	photo("1512621776951-a57141f2eefd"),
	photo("1519708227418-c8fd9a32b7a2"),
];

const CATEGORIES: MockCategory[] = [
	{ id: "carnes", name: "Carnes" },
	{ id: "entradas", name: "Entradas" },
	{ id: "entress", name: "Entress" },
	{ id: "soups", name: "Soups" },
	{ id: "coktel", name: "Coktel" },
	{ id: "postres", name: "Postres" },
	{ id: "bebidas", name: "Bebidas" },
];

export const OPTION_GROUPS: MockOptionGroup[] = [
	{ id: "termino", name: "Termino", mode: "Único" },
	{ id: "guarnicion", name: "Guarnición", mode: "Múltiple" },
	{ id: "tamano", name: "Tamaño", mode: "Único" },
];

let seq = 0;
const it = (
	categoryId: string,
	name: string,
	price: number,
	extra: Partial<MockItem> = {}
): MockItem => ({
	id: `i${++seq}`,
	categoryId,
	name,
	description: "",
	price,
	station: "kitchen",
	available: true,
	image: null,
	optionGroupIds: [],
	...extra,
});

const ITEMS: MockItem[] = [
	it("carnes", "Rib eye", 100000, {
		description: "un delicioso corte de lomo de res",
		image: photo("1600891964092-4316c288032e"),
		imageSource: "upload",
	}),
	it("carnes", "Picaña", 80000, {
		image: photo("1544025162-d76694265947"),
		imageSource: "upload",
	}),
	it("carnes", "arracheras", 70000, {
		image: photo("1558030006-450675393462"),
		imageSource: "ai",
		optionGroupIds: ["termino"],
	}),
	it("entradas", "Sopa de almeja", 50000, {
		image: photo("1547592166-23ac45744acd"),
		imageSource: "ai",
	}),
	it("entradas", "cerveza", 12000, {
		image: photo("1608270586620-248524c67de9"),
		imageSource: "ai",
		station: "bar",
	}),
	it("entress", "Tostadas", 699),
	it("entress", "Shrimp", 0),
	it("entress", "Guacamole", 1450, { description: "Aguacate, cebolla, cilantro y totopos" }),
	it("entress", "Queso fundido", 1800, { optionGroupIds: ["guarnicion"] }),
	it("entress", "Nachos", 1600, {
		image: photo("1551504734-5ee1c4a1479b"),
		imageSource: "upload",
	}),
	it("entress", "Ceviche", 2200, { available: false }),
	it("entress", "Aguachile", 2400),
	it("entress", "Tacos de pescado", 1900, {
		image: photo("1565299585323-38d6b0865b47"),
		imageSource: "upload",
	}),
	it("entress", "Elote", 900),
	it("entress", "Chicharrón", 1100),
	it("entress", "Tostada de atún", 2100),
	it("soups", "Sopa de tortilla", 1500),
	it("soups", "Consomé", 1300),
	it("soups", "Crema de elote", 1400, { available: false }),
	it("coktel", "Margarita", 1800, {
		station: "bar",
		image: photo("1514362545857-3bc16c4c7d1b"),
		imageSource: "upload",
		optionGroupIds: ["tamano"],
	}),
	it("coktel", "Mojito", 1700, { station: "bar", image: photo("1551024709-8f23befc6f87") }),
	it("coktel", "Paloma", 1600, { station: "bar" }),
	it("coktel", "Michelada", 1400, { station: "bar" }),
	it("postres", "Flan", 900),
	it("postres", "Churros", 1100),
	it("postres", "Pastel de tres leches", 1300),
	it("bebidas", "Agua de horchata", 600, { station: "bar", optionGroupIds: ["tamano"] }),
	it("bebidas", "Jamaica", 600, { station: "bar" }),
	it("bebidas", "Café de olla", 700, { station: "bar" }),
	it("bebidas", "Refresco", 500, { station: "bar" }),
];

interface Store {
	categories: MockCategory[];
	items: MockItem[];
	itemsOf: (categoryId: string) => MockItem[];
	updateItem: (id: string, patch: Partial<MockItem>) => void;
	updateItems: (ids: Iterable<string>, patch: Partial<MockItem>) => void;
	removeItems: (ids: Iterable<string>) => void;
	removeCategory: (id: string) => void;
	addItem: (categoryId: string) => string;
}

const Ctx = createContext<Store | null>(null);

export function MenuStoreProvider({ children }: Readonly<{ children: ReactNode }>) {
	const [categories, setCategories] = useState(CATEGORIES);
	const [items, setItems] = useState(ITEMS);

	const store = useMemo<Store>(
		() => ({
			categories,
			items,
			itemsOf: (categoryId) => items.filter((i) => i.categoryId === categoryId),
			updateItem: (id, patch) =>
				setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i))),
			updateItems: (ids, patch) => {
				const set = new Set(ids);
				setItems((prev) => prev.map((i) => (set.has(i.id) ? { ...i, ...patch } : i)));
			},
			removeItems: (ids) => {
				const set = new Set(ids);
				setItems((prev) => prev.filter((i) => !set.has(i.id)));
			},
			removeCategory: (id) => {
				setCategories((prev) => prev.filter((c) => c.id !== id));
				setItems((prev) => prev.filter((i) => i.categoryId !== id));
			},
			addItem: (categoryId) => {
				const item = it(categoryId, "Nuevo producto", 0);
				setItems((prev) => [...prev, item]);
				return item.id;
			},
		}),
		[categories, items]
	);

	return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useMenuStore(): Store {
	const s = useContext(Ctx);
	if (!s) throw new Error("MenuStoreProvider missing");
	return s;
}

export const money = (cents: number) =>
	`$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
