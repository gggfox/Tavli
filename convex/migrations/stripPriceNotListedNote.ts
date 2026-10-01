import { mutation } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { NotAuthorizedError } from "../_shared/errors";
import { stripPriceNotListedNote } from "../_shared/menuPricing";
import { getCurrentUserId, isAdmin, RoleErrorMessages } from "../_util/auth";
import { TABLE } from "../constants";

/**
 * One-shot admin migration: remove the `"(price not listed)"` note that older
 * AI menu imports appended to item descriptions — in English, even on Spanish
 * menus, where diners read it next to a `$0.00` price.
 *
 * Unpriced items are now flagged in the menu editor and hidden from diners
 * (`hasListedPrice`), and the importer no longer writes the note, so this only
 * clears the historical rows. The price is left alone: a `0` still means "not
 * priced yet" and keeps the item flagged until a manager sets one. Items that
 * were priced by hand after import keep their price and lose only the note.
 *
 * Cleans the base `description` and every translation's `description`; an
 * item whose description was only the note ends up with none.
 *
 * Idempotent: rows without the note are skipped, so re-running is safe.
 *
 * Run with `npx convex run migrations/stripPriceNotListedNote:run` per env.
 */
export const run = mutation({
	args: {},
	handler: async (ctx) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return { ok: false as const, error: err };

		if (!(await isAdmin(ctx, userId))) {
			return {
				ok: false as const,
				error: new NotAuthorizedError(RoleErrorMessages.ADMIN_REQUIRED).toObject(),
			};
		}

		const items = await ctx.db.query(TABLE.MENU_ITEMS).collect();
		let patched = 0;
		for (const item of items) {
			const patch = cleanedFields(item);
			if (!patch) continue;
			await ctx.db.patch(item._id, { ...patch, updatedAt: Date.now(), updatedBy: userId });
			patched++;
		}

		return { ok: true as const, scanned: items.length, patched };
	},
});

/** The fields to patch, or `null` when the item carries no note. */
export function cleanedFields(
	item: Pick<Doc<"menuItems">, "description" | "translations">
): Pick<Doc<"menuItems">, "description" | "translations"> | null {
	let changed = false;

	const description = stripPriceNotListedNote(item.description);
	if (description !== item.description) changed = true;

	let translations = item.translations;
	if (translations) {
		const next: NonNullable<typeof translations> = {};
		for (const [locale, entry] of Object.entries(translations)) {
			const cleaned = stripPriceNotListedNote(entry.description);
			if (cleaned !== entry.description) changed = true;
			// Omit rather than set `undefined`: a nested `undefined` is not a
			// Convex value.
			const { description: _old, ...rest } = entry;
			next[locale] = cleaned === undefined ? rest : { ...rest, description: cleaned };
		}
		translations = next;
	}

	return changed ? { description, translations } : null;
}
