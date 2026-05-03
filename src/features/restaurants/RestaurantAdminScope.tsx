import { unwrapResult } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LOCAL_STORAGE_KEY_ADMIN_SELECTED_RESTAURANT_ID } from "./constants";
import { resolveSelectedRestaurantId } from "./restaurantAdminSelection";

type RestaurantAdminContextValue = {
	restaurant: Doc<"restaurants"> | null;
	restaurants: Doc<"restaurants">[];
	selectedRestaurantId: Id<"restaurants"> | null;
	setSelectedRestaurantId: (id: Id<"restaurants">) => void;
	isMultiRestaurant: boolean;
	isLoading: boolean;
	create: (args: {
		name: string;
		slug: string;
		currency: string;
		organizationId: Id<"organizations">;
		description?: string;
		timezone?: string;
	}) => Promise<Id<"restaurants">>;
	update: (args: {
		restaurantId: Id<"restaurants">;
		organizationId: Id<"organizations">;
		name?: string;
		slug?: string;
		description?: string;
		currency?: string;
		timezone?: string;
		defaultLanguage?: string;
		supportedLanguages?: string[];
		orderDayStartMinutesFromMidnight?: number;
	}) => Promise<Id<"restaurants">>;
	toggleActive: (restaurantId: Id<"restaurants">) => Promise<boolean>;
};

const RestaurantAdminContext = createContext<RestaurantAdminContextValue | null>(null);

function readStoredRestaurantId(): Id<"restaurants"> | null {
	if (globalThis.window === undefined) return null;
	try {
		const raw = globalThis.window.localStorage.getItem(LOCAL_STORAGE_KEY_ADMIN_SELECTED_RESTAURANT_ID);
		return raw ? (raw as Id<"restaurants">) : null;
	} catch {
		return null;
	}
}

function writeStoredRestaurantId(id: Id<"restaurants">) {
	if (globalThis.window === undefined) return;
	try {
		globalThis.window.localStorage.setItem(LOCAL_STORAGE_KEY_ADMIN_SELECTED_RESTAURANT_ID, id);
	} catch {
		/* ignore quota / private mode */
	}
}

function clearStoredRestaurantId() {
	if (globalThis.window === undefined) return;
	try {
		globalThis.window.localStorage.removeItem(LOCAL_STORAGE_KEY_ADMIN_SELECTED_RESTAURANT_ID);
	} catch {
		/* ignore */
	}
}

export function RestaurantAdminProvider({ children }: Readonly<{ children: ReactNode }>) {
	const { data: restaurants = [], isLoading } = useQuery({
		...convexQuery(api.restaurants.getAll, {}),
		select: unwrapResult<Doc<"restaurants">[]>,
	});

	const [selectedId, setSelectedId] = useState<Id<"restaurants"> | null>(() => readStoredRestaurantId());

	useEffect(() => {
		if (restaurants.length === 0) {
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
	}, [restaurants, selectedId]);

	const setSelectedRestaurantId = useCallback((id: Id<"restaurants">) => {
		setSelectedId(id);
		writeStoredRestaurantId(id);
	}, []);

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
			timezone?: string;
			defaultLanguage?: string;
			supportedLanguages?: string[];
			orderDayStartMinutesFromMidnight?: number;
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
			selectedRestaurantId: selectedId,
			setSelectedRestaurantId,
			isMultiRestaurant,
			isLoading,
			create,
			update,
			toggleActive,
		}),
		[
			restaurant,
			restaurants,
			selectedId,
			setSelectedRestaurantId,
			isMultiRestaurant,
			isLoading,
			create,
			update,
			toggleActive,
		]
	);

	return <RestaurantAdminContext.Provider value={value}>{children}</RestaurantAdminContext.Provider>;
}

export function useRestaurant(): RestaurantAdminContextValue {
	const ctx = useContext(RestaurantAdminContext);
	if (!ctx) {
		throw new Error("useRestaurant must be used within RestaurantAdminProvider");
	}
	return ctx;
}
