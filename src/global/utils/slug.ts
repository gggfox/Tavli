/** Sanitizes a string for use as a URL slug (lowercase alphanumeric + hyphens). */
export function sanitizeSlug(value: string): string {
	return value.toLowerCase().replaceAll(/[^a-z0-9-]/g, "-");
}
