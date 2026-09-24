import { RestaurantsKeys } from "@/global/i18n";
import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocationPickerMapProps, LocationPreviewMapProps } from "./LocationPickerMap";

const LazyLocationPickerMap = lazy(() =>
	import("./LocationPickerMap").then((mod) => ({ default: mod.LocationPickerMap }))
);
// Same module, so the preview and the picker share one Leaflet chunk.
const LazyLocationPreviewMap = lazy(() =>
	import("./LocationPickerMap").then((mod) => ({ default: mod.LocationPreviewMap }))
);

type LocationPickerProps = Omit<
	LocationPickerMapProps,
	"searchPlaceholder" | "searchButtonLabel" | "searchNotFoundLabel"
>;

function MapSkeleton({ fill = false }: { readonly fill?: boolean }) {
	return (
		<div
			className={`${fill ? "h-full min-h-64" : "h-64"} rounded-lg bg-muted animate-pulse border border-border`}
		/>
	);
}

/** True after hydration. Leaflet touches `window` on import, so it waits for this. */
function useIsClient() {
	const [isClient, setIsClient] = useState(false);
	useEffect(() => {
		setIsClient(true);
	}, []);
	return isClient;
}

/**
 * Client-only map pin picker for restaurant geofence coordinates.
 * Leaflet is lazy-loaded so SSR and unit tests never touch the DOM APIs.
 */
export function LocationPicker(props: Readonly<LocationPickerProps>) {
	const { t } = useTranslation();
	const isClient = useIsClient();

	if (!isClient) {
		return <MapSkeleton fill={props.fill} />;
	}

	return (
		<Suspense fallback={<MapSkeleton fill={props.fill} />}>
			<LazyLocationPickerMap
				{...props}
				searchPlaceholder={t(RestaurantsKeys.FORM_GEOFENCE_MAP_SEARCH_PLACEHOLDER)}
				searchButtonLabel={t(RestaurantsKeys.FORM_GEOFENCE_MAP_SEARCH_BUTTON)}
				searchNotFoundLabel={t(RestaurantsKeys.FORM_GEOFENCE_MAP_SEARCH_NOT_FOUND)}
			/>
		</Suspense>
	);
}

/**
 * Client-only, read-only thumbnail of the pin — same lazy Leaflet load as the
 * picker. It fills its parent, so the caller sets the height.
 */
export function LocationPreview(props: Readonly<LocationPreviewMapProps>) {
	const isClient = useIsClient();
	const skeleton = <div className="h-full w-full bg-muted animate-pulse" />;

	if (!isClient) return skeleton;

	return (
		<Suspense fallback={skeleton}>
			<LazyLocationPreviewMap {...props} />
		</Suspense>
	);
}
