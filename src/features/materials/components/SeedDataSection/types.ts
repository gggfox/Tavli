export type SeedResults = {
	categories: { inserted: number; skipped: number };
	forms: { inserted: number; skipped: number };
	finishes: { inserted: number; skipped: number };
	choices: { inserted: number; skipped: number };
};

export type ClearResults = Record<string, number>;
