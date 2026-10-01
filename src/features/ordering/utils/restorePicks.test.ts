/* eslint-disable boundaries/no-unknown-files, @typescript-eslint/no-explicit-any */
import { MAX_ORDER_ITEM_QUANTITY } from "convex/constants";
import { describe, expect, it } from "vitest";
import { validateRestoredLines } from "./restorePicks";

const verde = {
	optionGroupId: "optionGroups:salsa",
	optionGroupName: "Salsa",
	optionId: "options:verde",
	optionName: "Verde",
	priceModifier: 150,
} as any;

const item = (id: string, extra: Record<string, unknown> = {}) =>
	[id, { _id: id, isAvailable: true, basePrice: 1000, ...extra }] as const;

const SALSA_GROUP = {
	_id: "optionGroups:salsa",
	name: "Salsa",
	translations: { es: { name: "Salsa (es)" } },
	options: [
		{
			_id: "options:verde",
			name: "Green",
			translations: { es: { name: "Verde" } },
			isAvailable: true,
			priceModifier: 200,
		},
		{ _id: "options:roja", name: "Red", isAvailable: false, priceModifier: 0 },
	],
};

const line = (menuItemId: string, quantity = 1, selectedOptions: any[] = []) =>
	({ menuItemId, quantity, unitPrice: 900, selectedOptions }) as any;

function validate(lines: any[], items: (readonly [string, any])[], groups = new Map()) {
	return validateRestoredLines(lines, {
		items: new Map(items) as any,
		optionGroupsByItem: groups,
		dayOfWeek: 3,
		lang: "es",
	});
}

describe("validateRestoredLines", () => {
	it("keeps a dish still on the menu, refreshed from it", () => {
		const groups = new Map([["menuItems:tacos", [SALSA_GROUP]]]);
		const result = validate(
			[line("menuItems:tacos", 2, [verde])],
			[item("menuItems:tacos")],
			groups
		);

		expect(result.droppedSome).toBe(false);
		expect(result.lines).toEqual([
			{
				menuItemId: "menuItems:tacos",
				quantity: 2,
				// Today's price and option price, names in the current language.
				unitPrice: 1000,
				selectedOptions: [
					{
						optionGroupId: "optionGroups:salsa",
						optionGroupName: "Salsa (es)",
						optionId: "options:verde",
						optionName: "Verde",
						priceModifier: 200,
					},
				],
			},
		]);
	});

	it.each([
		["gone from the menu", []],
		["switched off", [item("menuItems:tacos", { isAvailable: false })]],
		["unpriced", [item("menuItems:tacos", { basePrice: 0 })]],
		["not on today's menu", [item("menuItems:tacos", { availableDays: [5, 6] })]],
	])("drops a dish that is %s, and says so", (_label, items) => {
		const result = validate(
			[line("menuItems:tacos"), line("menuItems:soup")],
			[...(items as any[]), item("menuItems:soup")]
		);

		expect(result.droppedSome).toBe(true);
		expect(result.lines.map((l) => l.menuItemId)).toEqual(["menuItems:soup"]);
	});

	it.each([
		["the option was deleted", { ...verde, optionId: "options:habanero" }],
		["the option is switched off", { ...verde, optionId: "options:roja" }],
		["the group is no longer on the dish", { ...verde, optionGroupId: "optionGroups:other" }],
	])("drops the whole line when %s", (_label, option) => {
		const groups = new Map([["menuItems:tacos", [SALSA_GROUP]]]);
		const result = validate(
			[line("menuItems:tacos", 1, [option])],
			[item("menuItems:tacos")],
			groups
		);

		expect(result).toEqual({ lines: [], droppedSome: true });
	});

	it("drops a line with options when the dish's options could not be read", () => {
		const result = validate([line("menuItems:tacos", 1, [verde])], [item("menuItems:tacos")]);

		expect(result).toEqual({ lines: [], droppedSome: true });
	});

	it("clamps the quantity to the per-line cap without calling it a removal", () => {
		const result = validate([line("menuItems:tacos", 500)], [item("menuItems:tacos")]);

		expect(result.droppedSome).toBe(false);
		expect(result.lines[0].quantity).toBe(MAX_ORDER_ITEM_QUANTITY);
	});

	it("drops a nonsensical quantity", () => {
		const result = validate(
			[line("menuItems:tacos", 0), line("menuItems:soup", Number.NaN)],
			[item("menuItems:tacos"), item("menuItems:soup")]
		);

		expect(result).toEqual({ lines: [], droppedSome: true });
	});
});
