/**
 * TAVLI-75: "no me deja editar los asientos por mesa cuando se crea una nueva
 * sección." The seats field disabled itself until `Tables to create` left 0,
 * and nothing on screen said why -- so a greyed-out box read as "the app won't
 * let me set seats per table". These tests pin the two halves of the fix: the
 * field is never disabled, and a hint always explains what the single number
 * does (a starting value for every new table, editable table by table after
 * the section exists) or what to do to make it apply.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "convex/_generated/dataModel";
import { describe, expect, it, vi } from "vitest";
import { RestaurantsKeys } from "@/global/i18n";
import en from "@/global/i18n/locales/en.json";
import es from "@/global/i18n/locales/es.json";
import { NewSectionForm } from "./NewSectionForm";

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
	const onCreateSection = vi.fn(async () => {});
	render(<NewSectionForm restaurantId={restaurantId} onCreateSection={onCreateSection} />);
	return { onCreateSection };
}

function seatsInput() {
	return screen.getByLabelText(RestaurantsKeys.SECTIONS_INITIAL_TABLE_SEATS_LABEL);
}

function addOneTable() {
	fireEvent.click(
		screen.getByRole("button", {
			name: `${RestaurantsKeys.SECTIONS_INITIAL_TABLE_COUNT_LABEL} increase`,
		})
	);
}

describe("new-section seats per table", () => {
	it("leaves the seats field enabled while no tables are queued", () => {
		renderSectionForm();

		expect(seatsInput()).toBeEnabled();
	});

	it("stays enabled once tables are queued", () => {
		renderSectionForm();
		addOneTable();

		expect(seatsInput()).toBeEnabled();
	});

	it("explains inline why the number does nothing yet at zero tables", () => {
		renderSectionForm();

		expect(seatsInput()).toHaveAccessibleDescription(
			RestaurantsKeys.SECTIONS_INITIAL_TABLE_SEATS_IDLE_HINT
		);
	});

	it("swaps in the after-creation hint once tables are queued", () => {
		renderSectionForm();
		addOneTable();

		expect(seatsInput()).toHaveAccessibleDescription(
			RestaurantsKeys.SECTIONS_INITIAL_TABLE_SEATS_HINT
		);
		expect(
			screen.queryByText(RestaurantsKeys.SECTIONS_INITIAL_TABLE_SEATS_IDLE_HINT)
		).not.toBeInTheDocument();
	});

	it("snaps an unusable seats value instead of holding a submit-blocking one", () => {
		renderSectionForm();

		fireEvent.change(seatsInput(), { target: { value: "0" } });
		expect(seatsInput()).toHaveValue(1);

		fireEvent.change(seatsInput(), { target: { value: "" } });
		expect(seatsInput()).toHaveValue(4);
	});

	it("sends the edited seats as the capacity for every table it creates", async () => {
		const { onCreateSection } = renderSectionForm();
		addOneTable();
		addOneTable();
		fireEvent.change(seatsInput(), { target: { value: "6" } });

		fireEvent.click(screen.getByRole("button", { name: RestaurantsKeys.SECTIONS_ADD_WITH_TABLES }));

		await waitFor(() =>
			expect(onCreateSection).toHaveBeenCalledWith(
				expect.objectContaining({ initialTableCount: 2, initialTableCapacity: 6 })
			)
		);
	});

	it.each([
		["en", en, "Seats per table"],
		["es", es, "Asientos por mesa"],
	])(
		"labels the field and says in %s that seats stay editable per table",
		(_locale, bundle, label) => {
			const { sections } = bundle.restaurants;

			expect(sections.initialTableSeatsLabel).toBe(label);
			expect(sections.initialTableSeatsHint).not.toBe("");
			// The idle hint has to name the field that unlocks it, not hardcode a
			// second copy of that label.
			expect(sections.initialTableSeatsIdleHint).toContain("{{field}}");
			expect(sections.initialTableSeatsHint).not.toContain("{{field}}");
		}
	);
});
