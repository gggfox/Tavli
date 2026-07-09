import { Theme, useTheme } from "@/global/utils/theme";
import { DEFAULT_GEOFENCE_RADIUS_METERS } from "convex/constants";
import L from "leaflet";
import iconRetina from "leaflet/dist/images/marker-icon-2x.png";
import icon from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";
import { useEffect, useMemo, useState } from "react";
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const CARTO_ATTRIBUTION =
	'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const CARTO_TILE_URL = {
	[Theme.LIGHT]: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
	[Theme.DARK]: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
} as const;

const DEFAULT_CENTER: L.LatLngExpression = [19.4326, -99.1332];

const defaultMarkerIcon = L.icon({
	iconUrl: icon,
	iconRetinaUrl: iconRetina,
	shadowUrl: iconShadow,
	iconSize: [25, 41],
	iconAnchor: [12, 41],
	popupAnchor: [1, -34],
	shadowSize: [41, 41],
});

export interface LocationPickerMapProps {
	latitude: number | null;
	longitude: number | null;
	radiusMeters: number;
	recenterKey: number;
	searchPlaceholder: string;
	searchButtonLabel: string;
	searchNotFoundLabel: string;
	onChange: (coords: { latitude: number; longitude: number }) => void;
}

function MapRecenter({
	center,
	zoom,
	recenterKey,
}: {
	center: L.LatLngExpression;
	zoom: number;
	recenterKey: number;
}) {
	const map = useMap();
	useEffect(() => {
		map.flyTo(center, zoom, { duration: 0.5 });
	}, [center, zoom, recenterKey, map]);
	return null;
}

function MapClickHandler({
	onMapClick,
}: {
	onMapClick: (latitude: number, longitude: number) => void;
}) {
	useMapEvents({
		click(event) {
			onMapClick(event.latlng.lat, event.latlng.lng);
		},
	});
	return null;
}

async function searchAddress(query: string): Promise<{ lat: number; lng: number } | null> {
	const trimmed = query.trim();
	if (!trimmed) return null;

	const url = new URL("https://nominatim.openstreetmap.org/search");
	url.searchParams.set("format", "json");
	url.searchParams.set("limit", "1");
	url.searchParams.set("q", trimmed);

	const response = await fetch(url.toString(), {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) return null;

	const results = (await response.json()) as Array<{ lat: string; lon: string }>;
	const first = results[0];
	if (!first) return null;

	const lat = Number.parseFloat(first.lat);
	const lng = Number.parseFloat(first.lon);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
	return { lat, lng };
}

export function LocationPickerMap({
	latitude,
	longitude,
	radiusMeters,
	recenterKey,
	searchPlaceholder,
	searchButtonLabel,
	searchNotFoundLabel,
	onChange,
}: Readonly<LocationPickerMapProps>) {
	const { theme } = useTheme();
	const [searchQuery, setSearchQuery] = useState("");
	const [isSearching, setIsSearching] = useState(false);
	const [searchError, setSearchError] = useState(false);

	const hasPin = latitude != null && longitude != null;
	const center = useMemo<L.LatLngExpression>(
		() => (hasPin ? [latitude, longitude] : DEFAULT_CENTER),
		[hasPin, latitude, longitude]
	);
	const zoom = hasPin ? 17 : 13;
	const effectiveRadius = radiusMeters > 0 ? radiusMeters : DEFAULT_GEOFENCE_RADIUS_METERS;

	const handleSearch = async () => {
		setIsSearching(true);
		setSearchError(false);
		try {
			const result = await searchAddress(searchQuery);
			if (!result) {
				setSearchError(true);
				return;
			}
			onChange({ latitude: result.lat, longitude: result.lng });
		} catch {
			setSearchError(true);
		} finally {
			setIsSearching(false);
		}
	};

	return (
		<div className="space-y-2">
			<div className="flex gap-2">
				<input
					type="search"
					value={searchQuery}
					onChange={(e) => {
						setSearchQuery(e.target.value);
						setSearchError(false);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							void handleSearch();
						}
					}}
					placeholder={searchPlaceholder}
					className="flex-1 px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
				/>
				<button
					type="button"
					onClick={() => void handleSearch()}
					disabled={!searchQuery.trim() || isSearching}
					className="px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary disabled:opacity-50"
				>
					{isSearching ? "…" : searchButtonLabel}
				</button>
			</div>
			{searchError ? <p className="text-xs text-destructive">{searchNotFoundLabel}</p> : null}

			<div className="h-64 rounded-lg overflow-hidden border border-border z-0">
				<MapContainer center={center} zoom={zoom} className="h-full w-full" scrollWheelZoom>
					<TileLayer key={theme} attribution={CARTO_ATTRIBUTION} url={CARTO_TILE_URL[theme]} />
					<MapRecenter center={center} zoom={zoom} recenterKey={recenterKey} />
					<MapClickHandler onMapClick={(lat, lng) => onChange({ latitude: lat, longitude: lng })} />
					{hasPin ? (
						<>
							<Marker
								position={[latitude, longitude]}
								icon={defaultMarkerIcon}
								draggable
								eventHandlers={{
									dragend(event) {
										const marker = event.target;
										const position = marker.getLatLng();
										onChange({ latitude: position.lat, longitude: position.lng });
									},
								}}
							/>
							<Circle
								center={[latitude, longitude]}
								radius={effectiveRadius}
								pathOptions={{ color: "var(--btn-primary-bg)", fillOpacity: 0.12 }}
							/>
						</>
					) : null}
				</MapContainer>
			</div>
		</div>
	);
}
