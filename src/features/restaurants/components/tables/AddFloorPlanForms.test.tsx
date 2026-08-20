/**
 * TAVLI-76: the two floor-plan add actions used to be indistinguishable — both
 * were `Plus`-icon primary buttons in one undifferentiated stack, so a manager
 * could fire "Add section" (which creates up to 50 tables) meaning to add one
 * table. These tests pin the differentiators: weight, icon, and a section
 * label that counts the tables it is about to create.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "convex/_generated/dataModel";
import { describe, expect, it, vi } from "vitest";
import { RestaurantsKeys } from "@/global/i18n";
import en from "@/global/i18n/locales/en.json";
import es from "@/global/i18n/locales/es.json";
import { NewSectionForm } from "./NewSectionForm";
import { NewTableForm } from "./NewTableForm";

vi.mock("react-i18next", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-i18next")>();
	return {
		...actual,
		useTranslation: () => ({
			t: (key: string) => key,
			i18n: { language: "en" },
		}),
	};
});

const restaurantId = "restaurants:1" as Id<"restaurants">;

function renderSectionForm() {
	return render(
		<NewSectionForm restaurantId={restaurantId} onCreateSection={vi.fn(async () => {})} />
	);
}

function renderTableForm() {
	return render(
		<NewTableForm
			restaurantId={restaurantId}
			nextTableNumber={1}
			sections={[]}
			sectionLabel={() => "Section 1"}
			onCreate={vi.fn(async () => {})}
		/>
	);
}

describe("floor-plan add actions", () => {
	it("gives the two submit buttons a different weight and icon", () => {
		const section = renderSectionForm();
		const table = renderTableForm();

		const sectionButton = section.getByRole("button", { name: RestaurantsKeys.SECTIONS_ADD });
		const tableButton = table.getByRole("button", { name: RestaurantsKeys.TABLES_ADD });

		expect(sectionButton.className).toContain("hover-btn-primary");
		expect(tableButton.className).not.toContain("hover-btn-primary");
		expect(tableButton.className).toContain("hover-btn-secondary");

		const sectionIcon = sectionButton.querySelector("svg")?.getAttribute("class");
		const tableIcon = tableButton.querySelector("svg")?.getAttribute("class");
		expect(sectionIcon).toBeTruthy();
		expect(tableIcon).toBeTruthy();
		expect(sectionIcon).not.toEqual(tableIcon);
	});

	it("counts the tables the section button is about to create", () => {
		renderSectionForm();

		expect(screen.getByRole("button", { name: RestaurantsKeys.SECTIONS_ADD })).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole("button", {
				name: `${RestaurantsKeys.SECTIONS_INITIAL_TABLE_COUNT_LABEL} increase`,
			})
		);

		expect(
			screen.getByRole("button", { name: RestaurantsKeys.SECTIONS_ADD_WITH_TABLES })
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: RestaurantsKeys.SECTIONS_ADD })
		).not.toBeInTheDocument();
	});

	it("says what the single-table form does", () => {
		renderTableForm();

		expect(screen.getByText(RestaurantsKeys.TABLES_ADD_HEADING)).toBeInTheDocument();
		expect(screen.getByText(RestaurantsKeys.TABLES_ADD_HINT)).toBeInTheDocument();
	});

	it.each([
		["en", en],
		["es", es],
	])("keeps the %s labels distinct in copy, not just in styling", (_locale, bundle) => {
		const { sections, tables } = bundle.restaurants;

		expect(sections.add).not.toEqual(tables.add);
		expect(sections.addWithTables_one).toContain("{{count}}");
		expect(sections.addWithTables_other).toContain("{{count}}");
	});
});
