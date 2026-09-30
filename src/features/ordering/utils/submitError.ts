import type { Id } from "convex/_generated/dataModel";
import { OrderingKeys } from "@/global/i18n";
import { extractErrorCode, extractErrorField, getErrorMessage } from "@/global/utils/errorMessages";
import type { TFunction } from "i18next";

/** What the order bar shows after a refused submit. */
export interface MenuSubmitError {
	message: string;
	/** The dish on the line the server refused, when it said which line. */
	menuItemId?: Id<"menuItems">;
}

/**
 * Line-level refusals from `orders.saveDraftFromMenu`, which arrive as
 * `"items.<index>: CODE"` (see `DRAFT_ORDER_ERRORS` in convex/orderHelpers.ts).
 */
const LINE_ERROR_CODES: ReadonlySet<string> = new Set([
	"ERROR_MENU_ITEM_UNAVAILABLE",
	"ERROR_MENU_ITEM_NOT_FOUND",
	"ERROR_MENU_ITEM_OPTION_NOT_FOUND",
	"ERROR_ORDER_ITEM_QUANTITY_INVALID",
]);

const LINE_FIELD = /^items\.(\d+)$/;

/**
 * Turns a refused menu submit into a translated message — never the raw
 * backend text; unknown failures, a dropped connection included, read as
 * "couldn't save your order, try again" — plus, when the server named the line
 * it refused, the dish on that line. The menu uses it to offer taking the dish
 * off: a dish staff switched off has already left the menu listing, so the
 * diner has no other way to reach it.
 */
export function describeMenuSubmitError(
	error: unknown,
	submittedItems: ReadonlyArray<{ menuItemId: Id<"menuItems"> }>,
	t: TFunction
): MenuSubmitError {
	const message = getErrorMessage(error, t, OrderingKeys.MENU_SUBMIT_FAILED);
	const code = extractErrorCode(error);
	const index = LINE_FIELD.exec(extractErrorField(error) ?? "")?.[1];
	const menuItemId =
		code !== null && LINE_ERROR_CODES.has(code) && index !== undefined
			? submittedItems[Number(index)]?.menuItemId
			: undefined;
	return menuItemId ? { message, menuItemId } : { message };
}
