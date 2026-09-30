/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * The item editor's one Guardar: fields, visibility, option groups and the
 * image are one draft, committed together. Rendered through the desktop
 * inspector; the dialog shares the same draft, fields and footer.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	generation: null as any,
	linkedGroups: [] as any[],
	allGroups: [] as any[],
	update: vi.fn(async (_args: any) => ["item", null]),
	removeImage: vi.fn(async (_args: any) => [null, null]),
	approve: vi.fn(async (_args: any) => [null, null]),
	reject: vi.fn(async (_args: any) => [null, null]),
	start: vi.fn(async (_args: any) => [{ jobId: "j1", attempt: 1, remainingThisMonth: 99 }, null]),
	createGroup: vi.fn(async (_args: any) => ["optionGroups:new", null]),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: any, args: any) => ({ ref, args }),
	useConvexMutation: () => vi.fn(async () => ["https://upload", null]),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ ref }: any) => {
		const data =
			ref.name === "getItemGeneration"
				? hoisted.generation
				: ref.name === "getGroupsForMenuItem"
					? hoisted.linkedGroups
					: hoisted.allGroups;
		return { data, isPending: false, isError: false, isSuccess: true };
	},
}));
vi.mock("convex/_generated/api", () => ({
	api: {
		menuAIImageGen: {
			getItemGeneration: { name: "getItemGeneration" },
			startGeneration: { name: "startGeneration" },
			approveDraft: { name: "approveDraft" },
			rejectDraft: { name: "rejectDraft" },
		},
		menuItems: {
			update: { name: "update" },
			removeImage: { name: "removeImage" },
			generateUploadUrl: { name: "generateUploadUrl" },
		},
		optionGroups: {
			getGroupsForMenuItem: { name: "getGroupsForMenuItem" },
			getGroupsByRestaurant: { name: "getGroupsByRestaurant" },
			createGroup: { name: "createGroup" },
		},
	},
}));
vi.mock("@/global/hooks", () => ({
	useConvexMutate: (ref: any) => {
		const fns: Record<string, any> = {
			update: hoisted.update,
			removeImage: hoisted.removeImage,
			approveDraft: hoisted.approve,
			rejectDraft: hoisted.reject,
			startGeneration: hoisted.start,
			createGroup: hoisted.createGroup,
		};
		return { mutateAsync: fns[ref.name], isPending: false };
	},
}));
vi.mock("../OptionGroupManagerModal", () => ({ OptionGroupManagerModal: () => null }));

import { ItemEditorInspector } from "./ItemEditorInspector";

const group = (id: string, name: string, displayOrder: number) => ({
	_id: id,
	name,
	displayOrder,
	selectionType: "single",
});

const ITEM = {
	_id: "menuItems:1",
	restaurantId: "restaurants:1",
	categoryId: "menuCategories:1",
	name: "Rib eye",
	description: "un delicioso corte",
	basePrice: 100000,
	isAvailable: true,
	prepStation: "kitchen",
	imageUrl: "https://img/ribeye.jpg",
	imageSource: "uploaded",
	displayOrder: 0,
} as any;

function renderEditor(onClose = vi.fn()) {
	render(<ItemEditorInspector item={ITEM} categoryName="Carnes" onClose={onClose} />);
	return { onClose };
}

const saveButton = () => screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;

