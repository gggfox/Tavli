/**
 * Pins the schedule grid's timezone behaviour: day headers name the ymd's own
 * day even in a UTC-6 browser, an overnight shift sits in its start day's
 * cell with a "+1" end marker, and a day with shifts still offers "+".
 */
import { render, screen, within } from "@testing-library/react";
import type { Id } from "convex/_generated/dataModel";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AdminStaffKeys } from "@/global/i18n";
import { ymdHmToUtcMs } from "../timezone";
import type { AssignableMember, ScheduledShiftView } from "../types";
import { ScheduleWeekGrid } from "./ScheduleWeekGrid";
import { ShiftCellChip } from "./ShiftCellChip";

vi.mock("react-i18next", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-i18next")>();
	return {
		...actual,
		useTranslation: () => ({
			// Echo the key plus any interpolation values so assertions can see both.
			t: (key: string, opts?: Record<string, unknown>) =>
				opts ? `${key}(${Object.values(opts).join(",")})` : key,
			i18n: { language: "en-US" },
		}),
	};
});

const TZ = "America/Monterrey";
const memberId = "restaurantMembers:1" as Id<"restaurantMembers">;
const member: AssignableMember = {
	memberId,
	userId: "user_1",
	role: "employee",
	email: "ana@example.com",
	displayName: "Ana",
	photoUrl: null,
};

function shiftAt(
	ymd: string,
	startMin: number,
	endYmd: string,
	endMin: number
): ScheduledShiftView {
	return {
		_id: `shifts:${ymd}-${startMin}` as Id<"shifts">,
		memberId,
		restaurantId: "restaurants:1" as Id<"restaurants">,
		startsAt: ymdHmToUtcMs(ymd, startMin, TZ),
		endsAt: ymdHmToUtcMs(endYmd, endMin, TZ),
		status: "published",
		member: null,
	};
}

const originalTz = process.env.TZ;
beforeAll(() => {
	process.env.TZ = TZ;
});
afterAll(() => {
	process.env.TZ = originalTz;
});

describe("ScheduleWeekGrid", () => {
	it("labels Monday 2026-09-28 as the 28th in a UTC-6 browser", () => {
		render(
			<ScheduleWeekGrid
				members={[]}
				shifts={[]}
				mondayYmd="2026-09-28"
				timezone={TZ}
				localeTag="en-US"
			>
				{() => null}
			</ScheduleWeekGrid>
		);
		const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
		expect(headers[1]).toContain("Sep 28");
		expect(headers[7]).toContain("Oct 4");
	});

	it("shows a Sunday-night overnight shift in Sunday's cell and keeps its + button", () => {
		const overnight = shiftAt("2026-10-04", 22 * 60, "2026-10-05", 3 * 60);
		render(
			<ScheduleWeekGrid
				members={[member]}
				shifts={[overnight]}
				mondayYmd="2026-09-28"
				timezone={TZ}
				localeTag="en-US"
				onCreateShift={() => {}}
			>
				{({ shifts, day }) =>
					shifts.map((s) => (
						<span key={s._id} data-testid={`chip-${day.ymd}`}>
							{s._id}
						</span>
					))
				}
			</ScheduleWeekGrid>
		);
		expect(screen.getByTestId("chip-2026-10-04")).toBeInTheDocument();
		const cells = screen.getAllByRole("gridcell");
		const sunday = cells[6];
		expect(within(sunday).getByTestId("chip-2026-10-04")).toBeInTheDocument();
		expect(
			within(sunday).getByRole("button", {
				name: `${AdminStaffKeys.SCHEDULE_GRID_ADD_SHIFT_ARIA}(Ana,2026-10-04)`,
			})
		).toBeInTheDocument();
	});
});

describe("ShiftCellChip", () => {
	it("marks an overnight shift's end with +1", () => {
		render(
			<ShiftCellChip shift={shiftAt("2026-09-28", 18 * 60, "2026-09-29", 2 * 60)} timezone={TZ} />
		);
		const chip = screen.getByRole("button");
		expect(chip).toHaveTextContent(
			`18:00–02:00${AdminStaffKeys.SCHEDULE_CHIP_ENDS_LATER_MARKER}(1)`
		);
		expect(chip.getAttribute("aria-label")).toContain(
			`${AdminStaffKeys.SCHEDULE_CHIP_ENDS_LATER_SUFFIX}(1)`
		);
	});

	it("has no marker for a same-day shift", () => {
		render(
			<ShiftCellChip shift={shiftAt("2026-09-28", 11 * 60, "2026-09-28", 19 * 60)} timezone={TZ} />
		);
		const chip = screen.getByRole("button");
		expect(chip.textContent).not.toContain(AdminStaffKeys.SCHEDULE_CHIP_ENDS_LATER_MARKER);
	});
});
