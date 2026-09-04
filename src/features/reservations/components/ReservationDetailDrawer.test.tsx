/**
 * Drawer behaviour for corrections on reservations that already happened
 * (TAVLI-71 item 9), plus the duplicate-table-picker regression.
 */
import { ReservationsKeys } from "@/global/i18n";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Doc, Id } from "convex/_generated/dataModel";
import { describe, expect, it, vi } from "vitest";
import { ReservationDetailDrawer } from "./ReservationDetailDrawer";
import { toDateTimeLocalValue } from "../utils";

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

// The picker fans out into Convex queries; the drawer only cares that it is
// (or is not) on screen, and how many times.
vi.mock("./TablePickerForReservation", () => ({
	TablePickerForReservation: () => <div data-testid="table-picker" />,
}));

// Same reason as the picker: the WhatsApp link runs its own Convex query.
// Its behaviour is covered in `ReservationConversationLink.test.tsx`; here it
// only has to not drag a QueryClient into every drawer test.
vi.mock("@/features/whatsapp", () => ({
	ReservationConversationLink: () => <div data-testid="whatsapp-conversation-link" />,
}));

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PAST_START = new Date("2026-03-02T19:00:00").getTime();

function makeReservation(overrides: Partial<Doc<"reservations">> = {}): Doc<"reservations"> {
	return {
		_id: "reservations:1" as Id<"reservations">,
		_creationTime: PAST_START,
		restaurantId: "restaurants:1" as Id<"restaurants">,
		partySize: 2,
		startsAt: PAST_START,
		endsAt: PAST_START + 3 * HOUR_MS,
		tableIds: ["tables:1" as Id<"tables">],
		status: "completed",
		source: "ui",
		contact: { name: "Ada", phone: "+525512345678" },
		createdAt: PAST_START - DAY_MS,
		updatedAt: PAST_START,
		...overrides,
	} as Doc<"reservations">;
}

async function renderDrawer(
	reservation: Doc<"reservations">,
	handlers: Partial<{
		onCancel: ReturnType<typeof vi.fn>;
		onReschedule: ReturnType<typeof vi.fn>;
		onFindTable: ReturnType<typeof vi.fn>;
	}> = {}
) {
	const onCancel = handlers.onCancel ?? vi.fn().mockResolvedValue(undefined);
	const onReschedule = handlers.onReschedule ?? vi.fn().mockResolvedValue(undefined);
	const onFindTable = handlers.onFindTable ?? vi.fn().mockResolvedValue(undefined);
	render(
		<ReservationDetailDrawer
			reservation={reservation}
			onClose={vi.fn()}
			onConfirm={vi.fn().mockResolvedValue(undefined)}
			onReconfirm={vi.fn().mockResolvedValue(undefined)}
			onFindTable={onFindTable}
			onCancel={onCancel}
			onMarkSeated={vi.fn().mockResolvedValue(undefined)}
			onMarkCompleted={vi.fn().mockResolvedValue(undefined)}
			onReschedule={onReschedule}
		/>
	);
	await settle();
	return { onCancel, onReschedule, onFindTable };
}

/**
 * Drawer and Modal are native `<dialog>`s driven by a double-`requestAnimationFrame`
 * phase machine, and the action handlers are async — both settle after the
 * event that triggered them, so tests flush them explicitly.
 */
async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 50));
	});
}

function startInput() {
	return screen.getByLabelText(ReservationsKeys.DRAWER_EDIT_START) as HTMLInputElement;
}

function endInput() {
	return screen.getByLabelText(ReservationsKeys.DRAWER_EDIT_END) as HTMLInputElement;
}

