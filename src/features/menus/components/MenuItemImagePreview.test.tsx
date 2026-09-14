/* eslint-disable boundaries/no-unknown-files */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MenuItemImagePreview } from "./MenuItemImagePreview";

describe("MenuItemImagePreview", () => {
	it("marks a generated image with an AI badge", () => {
		render(
			<MenuItemImagePreview imageUrl="https://x/a.jpg" itemName="Rib eye" imageSource="generated" />
		);
		expect(screen.getByText("AI")).toBeTruthy();
	});

	it("shows no badge for an uploaded image", () => {
		render(
			<MenuItemImagePreview imageUrl="https://x/a.jpg" itemName="Rib eye" imageSource="uploaded" />
		);
		expect(screen.queryByText("AI")).toBeNull();
	});
});
