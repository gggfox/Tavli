/**
 * Canonical KeyboardEvent.key values used across the app.
 *
 * Centralizes the string literals so callsites compare against a typed
 * constant instead of hand-typed strings (which are easy to typo and
 * impossible to grep cleanly across "Escape" vs " " vs "ArrowDown").
 */
export const KEY = {
	ArrowUp: "ArrowUp",
	ArrowDown: "ArrowDown",
	ArrowLeft: "ArrowLeft",
	ArrowRight: "ArrowRight",
	Home: "Home",
	End: "End",
	Enter: "Enter",
	Escape: "Escape",
	Tab: "Tab",
	Space: " ",
} as const;

export type KeyboardKey = (typeof KEY)[keyof typeof KEY];
