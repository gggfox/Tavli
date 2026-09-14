/* eslint-disable boundaries/no-unknown-files, @typescript-eslint/no-explicit-any */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showsGeofenceNotice, useGeofence } from "./useGeofence";

/** Values the spec gives `GeolocationPositionError.code`. */
const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

const INSIDE_CONFIG = {
	latitude: 25.6605,
	longitude: -100.4627,
	geofenceRadiusMeters: 150,
};

function mockGeolocationError(code: number) {
	Object.defineProperty(globalThis.navigator, "geolocation", {
		configurable: true,
		value: {
			getCurrentPosition: (_ok: any, fail: any) => fail({ code, message: "denied" }),
		},
	});
}

describe("useGeofence failure classification", () => {
	beforeEach(() => {
		sessionStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// A denied permission and a flaky GPS need different words: Chrome will not
	// re-prompt once denied, so "try again" is advice that cannot work.
	it("reports a denied permission as blocked, not merely unavailable", async () => {
		mockGeolocationError(PERMISSION_DENIED);

		const { result } = renderHook(() => useGeofence("vernaculo-spgg", INSIDE_CONFIG));

		await waitFor(() => expect(result.current.status).toBe("blocked"));
	});

	it("still reports a timeout as unavailable", async () => {
		mockGeolocationError(TIMEOUT);

		const { result } = renderHook(() => useGeofence("vernaculo-spgg", INSIDE_CONFIG));

		await waitFor(() => expect(result.current.status).toBe("unavailable"));
	});

	it("still reports an unobtainable position as unavailable", async () => {
		mockGeolocationError(POSITION_UNAVAILABLE);

		const { result } = renderHook(() => useGeofence("vernaculo-spgg", INSIDE_CONFIG));

		await waitFor(() => expect(result.current.status).toBe("unavailable"));
	});
});

describe("showsGeofenceNotice", () => {
	// The caller used to spell this set out inline, so adding a status meant
	// remembering to widen a condition in another file or the notice silently
	// stopped rendering.
	it("covers every status the notice can explain", () => {
		expect(showsGeofenceNotice("blocked")).toBe(true);
		expect(showsGeofenceNotice("outside")).toBe(true);
		expect(showsGeofenceNotice("unavailable")).toBe(true);
	});

	it("stays out of the way for statuses the notice has nothing to say about", () => {
		expect(showsGeofenceNotice("inside")).toBe(false);
		expect(showsGeofenceNotice("checking")).toBe(false);
		expect(showsGeofenceNotice("unconfigured")).toBe(false);
	});
});
