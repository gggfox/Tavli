/**
 * TAVLI-77: editing a table's number and seats used to live only inside the
 * row's kebab, while the one pencil on screen (in the section header) merely
 * renamed the section. These tests pin the new arrangement: a visible pencil
 * per table row, a kebab reduced to activate/deactivate + remove, a section
 * header icon that no longer impersonates "edit", and an edit row whose
 * number/seats inputs carry rendered labels rather than placeholders.
 */
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Doc, Id } from "convex/_generated/dataModel";
import { describe, expect, it, vi } from "vitest";
import { DraggableTableRow } from "./DraggableTableRow";
import { SectionCard } from "./SectionCard";
import { TableEditRow } from "./TableEditRow";

const table: Doc<"tables"> = {
	_id: "tables:1" as Id<"tables">,
	_creationTime: 0,
	restaurantId: "restaurants:1" as Id<"restaurants">,
	tableNumber: 4,
	capacity: 2,
	isActive: true,
	createdAt: 0,
};

const section: Doc<"sections"> = {
	_id: "sections:1" as Id<"sections">,
	_creationTime: 0,
	restaurantId: "restaurants:1" as Id<"restaurants">,
	name: "Patio",
	displayOrder: 0,
	isActive: true,
	createdAt: 0,
	updatedAt: 0,
};

const rowLabels = {
	table: "Table 4",
	seatsFormat: "2 seats",
	editTitle: "Edit table",
	removeTitle: "Remove",
	activateTitle: "Deactivate",
	moveTableAria: "Move table",
	rowActionsAria: "Table actions",
};

function renderRow(overrides: Partial<Parameters<typeof DraggableTableRow>[0]> = {}) {
	return render(
		<DndContext>
			<DraggableTableRow
				table={table}
				dragHandleLabel="Drag table"
				sectionsList={[section]}
				sectionLabel={() => "Patio"}
				onAssignSection={vi.fn()}
				onStartEdit={vi.fn()}
				onToggleActive={vi.fn()}
				onRemove={vi.fn()}
				isKebabOpen={false}
				onOpenKebab={vi.fn()}
				onCloseKebab={vi.fn()}
				labels={rowLabels}
				{...overrides}
			/>
		</DndContext>
	);
}

function renderSection() {
	return render(
		<DndContext>
			<SortableContext items={[]}>
				<SectionCard
					section={section}
					isEditing={false}
					initialRenameValue="Patio"
					tables={[]}
					isDraggingTable={false}
					sectionLabel="Patio"
					translations={{
						tableCount: "0 tables",
						dropHere: "Drop here",
						renameTitle: "Rename section",
						deleteTitle: "Delete section",
						save: "Save",
						cancel: "Cancel",
						dragHandle: "Drag section",
						renamePlaceholder: "Section name",
						hideTitle: "Hide section",
						showTitle: "Show section",
						hiddenBadge: "Hidden",
					}}
					onStartRename={vi.fn()}
					onCancelRename={vi.fn()}
					onSubmitRename={vi.fn()}
					onRemove={vi.fn()}
					onToggleHidden={vi.fn()}
					renderTableRow={() => <div />}
				/>
			</SortableContext>
		</DndContext>
	);
}

describe("table row controls", () => {
	it("opens the table editor from a pencil on the row, with no kebab in the way", () => {
		const onStartEdit = vi.fn();
		renderRow({ onStartEdit });

		expect(screen.queryByRole("menu")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: rowLabels.editTitle }));

		expect(onStartEdit).toHaveBeenCalledTimes(1);
	});

	it("leaves the kebab holding activate/deactivate and remove only", () => {
		renderRow({ isKebabOpen: true });

		const menu = within(screen.getByRole("menu"));

		expect(menu.getByRole("button", { name: rowLabels.activateTitle })).toBeInTheDocument();
		expect(menu.getByRole("button", { name: rowLabels.removeTitle })).toBeInTheDocument();
		expect(menu.queryByRole("button", { name: rowLabels.editTitle })).not.toBeInTheDocument();
	});

	it("hides the row controls in selection mode", () => {
		renderRow({ selectionMode: true });

		expect(screen.queryByRole("button", { name: rowLabels.editTitle })).not.toBeInTheDocument();
	});

	it("does not reuse the table-edit pencil for the section rename action", () => {
		const row = renderRow();
		const sectionCard = renderSection();

		const editIcon = row
			.getByRole("button", { name: rowLabels.editTitle })
			.querySelector("svg")
			?.getAttribute("class");
		const renameIcon = sectionCard
			.getByRole("button", { name: "Rename section" })
			.querySelector("svg")
			?.getAttribute("class");

		expect(editIcon).toBeTruthy();
		expect(renameIcon).toBeTruthy();
		expect(renameIcon).not.toEqual(editIcon);
	});
});

describe("table edit row", () => {
	it("labels both number and seats with rendered <label> elements", () => {
		render(
			<TableEditRow
				table={table}
				onSubmit={vi.fn()}
				onCancel={vi.fn()}
				labels={{
					numberLabel: "Table #",
					seatsLabel: "Seats",
					save: "Save",
					cancel: "Cancel",
				}}
			/>
		);

		expect(screen.getByText("Seats").tagName).toBe("LABEL");
		expect(screen.getByText("Table #").tagName).toBe("LABEL");
		expect(screen.getByLabelText("Seats")).toHaveValue(2);
		expect(screen.getByLabelText("Table #")).toHaveValue(4);
	});

	it("still saves the edited number and seats", () => {
		const onSubmit = vi.fn();
		render(
			<TableEditRow
				table={table}
				onSubmit={onSubmit}
				onCancel={vi.fn()}
				labels={{
					numberLabel: "Table #",
					seatsLabel: "Seats",
					save: "Save",
					cancel: "Cancel",
				}}
			/>
		);

		fireEvent.change(screen.getByLabelText("Table #"), { target: { value: "9" } });
		fireEvent.change(screen.getByLabelText("Seats"), { target: { value: "6" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(onSubmit).toHaveBeenCalledWith({ tableNumber: 9, capacity: 6 });
	});
});
