import { describe, expect, it } from "vitest";
import type { Id } from "../../../../convex/_generated/dataModel";
import { findCollidingReservationIds } from "./collisions";

type ReservationId = Id<"reservations">;

const HOUR = 60 * 60_000;
const T19 = 1_900_000_000_000;

function res(
	id: string,
	startsAt: number,
	endsAt: number,
	status = "confirmed"
): {
	_id: ReservationId;
	startsAt: number;
	endsAt: number;
	status: string;
} {
	return { _id: id as ReservationId, startsAt, endsAt, status };
}

describe("findCollidingReservationIds", () => {
	it("finds nothing when reservations merely sit side by side", () => {
		const colliding = findCollidingReservationIds([
			res("a", T19, T19 + HOUR),
			res("b", T19 + 2 * HOUR, T19 + 3 * HOUR),
		]);

		expect(colliding.size).toBe(0);
	});

	it("treats an exact handover as clean — a table freed at 20:00 is bookable at 20:00", () => {
		const colliding = findCollidingReservationIds([
			res("a", T19, T19 + HOUR),
			res("b", T19 + HOUR, T19 + 2 * HOUR),
		]);

		expect(colliding.size).toBe(0);
	});

	it("flags the later-starting card of an overlapping pair", () => {
		const colliding = findCollidingReservationIds([
			res("early", T19, T19 + 2 * HOUR),
			res("late", T19 + HOUR, T19 + 3 * HOUR),
		]);

		expect([...colliding]).toEqual(["late"]);
	});

	it("does not care what order the input arrives in", () => {
		const colliding = findCollidingReservationIds([
			res("late", T19 + HOUR, T19 + 3 * HOUR),
			res("early", T19, T19 + 2 * HOUR),
		]);

		expect([...colliding]).toEqual(["late"]);
	});

	it("flags every card in a pile-up, not just the last one", () => {
		const colliding = findCollidingReservationIds([
			res("a", T19, T19 + 3 * HOUR),
			res("b", T19 + HOUR, T19 + 4 * HOUR),
			res("c", T19 + 2 * HOUR, T19 + 5 * HOUR),
		]);

		expect(colliding).toEqual(new Set(["b", "c"]));
	});

	it("ignores cancelled and no-show cards sitting under a live one", () => {
		const colliding = findCollidingReservationIds([
			res("live", T19, T19 + 2 * HOUR),
			res("gone", T19 + HOUR, T19 + 3 * HOUR, "cancelled"),
			res("absent", T19 + HOUR, T19 + 3 * HOUR, "no_show"),
		]);

		expect(colliding.size).toBe(0);
	});

	it("counts a completed visit as still holding its table", () => {
		const colliding = findCollidingReservationIds([
			res("done", T19, T19 + 2 * HOUR, "completed"),
			res("late", T19 + HOUR, T19 + 3 * HOUR),
		]);

		expect([...colliding]).toEqual(["late"]);
	});
});
