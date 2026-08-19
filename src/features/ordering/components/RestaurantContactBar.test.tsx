/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RestaurantContactBar } from "./RestaurantContactBar";

function baseRestaurant(contact?: Record<string, any>, overrides: Record<string, any> = {}) {
	return {
		_id: "restaurants:1",
		name: "La Cocina",
		slug: "la-cocina",
		currency: "MXN",
		isActive: true,
		openTime: "10:00",
		closeTime: "23:00",
		...(contact ? { contact } : {}),
		...overrides,
	} as any;
}

describe("RestaurantContactBar", () => {
	it("renders nothing when the restaurant has published no contact details", () => {
		const { container } = render(<RestaurantContactBar restaurant={baseRestaurant()} />);

		// An unconfigured restaurant must cost zero vertical space — this bar is
		// pinned above the fold, so an empty shell would permanently shrink the menu.
		expect(container.firstChild).toBeNull();
	});

	it("links each channel with the scheme that channel needs", () => {
		render(
			<RestaurantContactBar
				restaurant={baseRestaurant({
					email: "hola@lacocina.mx",
					phone: "+528112345678",
					whatsAppUrl: "https://wa.me/528112345678",
					address: "Pedregal De La Huasteca 1",
				})}
			/>
		);

		expect(screen.getByRole("link", { name: /hola@lacocina\.mx/ })).toHaveAttribute(
			"href",
			"mailto:hola@lacocina.mx"
		);
		// The `+` is what keeps the number dialable from outside Mexico.
		expect(screen.getByRole("link", { name: /\+528112345678/ })).toHaveAttribute(
			"href",
			"tel:+528112345678"
		);
	});

	it("keeps the whole bar to two rows: socials, then details", () => {
		const { container } = render(
			<RestaurantContactBar
				restaurant={baseRestaurant({
					phone: "+528112345678",
					socials: {
						instagram: "https://instagram.com/lacocina",
						facebook: "https://facebook.com/lacocina",
					},
				})}
			/>
		);

		const bar = container.firstChild as HTMLElement;
		expect(bar.children).toHaveLength(2);
		// The details row must scroll rather than wrap, or a narrow phone pushes
		// it into a third row and the cap stops being a cap.
		expect(bar.children[1].className).toContain("whitespace-nowrap");
		expect(bar.children[1].className).toContain("overflow-x-auto");
	});

	it("drops to a single row when only socials are configured", () => {
		const { container } = render(
			<RestaurantContactBar
				restaurant={baseRestaurant(
					{ socials: { instagram: "https://instagram.com/lacocina" } },
					{ openTime: undefined, closeTime: undefined }
				)}
			/>
		);

		expect((container.firstChild as HTMLElement).children).toHaveLength(1);
	});

	it("opens social profiles in a new tab without leaking the referrer", () => {
		render(
			<RestaurantContactBar
				restaurant={baseRestaurant({ socials: { instagram: "https://instagram.com/lacocina" } })}
			/>
		);

		const link = screen.getByRole("link", { name: /instagram/i });
		expect(link).toHaveAttribute("href", "https://instagram.com/lacocina");
		expect(link).toHaveAttribute("target", "_blank");
		expect(link.getAttribute("rel")).toContain("noopener");
	});

	it("does not repeat the restaurant name, which the sticky header already shows", () => {
		render(<RestaurantContactBar restaurant={baseRestaurant({ phone: "+528112345678" })} />);

		expect(screen.queryByText("La Cocina")).toBeNull();
	});
});
