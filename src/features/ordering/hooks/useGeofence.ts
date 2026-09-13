/**
 * Geofence gate for customer ordering (TAVLI-6).
 *
 * Customers can always browse the menu, but ordering is hidden unless the
 * device is within the restaurant's configured radius. This is a soft UX
 * gate — browser geolocation is spoofable and can be denied, so staff can
 * hand out a bypass code, and joining a friend's tab (which requires a code
 * shared at the table) also counts as presence.
 */
import { DEFAULT_GEOFENCE_RADIUS_METERS } from "convex/constants";
import { useEffect, useState } from "react";

export type GeofenceStatus =
	/** Restaurant has no coordinates configured — online ordering is off. */
	| "unconfigured"
	/** Waiting for the restaurant config or the device position. */
	| "checking"
	/** Device inside the radius (or a bypass was granted). */
	| "inside"
	/** Device located but outside the radius. */
	| "outside"
	/** Geolocation failed for a reason a retry could plausibly fix. */
	| "unavailable"
	/**
	 * The diner refused location, or the browser has it blocked for this site.
	 * Split from `unavailable` because the remedy is different and the usual
	 * advice is actively wrong: once denied, `getCurrentPosition` fails without
	 * re-prompting, so a "try again" button can never succeed. Only browser
	 * settings — or the staff bypass code — get past this.
	 */
	| "blocked";

/** Statuses `GeofenceNotice` has something useful to say about. */
export function showsGeofenceNotice(status: GeofenceStatus): boolean {
	return status === "blocked" || status === "outside" || status === "unavailable";
}

const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(
	a: { latitude: number; longitude: number },
	b: { latitude: number; longitude: number }
): number {
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(b.latitude - a.latitude);
	const dLng = toRad(b.longitude - a.longitude);
	const sinLat = Math.sin(dLat / 2);
	const sinLng = Math.sin(dLng / 2);
	const h =
		sinLat * sinLat + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinLng * sinLng;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bypassStorageKey(slug: string): string {
	return `tavli_geofence_bypass:${slug}`;
}

export function hasGeofenceBypass(slug: string): boolean {
	try {
		return sessionStorage.getItem(bypassStorageKey(slug)) === "1";
	} catch {
		return false;
	}
}

export function grantGeofenceBypass(slug: string): void {
	try {
		sessionStorage.setItem(bypassStorageKey(slug), "1");
	} catch {
		// sessionStorage unavailable — the geofence check will simply re-run.
	}
}

interface GeofenceConfig {
	latitude?: number;
	longitude?: number;
	geofenceRadiusMeters?: number;
}

/**
 * @param slug restaurant slug (scopes the bypass grant)
 * @param config public restaurant geofence fields, or undefined while loading
 */
export function useGeofence(
	slug: string,
	config: GeofenceConfig | undefined
): { status: GeofenceStatus; retry: () => void; bypass: () => void } {
	const [status, setStatus] = useState<GeofenceStatus>("checking");
	const [attempt, setAttempt] = useState(0);

	const isConfigLoading = config === undefined;
	const configured = config?.latitude != null && config?.longitude != null;
	const latitude = config?.latitude;
	const longitude = config?.longitude;
	const radius = config?.geofenceRadiusMeters ?? DEFAULT_GEOFENCE_RADIUS_METERS;

	useEffect(() => {
		if (isConfigLoading) {
			setStatus("checking");
			return;
		}
		if (!configured || latitude == null || longitude == null) {
			setStatus("unconfigured");
			return;
		}
		if (hasGeofenceBypass(slug)) {
			setStatus("inside");
			return;
		}
		if (typeof navigator === "undefined" || !navigator.geolocation) {
			setStatus("unavailable");
			return;
		}

		let cancelled = false;
		setStatus("checking");
		navigator.geolocation.getCurrentPosition(
			(position) => {
				if (cancelled) return;
				const meters = distanceMeters(
					{ latitude: position.coords.latitude, longitude: position.coords.longitude },
					{ latitude, longitude }
				);
				setStatus(meters <= radius ? "inside" : "outside");
			},
			(error: GeolocationPositionError) => {
				if (cancelled) return;
				// `PERMISSION_DENIED` is 1 in the spec; read it off the error when
				// the browser supplies the constant, since the object handed to
				// this callback is not always a real GeolocationPositionError.
				const denied = error?.code === (error?.PERMISSION_DENIED ?? 1);
				setStatus(denied ? "blocked" : "unavailable");
			},
			{ enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
		);
		return () => {
			cancelled = true;
		};
	}, [isConfigLoading, configured, latitude, longitude, radius, slug, attempt]);

	return {
		status,
		retry: () => setAttempt((n) => n + 1),
		bypass: () => {
			grantGeofenceBypass(slug);
			setStatus("inside");
		},
	};
}