describe("ReservationDetailDrawer — completed reservations", () => {
	it("keeps start and end editable but locks the table assignment", async () => {
		await renderDrawer(makeReservation());

		expect(startInput().value).toBe(toDateTimeLocalValue(PAST_START));
		expect(endInput().value).toBe(toDateTimeLocalValue(PAST_START + 3 * HOUR_MS));
		expect(startInput().disabled).toBe(false);
		expect(endInput().disabled).toBe(false);

		expect(screen.queryByTestId("table-picker")).toBeNull();
		expect(screen.getByText(ReservationsKeys.DRAWER_EDIT_TABLES_LOCKED)).toBeTruthy();
		expect(screen.getByText(ReservationsKeys.DRAWER_EDIT_COMPLETED_HINT)).toBeTruthy();
	});

	it("saves a corrected duration through reschedule, without tableIds", async () => {
		const { onReschedule } = await renderDrawer(makeReservation());

		fireEvent.change(endInput(), {
			target: { value: toDateTimeLocalValue(PAST_START + HOUR_MS) },
		});
		fireEvent.click(screen.getByText(ReservationsKeys.DRAWER_EDIT_SAVE));
		await settle();

		expect(onReschedule).toHaveBeenCalledTimes(1);
		expect(onReschedule).toHaveBeenCalledWith({
			reservationId: "reservations:1",
			startsAt: PAST_START,
			endsAt: PAST_START + HOUR_MS,
		});
	});

	it("mirrors the server checks: end after start, 15-minute minimum", async () => {
		const { onReschedule } = await renderDrawer(makeReservation());

		fireEvent.change(endInput(), {
			target: { value: toDateTimeLocalValue(PAST_START - HOUR_MS) },
		});
		fireEvent.click(screen.getByText(ReservationsKeys.DRAWER_EDIT_SAVE));
		await settle();
		expect(screen.getByText(ReservationsKeys.DRAWER_EDIT_END_BEFORE_START)).toBeTruthy();
		expect(onReschedule).not.toHaveBeenCalled();

		fireEvent.change(endInput(), {
			target: { value: toDateTimeLocalValue(PAST_START + 10 * 60_000) },
		});
		fireEvent.click(screen.getByText(ReservationsKeys.DRAWER_EDIT_SAVE));
		await settle();
		expect(screen.getByText(ReservationsKeys.DRAWER_EDIT_MIN_DURATION)).toBeTruthy();
		expect(onReschedule).not.toHaveBeenCalled();
	});

	it("requires an explicit confirmation before cancelling", async () => {
		const { onCancel } = await renderDrawer(makeReservation());

		expect(screen.queryByText(ReservationsKeys.DRAWER_CANCEL_COMPLETED_TITLE)).toBeNull();

		fireEvent.click(screen.getByText(ReservationsKeys.ACTION_CANCEL));
		await settle();
		// The dialog is up, but nothing has been mutated yet.
		expect(screen.getByText(ReservationsKeys.DRAWER_CANCEL_COMPLETED_TITLE)).toBeTruthy();
		expect(onCancel).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText(ReservationsKeys.DRAWER_CANCEL_REASON_LABEL), {
			target: { value: "wrong booking" },
		});
		fireEvent.click(screen.getByText(ReservationsKeys.ACTION_CONFIRM_CANCEL));
		await settle();

		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(onCancel).toHaveBeenCalledWith("reservations:1", "wrong booking");
	});

	it("backs out of the confirmation without cancelling", async () => {
		const { onCancel } = await renderDrawer(makeReservation());

		fireEvent.click(screen.getByText(ReservationsKeys.ACTION_CANCEL));
		await settle();
		fireEvent.click(screen.getByText(ReservationsKeys.ACTION_BACK));
		await settle();

		expect(onCancel).not.toHaveBeenCalled();
	});
});

describe("ReservationDetailDrawer — table pickers", () => {
	it("renders exactly one picker when a cancelled reservation needs tables to reopen", async () => {
		await renderDrawer(makeReservation({ status: "cancelled", tableIds: [] }));

		expect(screen.getAllByTestId("table-picker")).toHaveLength(1);
	});

	it("renders exactly one picker for an editable booking", async () => {
		await renderDrawer(makeReservation({ status: "confirmed" }));

		expect(screen.getAllByTestId("table-picker")).toHaveLength(1);
	});
});

/**
 * Auto-assignment (TAVLI-101). Two things staff must be able to tell apart: a
 * table a human picked, and one the system picked that nobody has reviewed.
 */
describe("automatic table placement", () => {
	it("flags a machine-chosen table as unreviewed", async () => {
		await renderDrawer(
			makeReservation({ status: "pending", tableAssignedBy: "auto", startsAt: Date.now() })
		);

		expect(screen.getByText(ReservationsKeys.TIMELINE_AUTO_PLACEMENT)).toBeTruthy();
	});

	it("says nothing about a table a human chose", async () => {
		await renderDrawer(
			makeReservation({ status: "pending", tableAssignedBy: "staff", startsAt: Date.now() })
		);

		expect(screen.queryByText(ReservationsKeys.TIMELINE_AUTO_PLACEMENT)).toBeNull();
	});

	it("offers to find a table for a reservation waiting in the queue", async () => {
		const { onFindTable } = await renderDrawer(
			makeReservation({ status: "pending", tableIds: [], startsAt: Date.now() })
		);

		fireEvent.click(screen.getByText(ReservationsKeys.TIMELINE_QUEUE_PLACE));
		await settle();

		expect(onFindTable).toHaveBeenCalledWith("reservations:1");
	});

	it("does not offer to find a table for a reservation that already has one", async () => {
		await renderDrawer(makeReservation({ status: "pending", startsAt: Date.now() }));

		expect(screen.queryByText(ReservationsKeys.TIMELINE_QUEUE_PLACE)).toBeNull();
	});
});
