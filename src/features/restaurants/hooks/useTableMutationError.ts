import { mapTableError } from "@/features/restaurants/utils/mapTableError";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

export function useTableMutationError() {
	const { t } = useTranslation();
	const [error, setError] = useState<string | null>(null);

	const clearError = useCallback(() => setError(null), []);

	const setMutationError = useCallback(
		(err: unknown, fallbackKey: string) => {
			setError(mapTableError(err, t, fallbackKey));
		},
		[t]
	);

	return { error, clearError, setMutationError };
}
