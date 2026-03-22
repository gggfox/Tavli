/**
 * Seed data for reference tables.
 * Run this once during initial setup to populate categories, forms, finishes, and choices.
 */
import { Doc } from "convex/_generated/dataModel";
import { mutation, MutationCtx } from "../_generated/server";

// ============================================================================
// Category Data
// ============================================================================
type Category = {
	name: string;
	groupTitle: string;
	icon: string;
};
type Form = {
	name: string;
	icon: string;
};
type Finish = {
	name: string;
};
type Choice = {
	name: string;
};
const CATEGORIES: Category[] = [
	// Aluminum group
	{ name: "Aluminum_Flat", groupTitle: "Aluminum", icon: "Package" },

	// Stainless Steel group
	{ name: "Stainless_Long", groupTitle: "Stainless_Steel", icon: "Layers" },
	{ name: "Stainless_Tubes_And_Pipes", groupTitle: "Stainless_Steel", icon: "Grid3x3" },
	{ name: "Stainless_Flat", groupTitle: "Stainless_Steel", icon: "Layers" },

	// Carbon Steel Long group
	{ name: "Rebars", groupTitle: "Carbon_Steel_Long", icon: "GripVertical" },
	{ name: "Wire_Rods", groupTitle: "Carbon_Steel_Long", icon: "BarChart3" },
	{ name: "Heavy_Sections", groupTitle: "Carbon_Steel_Long", icon: "GripVertical" },
	{ name: "Bars", groupTitle: "Carbon_Steel_Long", icon: "BarChart3" },

	// Carbon Steel Tubes & Pipes group
	{ name: "Welded_Tubes", groupTitle: "Carbon_Steel_Tubes_And_Pipes", icon: "Cylinder" },
	{ name: "Seamless_Tubes", groupTitle: "Carbon_Steel_Tubes_And_Pipes", icon: "Circle" },

	// Alloy Steel group
	{ name: "Alloy_Steel_Long", groupTitle: "Alloy_Steel", icon: "Zap" },

	// Special Steel group
	{ name: "Special_Steel_Flat", groupTitle: "Special_Steel", icon: "Star" },
	{ name: "Special_Steel_Long", groupTitle: "Special_Steel", icon: "Award" },

	// Semi-finished group
	{ name: "Slabs", groupTitle: "Semi-finished", icon: "Layers" },
	{ name: "Billets_Blooms_And_Ingots", groupTitle: "Semi-finished", icon: "Box" },

	// Carbon Steel Flat group
	{ name: "Hot_Rolled", groupTitle: "Carbon_Steel_Flat", icon: "Layers" },
	{ name: "Cold_Rolled", groupTitle: "Carbon_Steel_Flat", icon: "Layers" },
	{ name: "Organic_Coated", groupTitle: "Carbon_Steel_Flat", icon: "Layers" },
] as const;

// ============================================================================
// Form Data
// ============================================================================
const FORMS: Form[] = [
	{ name: "Round Billets", icon: "Circle" },
	{ name: "Ingots", icon: "Box" },
	{ name: "Coils", icon: "Layers" },
	{ name: "Slit Coils", icon: "Layers" },
	{ name: "Sheets", icon: "Layers" },
	{ name: "Plates", icon: "Layers" },
	{ name: "Heavy Plates", icon: "Layers" },
	{ name: "Flat Bars", icon: "BarChart3" },
	{ name: "Hexagonal Bars", icon: "Hexagon" },
	{ name: "Round Bars", icon: "Circle" },
	{ name: "Square Bars", icon: "Square" },
	{ name: "Equal Angles", icon: "CornerDownRight" },
	{ name: "Unequal Angles", icon: "CornerDownRight" },
	{ name: "Round Tubes", icon: "Cylinder" },
	{ name: "Square Tubes", icon: "Square" },
	{ name: "Rectangular Tubes", icon: "RectangleHorizontal" },
] as const;

