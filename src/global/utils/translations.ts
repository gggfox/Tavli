interface Translatable {
	name: string;
	description?: string;
	translations?: Record<string, { name?: string; description?: string }>;
}

/**
 * Resolves a translated field from an entity, falling back to the default field value.
 * Works with any entity that has an optional `translations` record keyed by language code.
 */
export function getTranslatedField<T extends Translatable>(
	entity: T,
	lang: string | undefined,
	field: "name" | "description" = "name"
): string {
	if (lang) {
		const translated = entity.translations?.[lang]?.[field];
		if (translated) return translated;
	}
	return entity[field] ?? "";
}
