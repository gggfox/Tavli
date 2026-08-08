import { useCurrentUserRoles } from "@/features/users/hooks";
import { unwrapResult } from "@/global/utils";
import { convexQuery, useConvexAuth, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { USER_ROLES } from "convex/constants";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import {
	LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID,
	LOCAL_STORAGE_KEY_ADMIN_SELECTED_RESTAURANT_ID,
} from "./constants";
import { useOrganizations, type UseOrganizationsResult } from "./hooks/useOrganizations";
import {
	filterRestaurantsByOrganization,
	resolveSelectedOrganizationId,
	resolveSelectedRestaurantId,
} from "./restaurantAdminSelection";

type RestaurantAdminContextValue = {
	restaurant: Doc<"restaurants"> | null;
	/**
	 * The admin scope **narrowed to the selected organization**. Identical (same
	 * reference) to `allRestaurants` while All organizations is selected, which
	 * is the default.
	 */
	restaurants: Doc<"restaurants">[];
	/**
	 * The unnarrowed admin scope. Exposed alongside the filtered list so a
	 * surface that is genuinely directory-wide can opt out of the org filter
	 * instead of the filter silently changing what `restaurants` means.
	 *
	 * Its one consumer is the dashboard in **portfolio** scope, whose widgets
	 * aggregate server-side across the whole portfolio and therefore cannot
	 * honour a client-side filter (see `DashboardPage`). Note that
	 * `AdminRestaurantsList` is *not* a consumer: the admin restaurants page
	 * deliberately runs its own `restaurants.getAll` so the directory listing
	 * stays complete regardless of the sidebar filter.
	 */
	allRestaurants: Doc<"restaurants">[];
	selectedRestaurantId: Id<"restaurants"> | null;
	/**
	 * `organizationId` is for callers that know the target's organization before
	 * this provider's query does — the create flow, which selects a restaurant
	 * that Convex has not yet pushed into `allRestaurants`.
	 */
	setSelectedRestaurantId: (
		id: Id<"restaurants">,
		options?: { organizationId?: Id<"organizations"> }
	) => void;
	isMultiRestaurant: boolean;
	isLoading: boolean;
	/** The organization directory, tiered by role (see `organizations.getAllOrganizations`). */
	organizations: UseOrganizationsResult["organizations"];
	/** `null` means **All organizations** — the default. */
	selectedOrganizationId: Id<"organizations"> | null;
	setSelectedOrganizationId: (id: Id<"organizations"> | null) => void;
	/**
	 * Kept separate from `isLoading` on purpose: every admin route gates its
	 * empty/skeleton state on `isLoading`, and the organization directory is not
	 * on that critical path — a slow org query must not blank the whole app.
	 */
	isOrganizationsLoading: boolean;
	organizationsError: unknown;
	create: (args: {
		name: string;
		slug: string;
		currency: string;
		organizationId: Id<"organizations">;
		description?: string;
		timezone?: string;
	}) => Promise<Id<"restaurants"> | null>;
	update: (args: {
		restaurantId: Id<"restaurants">;
		organizationId: Id<"organizations">;
		name?: string;
		slug?: string;
		description?: string;
		currency?: string;
		supportEmail?: string;
		// Informational tax block printed on diner receipts (TAVLI-71 Phase 3C).
		// Empty string clears the stored value; omitting leaves it untouched.
		rfc?: string;
		razonSocial?: string;
		fiscalAddress?: string;
		timezone?: string;
		openTime?: string;
		closeTime?: string;
		defaultLanguage?: string;
		supportedLanguages?: string[];
		orderDayStartMinutesFromMidnight?: number;
		orderNumberResetFrequency?: "daily" | "weekly" | "biweekly" | "monthly";
	}) => Promise<Id<"restaurants"> | null>;
	toggleActive: (restaurantId: Id<"restaurants">) => Promise<boolean | null>;
};

const RestaurantAdminContext = createContext<RestaurantAdminContextValue | null>(null);

/*
 * localStorage access is SSR-guarded (`globalThis.window`) and wrapped in
 * try/catch: private mode and quota-exhausted browsers throw on every call, and
 * a remembered selection is never worth crashing the staff shell over.
 */
function readStoredId<T extends string>(key: string): T | null {
	if (globalThis.window === undefined) return null;
	try {
		const raw = globalThis.window.localStorage.getItem(key);
		return raw ? (raw as T) : null;
	} catch {
		return null;
	}
}

function writeStoredId(key: string, id: string) {
	if (globalThis.window === undefined) return;
	try {
		globalThis.window.localStorage.setItem(key, id);
	} catch {
		/* ignore quota / private mode */
	}
}

function clearStoredId(key: string) {
	if (globalThis.window === undefined) return;
	try {
		globalThis.window.localStorage.removeItem(key);
	} catch {
		/* ignore */
	}
}

function readStoredRestaurantId(): Id<"restaurants"> | null {
	return readStoredId<Id<"restaurants">>(LOCAL_STORAGE_KEY_ADMIN_SELECTED_RESTAURANT_ID);
}

function writeStoredRestaurantId(id: Id<"restaurants">) {
	writeStoredId(LOCAL_STORAGE_KEY_ADMIN_SELECTED_RESTAURANT_ID, id);
}

function clearStoredRestaurantId() {
	clearStoredId(LOCAL_STORAGE_KEY_ADMIN_SELECTED_RESTAURANT_ID);
}

function readStoredOrganizationId(): Id<"organizations"> | null {
	return readStoredId<Id<"organizations">>(LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID);
}

function writeStoredOrganizationId(id: Id<"organizations">) {
	writeStoredId(LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID, id);
}

function clearStoredOrganizationId() {
	clearStoredId(LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID);
}

export function RestaurantAdminProvider({ children }: Readonly<{ children: ReactNode }>) {
	const { isAuthenticated } = useConvexAuth();
	const { data: allRestaurants = [], isLoading } = useQuery({
		...convexQuery(api.restaurants.getAll, {}),
		select: unwrapResult<Doc<"restaurants">[]>,
	});

	/*
	 * The organization scope is admin-only (the switcher is too), and
	 * `getAllOrganizations` rejects anyone below owner — so gate the query on
	 * the role rather than firing it for every manager and employee who loads a
	 * staff route and getting a guaranteed NOT_AUTHORIZED back.
	 */
	const { roles, isLoading: rolesLoading } = useCurrentUserRoles();
	const isAdmin = roles.includes(USER_ROLES.ADMIN);
	const {
		organizations,
		isLoading: isOrganizationsLoading,
		error: organizationsError,
	} = useOrganizations({ enabled: isAdmin });

	const [selectedId, setSelectedId] = useState<Id<"restaurants"> | null>(() =>
		readStoredRestaurantId()
	);
	const [selectedOrgId, setSelectedOrgId] = useState<Id<"organizations"> | null>(() =>
		readStoredOrganizationId()
	);

	/*
	 * The organization filter is applied optimistically from the stored id,
	 * before the directory has loaded, so the restaurant scope is never briefly
	 * wider than the admin asked for. A stored id that turns out to be stale is
	 * dropped by the effect below, and dropping it only ever *widens* the scope.
	 *
	 * It is also dropped the instant we learn the viewer is not an admin — they
	 * have no switcher to clear it with, so a leftover id must not narrow
	 * anything even for the frames before the effect clears the state. While
	 * roles are still unknown the optimistic filter stands, which is the right
	 * bet: admins are who store an id in the first place.
	 */
	const effectiveOrgId = isAdmin || rolesLoading ? selectedOrgId : null;

	const restaurants = useMemo(
		() => filterRestaurantsByOrganization(allRestaurants, effectiveOrgId),
		[allRestaurants, effectiveOrgId]
	);

	/*
	 * Only reconcile against a directory we actually have: while auth is
	 * resolving or the query is in flight `organizations` is `[]`, and treating
	 * that as "the org is gone" would wipe the stored preference on every load.
	 * On error we keep the filter rather than silently re-widening the admin's
	 * scope — the switcher surfaces the failure and offers the escape.
	 *
	 * "No directory" and "not entitled to a directory" are deliberately
	 * different: a viewer who is not an admin never issues the query, so their
	 * empty `organizations` is authoritative and a leftover stored id (an admin
	 * who was since demoted) resolves to All and is cleared, rather than
	 * pinning them to a phantom organization they have no control to clear.
	 */
	const organizationsSettled =
		isAuthenticated &&
		!rolesLoading &&
		(!isAdmin || (!isOrganizationsLoading && !organizationsError));

	useEffect(() => {
		if (!organizationsSettled) return;
		if (selectedOrgId === null) return;
		const next = resolveSelectedOrganizationId(organizations, selectedOrgId);
		if (next === selectedOrgId) return;
		setSelectedOrgId(next);
		clearStoredOrganizationId();
	}, [organizations, organizationsSettled, selectedOrgId]);

	/*
	 * A restaurant chosen deliberately may not be in `allRestaurants` yet: the
	 * create flow calls `setSelectedRestaurantId` the moment the mutation
	 * resolves, before Convex has pushed the new row into this query. Remember
	 * that id so the reconciliation effect below leaves the selection alone
	 * until the row lands, instead of bouncing it to the current default and
	 * making the brand-new restaurant silently fail to become active.
	 */
	const pendingSelectionRef = useRef<Id<"restaurants"> | null>(null);

	useEffect(() => {
		if (pendingSelectionRef.current !== null) {
			// Only hold off while the awaited row is genuinely still in flight; any
			// later selection replaces the pending id, so this cannot wedge.
			if (
				pendingSelectionRef.current === selectedId &&
				!allRestaurants.some((r) => r._id === pendingSelectionRef.current)
			) {
				return;
			}
			pendingSelectionRef.current = null;
		}
		// Emptiness is judged on the *unfiltered* scope: an organization with no
		// restaurants must not throw away the admin's remembered restaurant, so
		// switching back to All restores it instead of jumping to the default.
		if (allRestaurants.length === 0) {
			if (selectedId !== null) {
				setSelectedId(null);
				clearStoredRestaurantId();
			}
			return;
		}
		const next = resolveSelectedRestaurantId(restaurants, selectedId);
		if (next === null) return;
		if (next !== selectedId) {
			setSelectedId(next);
			writeStoredRestaurantId(next);
		}
	}, [allRestaurants, restaurants, selectedId]);

	const setSelectedRestaurantId = useCallback(
		(id: Id<"restaurants">, options?: { organizationId?: Id<"organizations"> }) => {
			setSelectedId(id);
			writeStoredRestaurantId(id);
			pendingSelectionRef.current = id;
			// A deliberate jump to a restaurant outside the current filter — most
			// commonly creating one in another organization — widens the scope to
			// that restaurant's organization. Without this, reconciliation would
			// immediately bounce the selection back to the filtered org's default
			// and the new restaurant would appear to vanish. The caller's
			// organization wins over the lookup precisely because the row it is
			// pointing at may not have arrived here yet.
			const targetOrgId =
				options?.organizationId ?? allRestaurants.find((r) => r._id === id)?.organizationId;
			if (targetOrgId && effectiveOrgId !== null && targetOrgId !== effectiveOrgId) {
				setSelectedOrgId(targetOrgId);
				writeStoredOrganizationId(targetOrgId);
			}
		},
		[allRestaurants, effectiveOrgId]
	);

	const setSelectedOrganizationId = useCallback((id: Id<"organizations"> | null) => {
		setSelectedOrgId(id);
		if (id === null) {
			clearStoredOrganizationId();
		} else {
			writeStoredOrganizationId(id);
		}
	}, []);

	/*
	 * Derived, never stored: `restaurant` resolves against the *filtered* list on
	 * the same render the filter changes, so there is no frame in which the
	 * active restaurant sits outside the selected organization. The effect above
	 * only catches the state/localStorage up afterwards.
	 */
	const restaurant = useMemo(() => {
		if (restaurants.length === 0) return null;
		const id = resolveSelectedRestaurantId(restaurants, selectedId);
		if (id === null) return null;
		return restaurants.find((r) => r._id === id) ?? null;
	}, [restaurants, selectedId]);

	const isMultiRestaurant = restaurants.length > 1;

	const createMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurants.create),
	});

	const updateMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurants.update),
	});

	const toggleActiveMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurants.toggleActive),
	});

	const create = useCallback(
		async (args: {
			name: string;
			slug: string;
			currency: string;
			organizationId: Id<"organizations">;
			description?: string;
			timezone?: string;
		}) => unwrapResult(await createMutation.mutateAsync(args)),
		[createMutation]
	);

	const update = useCallback(
		async (args: {
			restaurantId: Id<"restaurants">;
			organizationId: Id<"organizations">;
			name?: string;
			slug?: string;
			description?: string;
			currency?: string;
			supportEmail?: string;
			rfc?: string;
			razonSocial?: string;
			fiscalAddress?: string;
			timezone?: string;
			openTime?: string;
			closeTime?: string;
			defaultLanguage?: string;
			supportedLanguages?: string[];
			orderDayStartMinutesFromMidnight?: number;
			orderNumberResetFrequency?: "daily" | "weekly" | "biweekly" | "monthly";
		}) => unwrapResult(await updateMutation.mutateAsync(args)),
		[updateMutation]
	);

	const toggleActive = useCallback(
		async (restaurantId: Id<"restaurants">) =>
			unwrapResult(await toggleActiveMutation.mutateAsync({ restaurantId })),
		[toggleActiveMutation]
	);

	const value = useMemo(
		() => ({
			restaurant,
			restaurants,
			allRestaurants,
			selectedRestaurantId: selectedId,
			setSelectedRestaurantId,
			isMultiRestaurant,
			isLoading,
			organizations,
			// The *effective* filter, so the value the switcher shows can never
			// disagree with the list every other consumer is reading.
			selectedOrganizationId: effectiveOrgId,
			setSelectedOrganizationId,
			isOrganizationsLoading,
			organizationsError,
			create,
			update,
			toggleActive,
		}),
		[
			restaurant,
			restaurants,
			allRestaurants,
			selectedId,
			setSelectedRestaurantId,
			isMultiRestaurant,
			isLoading,
			organizations,
			effectiveOrgId,
			setSelectedOrganizationId,
			isOrganizationsLoading,
			organizationsError,
			create,
			update,
			toggleActive,
		]
	);

	return (
		<RestaurantAdminContext.Provider value={value}>{children}</RestaurantAdminContext.Provider>
	);
}

export function useRestaurant(): RestaurantAdminContextValue {
	const ctx = useContext(RestaurantAdminContext);
	if (!ctx) {
		throw new Error("useRestaurant must be used within RestaurantAdminProvider");
	}
	return ctx;
}
