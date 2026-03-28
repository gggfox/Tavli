import type { Id } from "convex/_generated/dataModel";

export interface SelectedOption {
	optionGroupId: Id<"optionGroups">;
	optionGroupName: string;
	optionId: Id<"options">;
	optionName: string;
	priceModifier: number;
}
