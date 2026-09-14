/* eslint-disable boundaries/no-unknown-files */
import { describe, expect, it } from "vitest";
import {
	countAvailableByCategory,
	firstImageByCategory,
	isItemAvailableToday,
	partitionByPhoto,
} from "./menuLayout";

describe("partitionByPhoto", () => {
	// The mixed-menu rule: on a menu where most dishes have no picture, the
	// ones that do get a card and the rest collapse to rows — instead of a wall
	// of placeholder tiles. Order within each half is preserved.
	it("splits photographed items from the rest, keeping order", () => {
		const items = [
			{ _id: "a", imageUrl: undefined },
			{ _id: "b", imageUrl: "https://x/b.jpg" },
			{ _id: "c", imageUrl: undefined },
			{ _id: "d", imageUrl: "https://x/d.jpg" },
		];
		const { withPhoto, withoutPhoto } = partitionByPhoto(items);
		expect(withPhoto.map((i) => i._id)).toEqual(["b", "d"]);
		expect(withoutPhoto.map((i) => i._id)).toEqual(["a", "c"]);
	});

	it("treats an empty image url as no photo", () => {
		const { withPhoto, withoutPhoto } = partitionByPhoto([{ _id: "a", imageUrl: "" }]);
		expect(withPhoto).toEqual([]);
		expect(withoutPhoto.map((i) => i._id)).toEqual(["a"]);
	});
});

describe("isItemAvailableToday", () => {
	const MONDAY = 1;
	const SUNDAY = 0;

	it("hides an item the restaurant has switched off", () => {
		expect(isItemAvailableToday({ isAvailable: false, availableDays: [] }, MONDAY)).toBe(false);
	});

	it("shows an item with no day restriction every day", () => {
		expect(isItemAvailableToday({ isAvailable: true, availableDays: [] }, SUNDAY)).toBe(true);
		expect(isItemAvailableToday({ isAvailable: true }, SUNDAY)).toBe(true);
	});

	it("honours a day restriction", () => {
		const weekdaysOnly = { isAvailable: true, availableDays: [1, 2, 3, 4, 5] };
		expect(isItemAvailableToday(weekdaysOnly, MONDAY)).toBe(true);
		expect(isItemAvailableToday(weekdaysOnly, SUNDAY)).toBe(false);
	});
});

describe("countAvailableByCategory", () => {
	// Counts feed the desktop rail and the full-menu sheet. They must agree with
	// what the section actually renders, so they use the same availability rule.
	it("counts only items on the menu today, per category", () => {
		const items = [
			{ categoryId: "meats", isAvailable: true },
			{ categoryId: "meats", isAvailable: false },
			{ categoryId: "meats", isAvailable: true, availableDays: [6] },
			{ categoryId: "soups", isAvailable: true },
		];
		const counts = countAvailableByCategory(items, 1);
		expect(counts.get("meats")).toBe(1);
		expect(counts.get("soups")).toBe(1);
		expect(counts.get("drinks")).toBeUndefined();
	});
});

describe("firstImageByCategory", () => {
	it("picks the lowest-displayOrder photo in each category as its tile", () => {
		const items = [
			{ categoryId: "meats", imageUrl: "b.jpg", displayOrder: 2 },
			{ categoryId: "meats", imageUrl: "a.jpg", displayOrder: 1 },
			{ categoryId: "soups", imageUrl: undefined, displayOrder: 1 },
		];
		const tiles = firstImageByCategory(items);
		expect(tiles.get("meats")).toBe("a.jpg");
		expect(tiles.has("soups")).toBe(false);
	});
});
