/**
 * Menu reads for the WhatsApp bot tools.
 *
 * `internalGetMenuForBot` returns a compact, locale-resolved snapshot of the
 * restaurant's *publicly visible* menu (available items on active menus) with
 * image URLs already resolved — the shape the `lookup_menu` and `get_dish_photo`
 * tools hand to the model. Kept deliberately small to bound prompt tokens.
 *
 * This intentionally does NOT reuse `menus.internalListMenuSnapshotForExport`
 * (which requires manager auth and carries staff-only fields) — the bot acts for
 * an anonymous customer.
 */
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { TABLE } from "../constants";
import { MAX_MENU_FIELD_PROMPT_CHARS, sanitizePromptValue } from "./promptSafety";

export type BotMenuItem = {
	id: string;
	category: string;
	name: string;
	description: string;
	priceFormatted: string;
	priceCents: number;
	available: boolean;
	imageUrl: string | null;
};

export type BotMenu = {
	currency: string;
	items: BotMenuItem[];
};

function localized(
	base: string | undefined,
	translations: Record<string, { name?: string; description?: string }> | undefined,
	locale: string | undefined,
	field: "name" | "description"
): string {
	if (locale && translations?.[locale]?.[field]) return translations[locale][field] as string;
	return base ?? "";
}

export const internalGetMenuForBot = internalQuery({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		locale: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<BotMenu> => {
		const restaurant = await ctx.db.get(args.restaurantId);
		const currency = restaurant?.currency ?? "";

		const menus = await ctx.db
			.query(TABLE.MENUS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		const items: BotMenuItem[] = [];
		for (const menu of menus) {
			if (!menu.isActive) continue;
			const categories = await ctx.db
				.query(TABLE.MENU_CATEGORIES)
				.withIndex("by_menu", (q) => q.eq("menuId", menu._id))
				.collect();
			for (const cat of categories) {
				const catItems = await ctx.db
					.query(TABLE.MENU_ITEMS)
					.withIndex("by_category", (q) => q.eq("categoryId", cat._id))
					.collect();
				for (const it of catItems) {
					if (!it.isAvailable) continue;
					items.push({
						id: it._id as string,
						category: localized(cat.name, cat.translations, args.locale, "name"),
						name: localized(it.name, it.translations, args.locale, "name"),
						description: localized(it.description, it.translations, args.locale, "description"),
						priceFormatted: `${(it.basePrice / 100).toFixed(2)} ${currency}`.trim(),
						priceCents: it.basePrice,
						available: it.isAvailable,
						imageUrl: it.imageStorageId ? await ctx.storage.getUrl(it.imageStorageId) : null,
					});
				}
			}
		}

		return { currency, items };
	},
});

/**
 * Best-effort match of a free-text dish name to a menu item. Accent- and
 * case-insensitive; prefers an exact name, then a containment match either
 * direction ("pastor" ↔ "Tacos al pastor").
 */
export function matchDishByName(items: BotMenuItem[], dishName: string): BotMenuItem | undefined {
	// Strip combining diacritics (U+0300–U+036F) by code point rather than a
	// regex character-class, which keeps the source ASCII and avoids eslint's
	// no-misleading-character-class rule.
	const stripAccents = (s: string) =>
		s
			.split("")
			.filter((c) => {
				const code = c.charCodeAt(0);
				return code < 0x300 || code > 0x36f;
			})
			.join("");
	const norm = (s: string) => stripAccents(s.toLowerCase().normalize("NFD")).trim();
	const target = norm(dishName);
	if (!target) return undefined;

	const exact = items.find((i) => norm(i.name) === target);
	if (exact) return exact;

	return items.find((i) => {
		const n = norm(i.name);
		return n.includes(target) || target.includes(n);
	});
}

/** What `lookup_menu` hands back to the model. */
export type MenuToolResult = {
	currency: string;
	items: { category: string; name: string; description: string; price: string }[];
	/** Items matching the query (or the whole menu), before the cap. */
	totalMatching: number;
	/** True when `items` is only part of `totalMatching`. */
	truncated: boolean;
};

/**
 * Shape a menu for the model: optional free-text narrowing, a hard cap to bound
 * prompt tokens, and sanitization of every field.
 *
 * `truncated` and `totalMatching` are the point. The cap used to drop the tail
 * silently, so on a menu larger than the cap the model could neither see the
 * rest nor know it was missing — it told a customer "I have no more information
 * about the menu" while most of the menu sat behind the cut.
 */
export function buildMenuToolResult(
	menu: BotMenu,
	query: string | undefined,
	limit: number
): MenuToolResult {
	let items = menu.items;
	if (query) {
		const q = query.toLowerCase();
		const filtered = items.filter(
			(i) =>
				i.name.toLowerCase().includes(q) ||
				i.description.toLowerCase().includes(q) ||
				i.category.toLowerCase().includes(q)
		);
		// An unmatched query falls back to the full menu rather than an empty
		// answer: the model's search term is a guess, the menu is the fact.
		if (filtered.length > 0) items = filtered;
	}

	const totalMatching = items.length;
	return {
		currency: menu.currency,
		// Menu text originates from an LLM parsing an uploaded PDF
		// (`menuImport.ts`), so it is untrusted content that reaches every
		// customer of this restaurant. Flatten it before it enters context.
		items: items.slice(0, limit).map((i) => ({
			category: sanitizePromptValue(i.category, MAX_MENU_FIELD_PROMPT_CHARS),
			name: sanitizePromptValue(i.name, MAX_MENU_FIELD_PROMPT_CHARS),
			description: sanitizePromptValue(i.description, MAX_MENU_FIELD_PROMPT_CHARS),
			price: i.priceFormatted,
		})),
		totalMatching,
		truncated: totalMatching > limit,
	};
}
