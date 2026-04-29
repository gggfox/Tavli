/**
 * Shared input styling for the Form/* primitives. Exported so callers
 * that need a one-off `<input>` (e.g. a search box, an inline form row
 * that doesn't fit the standard label-on-top layout) can reuse the
 * same look without rebuilding the constants by hand.
 */
import type { CSSProperties } from "react";

export const formInputClasses =
	"w-full rounded-md px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-(--btn-primary-bg) focus:border-transparent";

export const formInputStyle: CSSProperties = {
	backgroundColor: "var(--bg-secondary)",
	border: "1px solid var(--border-default)",
	color: "var(--text-primary)",
};
