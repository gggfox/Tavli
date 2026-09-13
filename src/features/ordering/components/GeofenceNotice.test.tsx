/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/react-query", () => ({ convexQuery: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined, isFetching: false }),
}));
vi.mock("convex/_generated/api", () => ({
	api: { restaurants: { verifyGeofenceBypass: { name: "verifyGeofenceBypass" } } },
}));

import { GeofenceNotice } from "./GeofenceNotice";

function renderNotice(status: any) {
	return render(
		<GeofenceNotice slug="vernaculo-spgg" status={status} onRetry={() => {}} onBypass={() => {}} />
	);
}

describe("GeofenceNotice", () => {
	// Chrome never re-prompts once a site is denied, so the retry button is a
	// button that cannot work. Offering it is worse than offering nothing.
	it("drops the retry button when location is blocked", () => {
		renderNotice("blocked");

		expect(screen.queryByRole("button", { name: /check my location again/i })).toBeNull();
	});

	it("says the browser is blocking, not that location merely failed", () => {
		renderNotice("blocked");

		expect(screen.getByText(/browser settings/i)).toBeTruthy();
	});

	it("keeps the retry button when a retry could actually succeed", () => {
		renderNotice("unavailable");

		expect(screen.getByRole("button", { name: /check my location again/i })).toBeTruthy();
	});

	it("still offers the staff bypass code when blocked", () => {
		renderNotice("blocked");

		expect(screen.getByLabelText(/access code/i)).toBeTruthy();
	});
});
