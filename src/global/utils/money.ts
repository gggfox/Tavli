/** Formats an integer cents value as a dollar string (e.g. 1299 -> "12.99"). */
export function formatCents(cents: number): string {
	return (cents / 100).toFixed(2);
}

/** Parses a dollar string input to integer cents. Returns `NaN` if invalid. */
export function parseDollarsToCents(input: string): number {
	return Math.round(Number.parseFloat(input) * 100);
}
