/**
 * useOptimisticUserSetting — optimistic local copy of a server-backed
 * user setting.
 *
 * Captures the local-state-plus-server-sync dance previously inlined in
 * `OrderDashboard`:
 *   1. Render the local copy if we have one (so toggling feels instant).
 *   2. Otherwise fall back to the server value.
 *   3. Otherwise fall back to a hard-coded default.
 *   4. When the server value arrives or changes (from another tab,
 *      another device, etc.), sync it into the local copy.
 *
 * Persistence errors are intentionally swallowed — the point of the
 * optimistic copy is that the UI keeps working when persistence fails;
 * the user just won't see the value reflected on other devices. Hand a
 * custom `onPersistError` callback to surface it (toast, logger, etc.).
 */
import { useCallback, useEffect, useState } from "react";

export interface UseOptimisticUserSettingOptions<T> {
	/** Latest value from the server. `null` = not loaded yet. */
	readonly serverValue: T | null;
	/** Persists a value to the server. Errors are caught and forwarded. */
	readonly persist: (next: T) => Promise<unknown>;
	/** Used while the server value is `null` and no local override exists. */
	readonly fallback: T;
	/** Optional error reporter for persistence failures. */
	readonly onPersistError?: (error: unknown) => void;
}

export function useOptimisticUserSetting<T>({
	serverValue,
	persist,
	fallback,
	onPersistError,
}: UseOptimisticUserSettingOptions<T>): readonly [T, (next: T) => void] {
	const [localValue, setLocalValue] = useState<T | null>(null);

	useEffect(() => {
		if (serverValue !== null) {
			setLocalValue(serverValue);
		}
	}, [serverValue]);

	const value: T = localValue ?? serverValue ?? fallback;

	const update = useCallback(
		(next: T) => {
			setLocalValue(next);
			persist(next).catch((error: unknown) => {
				onPersistError?.(error);
			});
		},
		[persist, onPersistError]
	);

	return [value, update] as const;
}
