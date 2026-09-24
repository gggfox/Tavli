import { GeneralSection } from "@/features/restaurants/components/settings/GeneralSection";
import { HoursSection } from "@/features/restaurants/components/settings/HoursSection";
import { LocationSection } from "@/features/restaurants/components/settings/LocationSection";
import { ManagersSection } from "@/features/restaurants/components/settings/ManagersSection";
import { OrdersSection } from "@/features/restaurants/components/settings/OrdersSection";
import { OrganizationSection } from "@/features/restaurants/components/settings/OrganizationSection";
import { PaymentsSection } from "@/features/restaurants/components/settings/PaymentsSection";
import { BrandingSection } from "@/features/restaurants/components/settings/BrandingSection";
import { PublicProfileSection } from "@/features/restaurants/components/settings/PublicProfileSection";
import {
	SettingsListDetailLayout,
	SettingsScrollLayout,
} from "@/features/restaurants/components/settings/SettingsLayouts";
import { visibleSettingsNav } from "@/features/restaurants/components/settings/settingsNav";
import { TablesLinkSection } from "@/features/restaurants/components/settings/TablesLinkSection";
import { TaxInfoSection } from "@/features/restaurants/components/settings/TaxInfoSection";
import { WhatsappAssistantSection } from "@/features/restaurants/components/settings/WhatsappAssistantSection";
import {
	RESTAURANT_SETTINGS_NAV,
	RESTAURANT_SETTINGS_SECTION,
	type RestaurantSettingsNavId,
	type RestaurantSettingsSection,
} from "@/features/restaurants/constants";
import {
	useRestaurantSettingsSave,
	type RestaurantSettingsPatch,
} from "@/features/restaurants/hooks/useRestaurantSettingsSave";
import { useCurrentUserRoles } from "@/features/users/hooks";
import { InlineError, StatusBadge } from "@/global/components";
import { useMediaQuery } from "@/global/hooks";
import { RestaurantsKeys } from "@/global/i18n";
import { useUser } from "@clerk/tanstack-react-start";
import type { Doc, Id } from "convex/_generated/dataModel";
import { USER_ROLES } from "convex/constants";
import { ChevronLeft } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface RestaurantSettingsViewProps {
	readonly restaurant: Doc<"restaurants">;
	/** Org admins/owners see every section; managers get the operational ones. */
	readonly settingsAccess: "full" | "manager";
	readonly onClose: () => void;
	readonly onToggleActive?: (restaurantId: Id<"restaurants">) => void;
	/** The `?section=` deep link. */
	readonly section?: RestaurantSettingsNavId;
	readonly onSectionChange?: (
		section: RestaurantSettingsNavId | undefined,
		opts?: { replace?: boolean }
	) => void;
	/** Opens this restaurant's tables canvas; omitted when the viewer can't manage tables. */
	readonly onManageTables?: () => void;
}

/**
 * Full-canvas restaurant settings, the `?settings=<id>` sibling of the
 * `?manage=<id>` tables canvas.
 *
 * Twelve sections in four groups (`settingsNav.ts`), laid out per the
 * settings prototype's verdict (branch proto/restaurant-settings-layout):
 * desktop gets every section on one scroll with a sticky index; tablet and
 * phone get a list of sections with their current values, beside the open
 * section on a tablet and drilled into on a phone. `?section=` names the
 * open/visible section in both, so crossing the breakpoint keeps your place.
 *
 * Sections save independently (see `useRestaurantSettingsSave`), so the save
 * affordance lives with the fields it applies to.
 */
