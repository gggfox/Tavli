/**
 * Owns the single `restaurants.update` mutation behind the full-canvas
 * settings view, the way `useFloorPlan` owns the table mutations behind
 * `TablesManager`.
 *
 * Sections are saved independently, so the hook tracks *which* section is
 * in flight and which one failed -- a save in "Tax information" must not
 * put a spinner on the "General" button or blank out its error.
 *
 * `restaurants.update` takes every field as optional except
 * `organizationId`, so a section only sends its own fields and the current
 * organization rides along unchanged (the backend allows that for
 * non-admins; only an actual change is admin-gated).
 */
import type { RestaurantSettingsSection } from "@/features/restaurants/constants";
import { RestaurantsKeys } from "@/global/i18n";
import type { BackendErrorCode } from "@/global/i18n/keys/errors";
import { unwrapResult } from "@/global/utils";
import { extractErrorCode, extractErrorField, getErrorMessage } from "@/global/utils/errorMessages";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import type { FunctionArgs } from "convex/server";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

type RestaurantUpdateArgs = FunctionArgs<typeof api.restaurants.update>;

/** Any subset of `restaurants.update` args except the restaurant itself. */
export type RestaurantSettingsPatch = Partial<Omit<RestaurantUpdateArgs, "restaurantId">>;

export interface UseRestaurantSettingsSaveResult {
	/** Resolves `true` when the patch was persisted. */
	save: (section: RestaurantSettingsSection, patch: RestaurantSettingsPatch) => Promise<boolean>;
	savingSection: RestaurantSettingsSection | null;
	/** Localized failure message for the section that last failed, if any. */
	errorSection: RestaurantSettingsSection | null;
	error: string | null;
	/**
	 * Stable backend code behind `error`, when there was one. Sections use it to
	 * pin a failure to the field that caused it (a taken slug belongs on the slug
	 * input, not only on the footer).
	 */
	errorCode: BackendErrorCode | null;
	/**
	 * The input the failure belongs to, when the backend pinned one. Distinct
	 * from `errorCode`: the five social fields share their codes, so the code
	 * alone cannot identify the guilty input.
	 */
	errorField: string | null;
	/** Section that most recently saved successfully -- drives the "Saved" note. */
	savedSection: RestaurantSettingsSection | null;
	clearError: () => void;
}

export function useRestaurantSettingsSave(
	restaurant: Doc<"restaurants">
): UseRestaurantSettingsSaveResult {
	const { t } = useTranslation();
	const updateMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurants.update),
	});
	const [savingSection, setSavingSection] = useState<RestaurantSettingsSection | null>(null);
	const [errorSection, setErrorSection] = useState<RestaurantSettingsSection | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [errorCode, setErrorCode] = useState<BackendErrorCode | null>(null);
	const [errorField, setErrorField] = useState<string | null>(null);
	const [savedSection, setSavedSection] = useState<RestaurantSettingsSection | null>(null);

	const restaurantId = restaurant._id;
	const currentOrganizationId = restaurant.organizationId;
	const mutateAsync = updateMutation.mutateAsync;

	const clearError = useCallback(() => {
		setError(null);
		setErrorCode(null);
		setErrorField(null);
		setErrorSection(null);
	}, []);

	const save = useCallback(
		async (section: RestaurantSettingsSection, patch: RestaurantSettingsPatch) => {
			setSavingSection(section);
			setSavedSection(null);
			setError(null);
			setErrorCode(null);
			setErrorField(null);
			setErrorSection(null);
			try {
				unwrapResult(
					await mutateAsync({
						...patch,
						restaurantId,
						organizationId: patch.organizationId ?? currentOrganizationId,
					})
				);
				setSavedSection(section);
				return true;
			} catch (err) {
				setError(getErrorMessage(err, t, RestaurantsKeys.FORM_UPDATE_FAILED));
				setErrorCode(extractErrorCode(err));
				setErrorField(extractErrorField(err));
				setErrorSection(section);
				return false;
			} finally {
				setSavingSection(null);
			}
		},
		[mutateAsync, restaurantId, currentOrganizationId, t]
	);

	return {
		save,
		savingSection,
		errorSection,
		error,
		errorCode,
		errorField,
		savedSection,
		clearError,
	};
}
