/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	updateMock: vi.fn(async () => ["restaurants:1", null]),
	roles: ["admin"] as string[],
	organizations: [
		{ _id: "organizations:1", name: "Grupo Tavli" },
		{ _id: "organizations:2", name: "Otra Org" },
	] as any[],
	orgState: { isLoading: false, error: null as unknown },
}));

vi.mock("@tanstack/react-query", () => ({
	useMutation: () => ({ mutateAsync: hoisted.updateMock, isPending: false }),
	useQuery: () => ({ data: [], isLoading: false }),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: unknown, args: unknown) => ({ queryKey: [ref, args] }),
	useConvexMutation: () => hoisted.updateMock,
	useConvexAction: () => vi.fn(),
	useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

vi.mock("@/features/users/hooks", () => ({
	useCurrentUserRoles: () => ({
		roles: hoisted.roles,
		organizationId: "organizations:1",
		isLoading: false,
	}),
}));

vi.mock("@/features/restaurants/hooks/useOrganizations", () => ({
	useOrganizations: () => ({
		organizations: hoisted.organizations,
		isLoading: hoisted.orgState.isLoading,
		error: hoisted.orgState.error,
	}),
}));

vi.mock("@/features/restaurants/components/LocationPicker", () => ({
	LocationPicker: () => <div data-testid="location-picker" />,
}));

vi.mock("@/features/restaurants/components/RestaurantManagersField", () => ({
	RestaurantManagersField: () => <div data-testid="managers-field" />,
}));

vi.mock("@/features/restaurants/components/StripeConnectSetup", () => ({
	StripeConnectSetup: () => <div data-testid="stripe-connect-setup" />,
}));

import { RestaurantSettingsView } from "./RestaurantSettingsView";

const now = 1_745_000_000_000;

function baseRestaurant(overrides: Record<string, any> = {}) {
	return {
		_id: "restaurants:1",
		_creationTime: now,
		name: "La Cocina",
		slug: "la-cocina",
		description: "Comida casera",
		supportEmail: "hola@lacocina.mx",
		currency: "MXN",
		timezone: "America/Mexico_City",
		openTime: "10:00",
		closeTime: "23:00",
		orderDayStartMinutesFromMidnight: 240,
		orderNumberResetFrequency: "monthly",
		latitude: 25.65,
		longitude: -100.28,
		geofenceRadiusMeters: 150,
		geofenceBypassCode: "ABC123",
		organizationId: "organizations:1",
		ownerId: "user_owner",
		isActive: true,
		createdAt: now,
		updatedAt: now,
		...overrides,
	} as any;
}

function setViewportMatches(matches: boolean) {
	Object.defineProperty(globalThis, "matchMedia", {
		writable: true,
		value: (query: string) => ({
			matches: matches && query.includes("orientation: portrait"),
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		}),
	});
}

function renderView(props: Record<string, any> = {}) {
	return render(
		<RestaurantSettingsView
			restaurant={baseRestaurant()}
			settingsAccess="full"
			onClose={vi.fn()}
			{...props}
		/>
	);
}

describe("RestaurantSettingsView", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hoisted.updateMock.mockResolvedValue(["restaurants:1", null] as any);
		hoisted.roles = ["admin"];
		hoisted.orgState = { isLoading: false, error: null };
		hoisted.organizations = [
			{ _id: "organizations:1", name: "Grupo Tavli" },
			{ _id: "organizations:2", name: "Otra Org" },
		];
		setViewportMatches(false);
	});

	it("renders every section of the old modal on one canvas", () => {
		renderView();

		for (const testId of [
			"settings-section-general",
			"settings-section-hours",
			"settings-section-location",
			"settings-section-tax",
			"settings-section-organization",
			"settings-section-managers",
			"settings-section-payments",
		]) {
			expect(screen.getByTestId(testId)).toBeTruthy();
		}
	});

	it("keeps every field the modal had, with its stored value", () => {
		renderView();

		expect((screen.getByLabelText("Restaurant Name") as HTMLInputElement).value).toBe("La Cocina");
		expect((screen.getByLabelText("Slug (URL identifier)") as HTMLInputElement).value).toBe(
			"la-cocina"
		);
		expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe(
			"Comida casera"
		);
		expect((screen.getByLabelText("Support email") as HTMLInputElement).value).toBe(
			"hola@lacocina.mx"
		);
		expect((screen.getByLabelText("Currency") as HTMLSelectElement).value).toBe("MXN");
		expect((screen.getByLabelText("Timezone") as HTMLSelectElement).value).toBe(
			"America/Mexico_City"
		);
		expect((screen.getByLabelText("Opening time") as HTMLInputElement).value).toBe("10:00");
		expect((screen.getByLabelText("Closing time") as HTMLInputElement).value).toBe("23:00");
		expect((screen.getByLabelText("Start of order day") as HTMLInputElement).value).toBe("04:00");
		expect((screen.getByLabelText("Latitude") as HTMLInputElement).value).toBe("25.65");
		expect((screen.getByLabelText("Longitude") as HTMLInputElement).value).toBe("-100.28");
		expect((screen.getByLabelText("Radius (meters)") as HTMLInputElement).value).toBe("150");
		expect((screen.getByLabelText("Geofence bypass code") as HTMLInputElement).value).toBe(
			"ABC123"
		);
		expect((screen.getByLabelText("Organization") as HTMLSelectElement).value).toBe(
			"organizations:1"
		);
		expect(screen.getByTestId("location-picker")).toBeTruthy();
	});

	it("gates each section's save on that section being dirty", () => {
		renderView();

		expect((screen.getByTestId("settings-save-general") as HTMLButtonElement).disabled).toBe(true);

		fireEvent.change(screen.getByLabelText("Restaurant Name"), {
			target: { value: "La Cocina Nueva" },
		});

		expect((screen.getByTestId("settings-save-general") as HTMLButtonElement).disabled).toBe(false);
		// Editing General must not arm the Tax save.
		expect((screen.getByTestId("settings-save-tax") as HTMLButtonElement).disabled).toBe(true);
	});

	it("saves General on its own, patching only its fields", async () => {
		renderView();

		fireEvent.change(screen.getByLabelText("Restaurant Name"), {
			target: { value: "La Cocina Nueva" },
		});
		fireEvent.click(screen.getByTestId("settings-save-general"));

		await waitFor(() => {
			expect(hoisted.updateMock).toHaveBeenCalledTimes(1);
		});
		expect(hoisted.updateMock).toHaveBeenCalledWith({
			restaurantId: "restaurants:1",
			organizationId: "organizations:1",
			name: "La Cocina Nueva",
			slug: "la-cocina",
			description: "Comida casera",
			supportEmail: "hola@lacocina.mx",
			currency: "MXN",
		});
	});

	it("saves the new tax block", async () => {
		renderView({ restaurant: baseRestaurant({ rfc: undefined }) });

		fireEvent.change(screen.getByLabelText("RFC"), { target: { value: "coc010101abc" } });
		fireEvent.change(screen.getByLabelText("Legal name (razón social)"), {
			target: { value: "La Cocina S.A. de C.V." },
		});
		fireEvent.change(screen.getByLabelText("Fiscal address"), {
			target: { value: "Av. Siempre Viva 123" },
		});
		fireEvent.click(screen.getByTestId("settings-save-tax"));

		await waitFor(() => {
			expect(hoisted.updateMock).toHaveBeenCalledWith({
				restaurantId: "restaurants:1",
				organizationId: "organizations:1",
				// RFCs are upper-cased on entry, the way the bypass code is.
				rfc: "COC010101ABC",
				razonSocial: "La Cocina S.A. de C.V.",
				fiscalAddress: "Av. Siempre Viva 123",
			});
		});
	});

	it("says the tax block is receipt-only and not a CFDI", () => {
		renderView();

		const hint = screen.getByTestId("settings-section-tax").textContent ?? "";
		expect(hint).toContain("receipt");
		expect(hint).toContain("CFDI");
	});

	it("clears a tax field by sending the empty string the mutation trims", async () => {
		renderView({
			restaurant: baseRestaurant({
				rfc: "COC010101ABC",
				razonSocial: "La Cocina S.A. de C.V.",
				fiscalAddress: "Av. Siempre Viva 123",
			}),
		});

		fireEvent.change(screen.getByLabelText("RFC"), { target: { value: "" } });
		fireEvent.click(screen.getByTestId("settings-save-tax"));

		await waitFor(() => {
			expect(hoisted.updateMock).toHaveBeenCalledWith(
				expect.objectContaining({
					rfc: "",
					razonSocial: "La Cocina S.A. de C.V.",
					fiscalAddress: "Av. Siempre Viva 123",
				})
			);
		});
	});

	it("keeps a failed section's error out of the other sections", async () => {
		hoisted.updateMock.mockResolvedValue([
			null,
			{ name: "NOT_AUTHORIZED", message: "NOT_AUTHORIZED" },
		] as any);
		renderView();

		fireEvent.change(screen.getByLabelText("Restaurant Name"), { target: { value: "Nuevo" } });
		fireEvent.click(screen.getByTestId("settings-save-general"));

		await waitFor(() => {
			expect(screen.getByTestId("settings-section-general").textContent).toContain(
				"You don't have permission to do that."
			);
		});
		expect(screen.getByTestId("settings-section-tax").textContent).not.toContain(
			"You don't have permission to do that."
		);
	});

	it("saves the geofence without touching the general fields", async () => {
		renderView();

		fireEvent.change(screen.getByLabelText("Radius (meters)"), {
			target: { value: "250" },
		});
		fireEvent.click(screen.getByTestId("settings-save-location"));

		await waitFor(() => {
			expect(hoisted.updateMock).toHaveBeenCalledWith({
				restaurantId: "restaurants:1",
				organizationId: "organizations:1",
				latitude: 25.65,
				longitude: -100.28,
				geofenceRadiusMeters: 250,
				geofenceBypassCode: "ABC123",
			});
		});
	});

	it("hides admin-only sections from a restaurant manager but keeps tax info", () => {
		hoisted.roles = [];
		renderView({ settingsAccess: "manager" });

		expect(screen.getByTestId("settings-section-general")).toBeTruthy();
		expect(screen.getByTestId("settings-section-tax")).toBeTruthy();
		expect(screen.queryByTestId("settings-section-organization")).toBeNull();
		expect(screen.queryByTestId("settings-section-managers")).toBeNull();
		expect(screen.queryByTestId("settings-section-payments")).toBeNull();
		expect(screen.queryByLabelText("Order number reset frequency (admin)")).toBeNull();
	});

	it("explains itself instead of vanishing when organizations cannot be listed", () => {
		hoisted.organizations = [];
		hoisted.orgState = { isLoading: false, error: new Error("boom") };
		renderView();

		const section = screen.getByTestId("settings-section-organization");
		expect(section.textContent).toContain("Could not load organizations");
		const select = screen.getByLabelText("Organization") as HTMLSelectElement;
		// The current org stays selected so the control is never blank and never
		// silently reassigns the restaurant...
		expect(select.value).toBe("organizations:1");
		// ...but its LABEL is localized copy, not the raw Convex document id.
		expect(select.selectedOptions[0].textContent).toBe("Current organization");
		expect(section.textContent).not.toContain("organizations:1");
	});

	it("closes the canvas from the back chevron", () => {
		const onClose = vi.fn();
		renderView({ onClose });

		fireEvent.click(screen.getAllByLabelText("Close restaurant settings")[0]);

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("renders on tablet portrait without the desktop-only currency chip", () => {
		setViewportMatches(true);
		renderView();

		expect(screen.getByText("La Cocina")).toBeTruthy();
		expect(screen.getByTestId("settings-section-general")).toBeTruthy();
		expect(screen.getByTestId("settings-section-tax")).toBeTruthy();
		// The header currency chip is the one thing the narrow header drops.
		const header = screen.getByText("La Cocina").parentElement;
		expect(header?.textContent).not.toContain("MXN");
	});
});
