export function buildInviterDisplayName(row: {
	firstName?: string;
	paternalLastname?: string;
	maternalLastname?: string;
	email?: string;
}): string | null {
	const parts = [row.firstName, row.paternalLastname, row.maternalLastname].filter(Boolean);
	if (parts.length > 0) return parts.join(" ");
	return row.email ?? null;
}