describe("item editor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hoisted.generation = {
			activeJob: null,
			pendingDraft: null,
			attemptCount: 0,
			remainingThisMonth: 100,
			monthlyLimit: 100,
		};
		hoisted.allGroups = [group("og:termino", "Termino", 0), group("og:tamano", "Tamaño", 1)];
		hoisted.linkedGroups = [{ ...hoisted.allGroups[0], linkDisplayOrder: 0 }];
	});

	it("puts name and price on one row", () => {
		renderEditor();
		const name = screen.getByLabelText(/^name$/i);
		const price = screen.getByLabelText(/^price$/i);
		// Both fields sit in the same two-column grid.
		expect(name.closest(".grid")).toBe(price.closest(".grid"));
	});

	it("keeps Save disabled until something changes", () => {
		renderEditor();
		expect(saveButton().disabled).toBe(true);
		fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Rib eye 400g" } });
		expect(saveButton().disabled).toBe(false);
	});

	it("saves fields, visibility and option groups in one update, sending only what changed", async () => {
		const { onClose } = renderEditor();
		fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: "1200.50" } });
		fireEvent.click(screen.getByRole("radio", { name: /bar/i }));
		fireEvent.click(screen.getByRole("switch"));
		fireEvent.click(screen.getByRole("button", { name: /tamaño/i }));
		fireEvent.click(screen.getByRole("button", { name: /termino/i }));

		fireEvent.click(saveButton());

		await waitFor(() => expect(hoisted.update).toHaveBeenCalledTimes(1));
		expect(hoisted.update).toHaveBeenCalledWith({
			itemId: "menuItems:1",
			basePrice: 120050,
			prepStation: "bar",
			isAvailable: false,
			optionGroupIds: ["og:tamano"],
		});
		// Option groups are no longer written on toggle.
		expect(hoisted.createGroup).not.toHaveBeenCalled();
		await waitFor(() => expect(onClose).toHaveBeenCalled());
	});

	it("marks the selected station with aria-checked", () => {
		renderEditor();
		expect(screen.getByRole("radio", { name: /kitchen/i }).getAttribute("aria-checked")).toBe(
			"true"
		);
		expect(screen.getByRole("radio", { name: /bar/i }).getAttribute("aria-checked")).toBe("false");
	});

	it("shows a pending AI draft as unsaved and approves it on Save", async () => {
		hoisted.generation = {
			...hoisted.generation,
			pendingDraft: { draftId: "d1", imageUrl: "https://x/d1.jpg", attempt: 1, prompt: "p" },
		};
		renderEditor();
		const img = screen.getByRole("img", { name: "Rib eye" }) as HTMLImageElement;
		expect(img.src).toBe("https://x/d1.jpg");
		expect(screen.getByText(/ai draft/i)).toBeTruthy();
		expect(saveButton().disabled).toBe(false);

		fireEvent.click(saveButton());
		await waitFor(() => expect(hoisted.approve).toHaveBeenCalledWith({ draftId: "d1" }));
		// Nothing else changed, so no field update is sent.
		expect(hoisted.update).not.toHaveBeenCalled();
	});

	it("discarding an AI draft rejects it right away", async () => {
		hoisted.generation = {
			...hoisted.generation,
			pendingDraft: { draftId: "d1", imageUrl: "https://x/d1.jpg", attempt: 1, prompt: "p" },
		};
		renderEditor();
		fireEvent.click(screen.getByRole("button", { name: /discard/i }));
		await waitFor(() => expect(hoisted.reject).toHaveBeenCalledWith({ draftId: "d1" }));
	});

	it("removing the photo waits for Save, then removes it", async () => {
		renderEditor();
		fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
		expect(hoisted.removeImage).not.toHaveBeenCalled();
		expect(screen.getByText(/drop a photo here/i)).toBeTruthy();

		fireEvent.click(saveButton());
		await waitFor(() =>
			expect(hoisted.removeImage).toHaveBeenCalledWith({ itemId: "menuItems:1" })
		);
	});

	it("starts a generation and shows progress with the attempt number", async () => {
		const { unmount } = render(
			<ItemEditorInspector item={ITEM} categoryName="Carnes" onClose={vi.fn()} />
		);
		fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));
		await waitFor(() => expect(hoisted.start).toHaveBeenCalledWith({ menuItemId: "menuItems:1" }));
		unmount();

		hoisted.generation = {
			...hoisted.generation,
			activeJob: { jobId: "j", status: "running", attempt: 2 },
		};
		renderEditor();
		expect(screen.getByText(/attempt 2/i)).toBeTruthy();
	});

	it("explains a failure, and hides generation when the monthly limit is zero", () => {
		hoisted.generation = {
			...hoisted.generation,
			activeJob: { jobId: "j", status: "failed", attempt: 1, error: "credits_exhausted" },
		};
		const { unmount } = render(
			<ItemEditorInspector item={ITEM} categoryName="Carnes" onClose={vi.fn()} />
		);
		expect(screen.getByText(/credits are exhausted/i)).toBeTruthy();
		unmount();

		hoisted.generation = { ...hoisted.generation, activeJob: null, monthlyLimit: 0 };
		renderEditor();
		expect(screen.getByText(/switched off/i)).toBeTruthy();
		expect(screen.queryByRole("button", { name: /generate with ai/i })).toBeNull();
	});

	it("a group created in the editor joins the draft instead of being linked immediately", async () => {
		renderEditor();
		fireEvent.click(screen.getByRole("button", { name: /new group/i }));
		const section = screen.getByText(/options the diner chooses/i).closest("section")!;
		fireEvent.change(within(section).getByRole("textbox"), { target: { value: "Salsa" } });
		fireEvent.click(within(section).getByRole("button", { name: /create/i }));
		await waitFor(() => expect(hoisted.createGroup).toHaveBeenCalled());

		fireEvent.click(saveButton());
		await waitFor(() =>
			expect(hoisted.update).toHaveBeenCalledWith({
				itemId: "menuItems:1",
				optionGroupIds: ["og:termino", "optionGroups:new"],
			})
		);
	});

	it("asks before discarding unsaved changes on close", () => {
		const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
		const { onClose } = renderEditor();
		fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "X" } });
		fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
		expect(confirmSpy).toHaveBeenCalled();
		expect(onClose).not.toHaveBeenCalled();
		confirmSpy.mockRestore();
	});
});
