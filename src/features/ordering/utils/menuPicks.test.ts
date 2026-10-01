/* eslint-disable boundaries/no-unknown-files, @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { isPickOfDish, picksByDish, picksFromDraftLines } from "./menuPicks";

const option = (optionId: string, optionGroupId = "optionGroups:salsa") =>
	({
		optionGroupId,
		optionGroupName: "Salsa",
		optionId,
		optionName: optionId,
		priceModifier: 100,
	}) as any;

const line = (menuItemId: string, quantity: number, options: any[] = []) =>
	({ menuItemId, quantity, unitPrice: 1000, selectedOptions: options }) as any;

describe("picksFromDraftLines", () => {
	it("keys a dish ordered one way by its id, with its options grouped", () => {
		const picks = picksFromDraftLines([
			line("menuItems:tacos", 2, [option("options:verde"), option("options:queso", "g:extra")]),
		]);

		expect([...picks.keys()]).toEqual(["menuItems:tacos"]);
		const pick = picks.get("menuItems:tacos")!;
		expect(pick.quantity).toBe(2);
		expect(pick.basePrice).toBe(1000);
		expect(pick.selectedOptions.get("optionGroups:salsa")).toHaveLength(1);
		expect(pick.selectedOptions.get("g:extra")).toHaveLength(1);
	});

	it("folds identical lines into one pick, whatever order their options came in", () => {
		const picks = picksFromDraftLines([
			line("menuItems:tacos", 1, [option("options:a"), option("options:b")]),
			line("menuItems:tacos", 2, [option("options:b"), option("options:a")]),
		]);

		expect(picks.size).toBe(1);
		expect(picks.get("menuItems:tacos")!.quantity).toBe(3);
	});

	it("keeps a dish ordered two different ways as two picks, the first under the dish id", () => {
		const picks = picksFromDraftLines([
			line("menuItems:tacos", 1, [option("options:verde")]),
			line("menuItems:tacos", 1, [option("options:roja")]),
			line("menuItems:tacos", 1, [option("options:roja")]),
		]);

		expect(picks.size).toBe(2);
		expect(
			picks.get("menuItems:tacos")!.selectedOptions.get("optionGroups:salsa")![0].optionId
		).toBe("options:verde");
		const [variantKey, variant] = [...picks.entries()][1];
		expect(isPickOfDish(variantKey, "menuItems:tacos")).toBe(true);
		expect(variant.menuItemId).toBe("menuItems:tacos");
		expect(variant.quantity).toBe(2);
	});

	it("skips removed lines", () => {
		const picks = picksFromDraftLines([
			{ ...line("menuItems:tacos", 1), cancelledAt: 1 },
			line("menuItems:soup", 1),
		]);

		expect([...picks.keys()]).toEqual(["menuItems:soup"]);
	});
});

describe("isPickOfDish", () => {
	it("does not confuse a dish whose id merely starts the same", () => {
		expect(isPickOfDish("menuItems:tacos2", "menuItems:tacos")).toBe(false);
		expect(isPickOfDish("menuItems:tacos#options:x", "menuItems:tacos")).toBe(true);
	});
});

describe("picksByDish", () => {
	it("reports one pick per dish with the quantity of every way it is ordered", () => {
		const picks = picksFromDraftLines([
			line("menuItems:tacos", 1, [option("options:verde")]),
			line("menuItems:tacos", 2, [option("options:roja")]),
			line("menuItems:soup", 1),
		]);

		const byDish = picksByDish(picks);

		expect(byDish.size).toBe(2);
		expect(byDish.get("menuItems:tacos")!.quantity).toBe(3);
		expect(byDish.get("menuItems:soup")!.quantity).toBe(1);
	});
});