export function RestaurantSettingsView({
	restaurant,
	settingsAccess,
	onClose,
	onToggleActive,
	section,
	onSectionChange,
	onManageTables,
}: Readonly<RestaurantSettingsViewProps>) {
	const isDesktop = useMediaQuery("(min-width: 1024px)");
	const { roles } = useCurrentUserRoles();
	const { user, isLoaded: clerkLoaded } = useUser();
	const isAdmin = roles.includes(USER_ROLES.ADMIN);
	const isFullAccess = settingsAccess === "full";

	const {
		save,
		savingSection,
		errorSection,
		error,
		errorCode,
		errorField,
		savedSection,
		clearError,
	} = useRestaurantSettingsSave(restaurant);
	const [sideEffectError, setSideEffectError] = useState<string | null>(null);
	// Without a route wiring `?section=`, the view keeps the section itself.
	const [localSection, setLocalSection] = useState<RestaurantSettingsNavId | undefined>();

	const groups = visibleSettingsNav({
		isFullAccess,
		isAdmin,
		// Mirrors `PaymentsSection`: until Clerk resolves we can't rule the owner
		// out, and the section holds its own placeholder meanwhile.
		canActOnStripe: isAdmin || !clerkLoaded || user?.id === restaurant.ownerId,
		canManageTables: onManageTables !== undefined,
	});
	const visibleIds = new Set(groups.flatMap((g) => g.entries.map((e) => e.id)));
	const requested = onSectionChange ? section : localSection;
	// A link to a section this viewer can't see falls back to the default view.
	const currentSection = requested && visibleIds.has(requested) ? requested : undefined;
	const changeSection = onSectionChange ?? ((next) => setLocalSection(next));

	const sectionProps = (key: RestaurantSettingsSection) => ({
		restaurant,
		onSave: (patch: RestaurantSettingsPatch) => save(key, patch),
		isSaving: savingSection === key,
		isSaved: savedSection === key,
		error: errorSection === key ? error : null,
		errorCode: errorSection === key ? errorCode : null,
		errorField: errorSection === key ? errorField : null,
		onDismissError: clearError,
	});

	const N = RESTAURANT_SETTINGS_NAV;
	const S = RESTAURANT_SETTINGS_SECTION;
	const renderSection = (id: RestaurantSettingsNavId): ReactNode => {
		switch (id) {
			case N.GENERAL:
				return <GeneralSection {...sectionProps(S.GENERAL)} />;
			case N.LOCATION:
				return <LocationSection {...sectionProps(S.LOCATION)} />;
			case N.HOURS:
				return (
					<HoursSection
						{...sectionProps(S.HOURS)}
						canEditOrderNumberReset={isAdmin && isFullAccess}
					/>
				);
			case N.PUBLIC_PROFILE:
				// Manager-visible: a restaurant's own public face is theirs to edit.
				return <PublicProfileSection {...sectionProps(S.PUBLIC_PROFILE)} />;
			case N.BRANDING:
				return <BrandingSection {...sectionProps(S.BRANDING)} />;
			case N.ORDERS:
				// Manager-visible: whether the kitchen waits on cash is a floor call.
				return <OrdersSection {...sectionProps(S.ORDERS)} />;
			case N.WHATSAPP:
				// Manager-visible: staff print the QR. Enable/pause and reissue are
				// admin-only inside, and the backend enforces that independently.
				return <WhatsappAssistantSection restaurantId={restaurant._id} isAdmin={isAdmin} />;
			case N.TABLES:
				return onManageTables ? <TablesLinkSection onOpen={onManageTables} /> : null;
			case N.TAX:
				return <TaxInfoSection {...sectionProps(S.TAX)} />;
			case N.PAYMENTS:
				return <PaymentsSection restaurant={restaurant} isAdmin={isAdmin} />;
			case N.MANAGERS:
				return <ManagersSection restaurantId={restaurant._id} onError={setSideEffectError} />;
			case N.ORGANIZATION:
				return <OrganizationSection {...sectionProps(S.ORGANIZATION)} />;
		}
	};

	const Layout = isDesktop ? SettingsScrollLayout : SettingsListDetailLayout;

	return (
		<div className="flex min-h-full flex-col bg-background md:min-h-[calc(100vh-12rem)] md:rounded-xl md:border md:border-border">
			<SettingsHeader restaurant={restaurant} onClose={onClose} onToggleActive={onToggleActive} />
			{sideEffectError ? (
				<div className="px-4 pt-4 md:px-6">
					<InlineError message={sideEffectError} onDismiss={() => setSideEffectError(null)} />
				</div>
			) : null}
			<Layout
				restaurant={restaurant}
				groups={groups}
				renderSection={renderSection}
				section={currentSection}
				onSectionChange={changeSection}
			/>
		</div>
	);
}

/**
 * One back control, the restaurant, and — for admins/owners — its
 * active/inactive switch, promoted here from inside General because it
 * governs the whole restaurant rather than one field.
 */
function SettingsHeader({
	restaurant,
	onClose,
	onToggleActive,
}: Readonly<{
	restaurant: Doc<"restaurants">;
	onClose: () => void;
	onToggleActive?: (restaurantId: Id<"restaurants">) => void;
}>) {
	const { t } = useTranslation();
	const statusLabel = restaurant.isActive
		? t(RestaurantsKeys.LIST_STATUS_ACTIVE)
		: t(RestaurantsKeys.LIST_STATUS_INACTIVE);

	return (
		<div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-3 backdrop-blur md:rounded-t-xl md:px-6">
			<button
				type="button"
				onClick={onClose}
				className="rounded-md p-1.5 text-muted-foreground hover:bg-hover"
				title={t(RestaurantsKeys.SETTINGS_CLOSE)}
				aria-label={t(RestaurantsKeys.SETTINGS_CLOSE)}
			>
				<ChevronLeft size={20} />
			</button>
			<div data-testid="restaurant-settings-header" className="min-w-0 flex-1">
				<h2 className="truncate text-lg font-semibold text-foreground md:text-xl">
					{restaurant.name}
				</h2>
			</div>
			{onToggleActive ? (
				<button
					type="button"
					role="switch"
					aria-checked={restaurant.isActive}
					data-testid="restaurant-settings-active-toggle"
					onClick={() => onToggleActive(restaurant._id)}
					title={
						restaurant.isActive
							? t(RestaurantsKeys.FORM_TOGGLE_DEACTIVATE_TITLE)
							: t(RestaurantsKeys.FORM_TOGGLE_ACTIVATE_TITLE)
					}
					className="flex shrink-0 items-center gap-2 rounded-full border border-border py-1 pl-3 pr-1 hover:bg-hover"
				>
					<span
						className={`text-xs font-medium ${
							restaurant.isActive ? "text-success" : "text-muted-foreground"
						}`}
					>
						{statusLabel}
					</span>
					<span
						aria-hidden
						className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
							restaurant.isActive ? "bg-success" : "bg-tertiary"
						}`}
					>
						<span
							className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
								restaurant.isActive ? "translate-x-[18px]" : "translate-x-0.5"
							}`}
						/>
					</span>
				</button>
			) : (
				<StatusBadge
					bgColor={restaurant.isActive ? "var(--accent-success)" : "var(--bg-tertiary)"}
					textColor={restaurant.isActive ? "white" : "var(--text-muted)"}
					label={statusLabel}
				/>
			)}
		</div>
	);
}
