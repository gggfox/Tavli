/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	updateMock: vi.fn(async () => ["restaurants:1", null]),
	roles: ["admin"] as string[],
	organizations: [
		{ _id: "organizations:1", name: "Grupo Tavli" },
		{ _id: "organizations:2", name: "Otra Org" },
	] as any[],
	orgState: { isLoading: false, error: null as unknown },
	clerkUserId: "user_owner" as string | null,
	clerkLoaded: true,
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

vi.mock("@clerk/tanstack-react-start", () => ({
	useUser: () => ({
		user: hoisted.clerkUserId ? { id: hoisted.clerkUserId } : null,
		isLoaded: hoisted.clerkLoaded,
	}),
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
		hoisted.clerkUserId = "user_owner";
		hoisted.clerkLoaded = true;
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
			"settings-section-public-profile",
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
		// The contact email moved out of General into Public profile when its
		// meaning widened from an ops-only address to the diner-facing one.
		expect((screen.getByLabelText("Contact email") as HTMLInputElement).value).toBe(
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
			currency: "MXN",
		});
	});

	it("saves Public profile on its own, and stamps the review that publishes the email", async () => {
		renderView();

		fireEvent.change(screen.getByLabelText("Phone"), {
			target: { value: "+52 81 1234 5678" },
		});
		fireEvent.click(screen.getByTestId("settings-save-public-profile"));

		await waitFor(() => {
			expect(hoisted.updateMock).toHaveBeenCalledTimes(1);
		});
		expect(hoisted.updateMock).toHaveBeenCalledWith({
			restaurantId: "restaurants:1",
			organizationId: "organizations:1",
			supportEmail: "hola@lacocina.mx",
			address: "",
			phone: "+52 81 1234 5678",
			phoneHasWhatsApp: false,
			instagramUrl: "",
			facebookUrl: "",
			tiktokUrl: "",
			xUrl: "",
			youtubeUrl: "",
			// Saving this section is what lets the contact email reach diners.
			markPublicProfileReviewed: true,
		});
	});

	it("pins a rejected social link to the input that caused it", async () => {
		hoisted.updateMock.mockResolvedValue([
			null,
			{
				name: "VALIDATION_ERROR",
				message: "instagramUrl: ERROR_SOCIAL_URL_WRONG_PLATFORM",
				fields: [{ field: "instagramUrl", message: "ERROR_SOCIAL_URL_WRONG_PLATFORM" }],
			},
		] as any);
		renderView();

		fireEvent.change(screen.getByLabelText("Instagram"), {
			target: { value: "https://facebook.com/lacocina" },
		});
		fireEvent.click(screen.getByTestId("settings-save-public-profile"));

		// All five social inputs share ERROR_SOCIAL_URL_* codes, so the code alone
		// cannot say which one is wrong — only the field name can.
		await waitFor(() => {
			expect(
				(screen.getByLabelText("Instagram") as HTMLInputElement).getAttribute("aria-invalid")
			).toBe("true");
		});
		expect(screen.getByLabelText("Facebook").getAttribute("aria-invalid")).toBeNull();
	});

	it("expands a pasted social handle into a profile URL on blur", () => {
		renderView();

		const instagram = screen.getByLabelText("Instagram") as HTMLInputElement;
		fireEvent.change(instagram, { target: { value: "@lacocina" } });
		fireEvent.blur(instagram);

		expect(instagram.value).toBe("https://instagram.com/lacocina");
	});

	it("only offers the WhatsApp flag once there is a number to reach", () => {
		renderView();

		expect(screen.queryByLabelText("This number is on WhatsApp")).toBeNull();

		fireEvent.change(screen.getByLabelText("Phone"), {
			target: { value: "+52 81 1234 5678" },
		});

		expect(screen.getByLabelText("This number is on WhatsApp")).toBeTruthy();
	});

	it("previews the public URL with the slug segment called out", () => {
		renderView();

		const preview = screen.getByTestId("settings-slug-url");
		expect(preview.textContent).toBe(`${globalThis.location.origin}/r/la-cocina/en/menu`);
		// The editable part is its own node; the fixed path around it is not.
		const highlighted = screen.getByTestId("settings-slug-url-slug");
		expect(highlighted.textContent).toBe("la-cocina");
		expect(highlighted.textContent).not.toContain("/en/menu");
		expect(screen.getByRole("link", { name: "Open Test Link" })).toHaveAttribute(
			"href",
			"/r/la-cocina/en/menu"
		);
	});

	it("normalizes the slug as it is typed and follows it in the preview", () => {
		renderView();

		fireEvent.change(screen.getByLabelText("Slug (URL identifier)"), {
			target: { value: "Café Ñoño" },
		});

		expect((screen.getByLabelText("Slug (URL identifier)") as HTMLInputElement).value).toBe(
			"cafe-nono"
		);
		expect(screen.getByTestId("settings-slug-url-slug").textContent).toBe("cafe-nono");
	});

	it("cautions that changing a live slug retires the current address", () => {
		renderView();

		expect(screen.queryByTestId("settings-slug-change-warning")).toBeNull();

		fireEvent.change(screen.getByLabelText("Slug (URL identifier)"), {
			target: { value: "la-cocina-nueva" },
		});

		expect(screen.getByTestId("settings-slug-change-warning").textContent).toContain("la-cocina");
	});

	it("puts a taken slug on the slug field instead of the generic footer copy", async () => {
		hoisted.updateMock.mockResolvedValue([
			null,
			{
				name: "VALIDATION_ERROR",
				message: "slug: ERROR_SLUG_TAKEN",
				fields: [{ field: "slug", message: "ERROR_SLUG_TAKEN" }],
			},
		] as any);
		renderView();

		fireEvent.change(screen.getByLabelText("Slug (URL identifier)"), {
			target: { value: "el-fogon" },
		});
		fireEvent.click(screen.getByTestId("settings-save-general"));

		await waitFor(() => {
			expect(screen.getByTestId("settings-slug-error").textContent).toBe(
				"That web address is already taken. Try another one."
			);
		});
		expect(screen.getByLabelText("Slug (URL identifier)")).toHaveAttribute("aria-invalid", "true");
		// Not repeated as the section's generic failure.
		expect(screen.getByTestId("settings-section-general").textContent).not.toContain(
			"Failed to update restaurant"
		);
	});

	it("leaves a non-slug failure on the section footer", async () => {
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
		expect(screen.queryByTestId("settings-slug-error")).toBeNull();
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

	it("hides the payments section from an org owner who does not own THIS restaurant", () => {
		// `requireStripeRestaurantAccess` admits only a platform admin or the
		// restaurant's own ownerId, so anyone else was being shown Connect and
		// billing buttons that answer NOT_AUTHORIZED on click.
		hoisted.roles = ["owner"];
		hoisted.clerkUserId = "user_someone_else";
		renderView();

		expect(screen.queryByTestId("settings-section-payments")).toBeNull();
		// The rest of the full-access canvas is unaffected.
		expect(screen.getByTestId("settings-section-managers")).toBeTruthy();
	});

	it("hides the organization section from an owner, who cannot move a restaurant", () => {
		// `restaurants.update` admits an organizationId CHANGE only from a
		// platform admin, and the section's own hint says so — rendering it for
		// owners offered a control whose every save answered NOT_AUTHORIZED.
		hoisted.roles = ["owner"];
		renderView();

		expect(screen.queryByTestId("settings-section-organization")).toBeNull();
		expect(screen.getByTestId("settings-section-general")).toBeTruthy();
		expect(screen.getByTestId("settings-section-managers")).toBeTruthy();
	});

	it("keeps the organization section for a platform admin", () => {
		hoisted.roles = ["admin"];
		renderView();

		expect(screen.getByTestId("settings-section-organization")).toBeTruthy();
	});

	it("shows the payments section to the restaurant's own owner", () => {
		hoisted.roles = ["owner"];
		hoisted.clerkUserId = "user_owner";
		renderView();

		expect(screen.getByTestId("settings-section-payments")).toBeTruthy();
	});

	it("holds the payments section's place while Clerk is still resolving the user", () => {
		// Deciding "hidden" from an unresolved user made the owner's own section
		// blink in after first paint and shove the canvas down when it did.
		hoisted.roles = ["owner"];
		hoisted.clerkUserId = null;
		hoisted.clerkLoaded = false;
		renderView();

		expect(screen.queryByTestId("settings-section-payments")).toBeNull();
		expect(screen.getByTestId("settings-section-payments-loading")).toBeTruthy();
	});

	it("does not make a platform admin wait on Clerk for the payments section", () => {
		hoisted.roles = ["admin"];
		hoisted.clerkUserId = null;
		hoisted.clerkLoaded = false;
		renderView();

		expect(screen.getByTestId("settings-section-payments")).toBeTruthy();
		expect(screen.queryByTestId("settings-section-payments-loading")).toBeNull();
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

		// Scoped to the page header: the Branding preview panes also render the
		// restaurant name (that is what they are previewing), so a bare
		// `getByText` here matches three elements.
		const header = screen.getByTestId("restaurant-settings-header");
		expect(within(header).getByText("La Cocina")).toBeTruthy();
		expect(screen.getByTestId("settings-section-general")).toBeTruthy();
		expect(screen.getByTestId("settings-section-tax")).toBeTruthy();
		// The header currency chip is the one thing the narrow header drops.
		expect(header.textContent).not.toContain("MXN");
	});
});