// ============================================================================
// Finish Data
// ============================================================================
const FINISHES: Finish[] = [
	{ name: "Hot Rolled" },
	{ name: "Pickled and Oiled" },
	{ name: "Cold Rolled" },
	{ name: "Galvanized" },
	{ name: "Annealed" },
	{ name: "Normalized" },
] as const;

// ============================================================================
// Choice Data
// ============================================================================
const CHOICES: Choice[] = [
	{ name: "1st" },
	{ name: "2nd" },
	{ name: "3rd" },
	{ name: "4th" },
	{ name: "Prime" },
] as const;

// ============================================================================
// Seed Mutation
// ============================================================================

/**
 * Helper function to seed a reference table with data.
 * Checks for existing records by name and only inserts new ones.
 */

type TableName = "categories" | "forms" | "finishes" | "choices";
interface SeedTableOptions<T> {
	ctx: MutationCtx;
	tableName: TableName;
	items: readonly T[];
	getName: (item: T) => string;
	getInsertData: (item: T) => Omit<Doc<TableName>, "_id" | "_creationTime">;
	results: { inserted: number; skipped: number };
}
async function seedTable<T>({
	ctx,
	tableName,
	items,
	getName,
	getInsertData,
	results,
}: SeedTableOptions<T>): Promise<void> {
	for (const item of items) {
		const name = getName(item);
		// TypeScript can't infer the query builder type for union table names
		const existing = await ctx.db
			.query(tableName)
			.withIndex("by_name", (q) => q.eq("name", name))
			.first();

		if (existing) {
			results.skipped++;
		} else {
			await ctx.db.insert(tableName, getInsertData(item));
			results.inserted++;
		}
	}
}

/**
 * Seed all reference tables with initial data.
 * This mutation is idempotent - it checks for existing data before inserting.
 */
export const seedReferenceData = mutation({
	handler: async (ctx) => {
		const now = Date.now();
		const results = {
			categories: { inserted: 0, skipped: 0 },
			forms: { inserted: 0, skipped: 0 },
			finishes: { inserted: 0, skipped: 0 },
			choices: { inserted: 0, skipped: 0 },
		};

		// Seed categories
		await seedTable({
			ctx,
			tableName: "categories",
			items: CATEGORIES,
			getName: (category) => category.name,
			getInsertData: (item: Category) => ({
				name: item.name,
				groupTitle: item.groupTitle,
				icon: item.icon,
				createdAt: now,
			}),
			results: results.categories,
		});

		// Seed forms
		await seedTable({
			ctx,
			tableName: "forms",
			items: FORMS,
			getName: (form: Form) => form.name,
			getInsertData: (form: Form) => ({ name: form.name, icon: form.icon, createdAt: now }),
			results: results.forms,
		});
		// Seed finishes
		await seedTable({
			ctx,
			tableName: "finishes",
			items: FINISHES,
			getName: (finish) => finish.name,
			getInsertData: (finish: Finish) => ({ name: finish.name, createdAt: now }),
			results: results.finishes,
		});
		// Seed choices
		await seedTable({
			ctx,
			tableName: "choices",
			items: CHOICES,
			getName: (choice: Choice) => choice.name,
			getInsertData: (choice: Choice) => ({ name: choice.name, createdAt: now }),
			results: results.choices,
		});

		return results;
	},
});

/**
 * Clear all reference data (for testing purposes only).
 * WARNING: This will delete all categories, forms, finishes, and choices.
 */
export const clearReferenceData = mutation({
	handler: async (ctx) => {
		const tables = ["categories", "forms", "finishes", "choices"] as const;
		const results: Record<string, number> = {};

		for (const tableName of tables) {
			const records = await ctx.db.query(tableName).collect();
			for (const record of records) {
				await ctx.db.delete(record._id);
			}
			results[tableName] = records.length;
		}

		return results;
	},
});
