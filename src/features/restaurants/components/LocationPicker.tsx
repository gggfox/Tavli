import { RestaurantsKeys } from "@/global/i18n";
import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocationPickerMapProps } from "./LocationPickerMap";

const LazyLocationPickerMap = lazy(() =>
	import("./LocationPickerMap").then((mod) => ({ default: mod.LocationPickerMap }))
);

type LocationPickerProps = Omit<
	LocationPickerMapProps,
	"searchPlaceholder" | "searchButtonLabel" | "searchNotFoundLabel"
>;

function MapSkeleton() {
	return <div className="h-64 rounded-lg bg-muted animate-pulse border border-border" />;
}

/**
 * Client-only map pin picker for restaurant geofence coordinates.
 * Leaflet is lazy-loaded so SSR and unit tests never touch the DOM APIs.
 */
export function LocationPicker(props: Readonly<LocationPickerProps>) {
	const { t } = useTranslation();
	const [isClient, setIsClient] = useState(false);

	useEffect(() => {
		setIsClient(true);
	}, []);

	if (!isClient) {
		return <MapSkeleton />;
	}

	return (
		<Suspense fallback={<MapSkeleton />}>
			<LazyLocationPickerMap
				{...props}
				searchPlaceholder={t(RestaurantsKeys.FORM_GEOFENCE_MAP_SEARCH_PLACEHOLDER)}
				searchButtonLabel={t(RestaurantsKeys.FORM_GEOFENCE_MAP_SEARCH_BUTTON)}
				searchNotFoundLabel={t(RestaurantsKeys.FORM_GEOFENCE_MAP_SEARCH_NOT_FOUND)}
			/>
		</Suspense>
	);
}
