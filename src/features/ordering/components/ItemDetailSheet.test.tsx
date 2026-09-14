/* eslint-disable boundaries/no-unknown-files, @typescript-eslint/no-explicit-any */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/react-query", () => ({ convexQuery: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }) }));
vi.mock("convex/_generated/api", () => ({
	api: { optionGroups: { getGroupsForMenuItem: {} }, menuItems: {} },
}));

import { ItemDetailSheet } from "./ItemDetailSheet";

const item = {
	_id: "menuItems:1",
	name: "Rib eye",
	basePrice: 100000,
	imageUrl: "https://x/rib.jpg",
	imageSource: "generated",
	isAvailable: true,
} as any;

describe("ItemDetailSheet", () => {
	it("discloses an AI-generated image", () => {
		render(<ItemDetailSheet item={item} onClose={() => {}} onAddToCart={() => {}} />);
		expect(screen.getByText(/AI-generated/i)).toBeTruthy();
	});
});
