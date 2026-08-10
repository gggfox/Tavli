/**
 * Sidebar organization scope for platform admins, sitting one level above
 * `RestaurantSwitcher`: picking an organization narrows the restaurant list,
 * and every admin page keys its queries off the selected restaurant, so the
 * whole admin surface follows from that one filter.
 *
 * **All organizations** is the default and is exactly today's behavior (an
 * admin sees every restaurant); the narrowing only happens once an admin picks
 * an organization deliberately.
 *
 * Admin-only: owners effectively belong to a single organization today, so
 * there is nothing for them to switch between, and non-admins never see this.
 */
import { useCurrentUserRoles } from "@/features/users/hooks";
import { RestaurantsKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import type { Id } from "convex/_generated/dataModel";
import { USER_ROLES } from "convex/constants";
import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { useRestaurant } from "../RestaurantAdminScope";

/** The `<option>` value standing for "no organization filter". */
const ALL_ORGANIZATIONS_VALUE = "";

const FIELD_ID = "sidebar-organization-switcher";
const STATUS_ID = "sidebar-organization-switcher-status";

export function OrganizationSwitcher() {
	const { t } = useTranslation();
	const { roles, isLoading: rolesLoading } = useCurrentUserRoles();
	const {
		organizations,
		selectedOrganizationId,
		setSelectedOrganizationId,
		isOrganizationsLoading,
		organizationsError,
	} = useRestaurant();

	if (rolesLoading || !roles.includes(USER_ROLES.ADMIN)) return null;
	// Same "no flash while we don't know yet" rule the restaurant switcher uses.
	if (isOrganizationsLoading) return null;

	const hasError = Boolean(organizationsError);

	// One organization is not a choice — All and that organization show the same
	// restaurants — so the control is hidden, like the restaurant switcher. A
	// failed directory is the exception: it is shown, not swallowed.
	if (!hasError && organizations.length <= 1) return null;

	const onChange = (e: ChangeEvent<HTMLSelectElement>) => {
		const next = e.target.value;
		setSelectedOrganizationId(
			next === ALL_ORGANIZATIONS_VALUE ? null : (next as Id<"organizations">)
		);
	};

	const sorted = [...organizations].sort((a, b) => a.name.localeCompare(b.name));

	/*
	 * The provider keeps an active filter when the directory fails rather than
	 * silently re-widening the admin's scope, so the control has to keep showing
	 * that filter — with an option for it even though its name is unknown — and
	 * stay usable, or the admin would be locked into a narrowed restaurant list
	 * with no way out. It is only disabled when there is genuinely nothing to
	 * pick: no filter active and no directory to choose from.
	 */
	const filterIsUnlisted =
		selectedOrganizationId !== null && !sorted.some((org) => org._id === selectedOrganizationId);
	const options = filterIsUnlisted
		? [...sorted, { _id: selectedOrganizationId, name: t(RestaurantsKeys.ORG_SWITCHER_CURRENT) }]
		: sorted;
	const isDisabled = hasError && selectedOrganizationId === null;
	const status = hasError
		? getErrorMessage(
				organizationsError,
				t,
				selectedOrganizationId === null
					? RestaurantsKeys.ORG_SWITCHER_LOAD_FAILED
					: RestaurantsKeys.ORG_SWITCHER_LOAD_FAILED_FILTERED
			)
		: null;

	return (
		<div className="px-3 py-2 border-b border-border">
			<label
				htmlFor={FIELD_ID}
				className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1"
			>
				{t(RestaurantsKeys.ORG_SWITCHER_LABEL)}
			</label>
			<select
				id={FIELD_ID}
				value={selectedOrganizationId ?? ALL_ORGANIZATIONS_VALUE}
				onChange={onChange}
				disabled={isDisabled}
				aria-describedby={status ? STATUS_ID : undefined}
				className="w-full px-2 py-1.5 rounded-md text-xs bg-muted border border-border text-foreground disabled:opacity-60"
			>
				<option value={ALL_ORGANIZATIONS_VALUE}>{t(RestaurantsKeys.ORG_SWITCHER_ALL)}</option>
				{options.map((org) => (
					<option key={org._id} value={org._id}>
						{org.name}
					</option>
				))}
			</select>
			{status && (
				<p id={STATUS_ID} className="mt-1 text-[10px] text-destructive">
					{status}
				</p>
			)}
		</div>
	);
}
