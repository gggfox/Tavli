import { fuzzyMatch } from "@/global/utils/fuzzyMatch";
import { useCallback, useMemo } from "react";

export function useFuzzyMatch(query: string) {
	const normalizedQuery = useMemo(() => query.trim().toLowerCase(), [query]);
	const isActive = normalizedQuery.length > 0;

	const matches = useCallback(
		(text: string) => {
			if (!isActive) return true;
			return fuzzyMatch(normalizedQuery, text);
		},
		[isActive, normalizedQuery]
	);

	return { normalizedQuery, isActive, matches };
}
