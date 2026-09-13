/* eslint-disable boundaries/no-unknown-files, @typescript-eslint/no-explicit-any */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MenuHero } from "./MenuHero";

const header = { phone: { url: "https://x/h.jpg", width: 800, height: 450 } };

describe("MenuHero", () => {
	it("overlays the name when the restaurant has no logo", () => {
		render(<MenuHero branding={{ fontStack: "x", header } as any} restaurantName="vernaculo" />);
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("vernaculo");
	});

	// The customer header already shows the logo, and a logo almost always
	// contains the name. Overlaying it again on the hero put the name on the
	// page three times in the prototype review.
	it("drops the overlay when the logo already carries the name", () => {
		render(
			<MenuHero
				branding={
					{
						fontStack: "x",
						header,
						logo: { url: "https://x/l.png", width: 512, height: 512 },
					} as any
				}
				restaurantName="vernaculo"
			/>
		);
		expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
	});
});
