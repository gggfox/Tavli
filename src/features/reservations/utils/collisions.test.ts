import { describe, expect, it } from "vitest";
import {
	WALK_IN_LOCK_REASON,
	findCollisions,
	findCollisionsForTable,
	findDoubleBookedReservationIds,
	windowsOverlap,
} from "./collisions";

const at = (h: number) => new Date(2026, 0, 1, h).getTime();
const walkIn = (id: string, from: number, to: number) => ({
	_id: id,
	reason: WALK_IN_LOCK_REASON,
	startsAt: from,
	endsAt: to,
});
const booking = (id: string, from: number, to: number) => ({
	_id: id,
	startsAt: from,
	endsAt: to,
});

describe("windowsOverlap", () => {
	it("treats windows as half-open, so back-to-back turns do not collide", () => {
		// A table freed at 8 and rebooked at 8 is the normal case, not a clash.
		// Inclusive bounds would paint every clean handover red.
		expect(
			windowsOverlap({ startsAt: at(6), endsAt: at(8) }, { startsAt: at(8), endsAt: at(10) })
		).toBe(false);
	});

	it("detects real overlap in both directions", () => {
		const a = { startsAt: at(6), endsAt: at(9) };
		const b = { startsAt: at(8), endsAt: at(10) };
		expect(windowsOverlap(a, b)).toBe(true);
		expect(windowsOverlap(b, a)).toBe(true);
	});

	it("detects containment", () => {
		expect(
			windowsOverlap({ startsAt: at(6), endsAt: at(12) }, { startsAt: at(8), endsAt: at(9) })
		).toBe(true);
	});
});

describe("findCollisionsForTable", () => {
	it("flags both sides, because a collision is a relationship", () => {
		// Colouring only the booking leaves a manager staring at a red bar with
		// no visible cause; colouring only the walk-in says a table is busy
		// without saying what that costs.
		const result = findCollisionsForTable({
			reservations: [booking("r1", at(19), at(21))],
			locks: [walkIn("l1", at(18), at(20))],
		});
		expect([...result.collidingReservationIds]).toEqual(["r1"]);
		expect([...result.collidingLockIds]).toEqual(["l1"]);
	});

	it("ignores a lock a human created", () => {
		// A manager who blocked a table for a private event and booked it anyway
		// has made a decision. Flagging that is the software second-guessing the
		// person holding the floor plan.
		const result = findCollisionsForTable({
			reservations: [booking("r1", at(19), at(21))],
			locks: [{ _id: "l1", reason: "private event", startsAt: at(18), endsAt: at(20) }],
		});
		expect(result.collidingReservationIds.size).toBe(0);
		expect(result.collidingLockIds.size).toBe(0);
	});

	it("says nothing when the windows do not touch", () => {
		const result = findCollisionsForTable({
			reservations: [booking("r1", at(21), at(23))],
			locks: [walkIn("l1", at(18), at(20))],
		});
		expect(result.collidingReservationIds.size).toBe(0);
	});

	it("flags every booking a single walk-in runs across", () => {
		const result = findCollisionsForTable({
			reservations: [booking("r1", at(19), at(20)), booking("r2", at(20), at(21))],
			locks: [walkIn("l1", at(18), at(22))],
		});
		expect([...result.collidingReservationIds].sort()).toEqual(["r1", "r2"]);
	});
});

describe("findCollisions", () => {
	it("never compares across tables", () => {
		// A walk-in on table 4 says nothing about a booking on table 9.
		// Comparing across tables would flag every busy service as one enormous
		// collision.
		const result = findCollisions(
			new Map([["table-9", [booking("r1", at(19), at(21))]]]),
			new Map([["table-4", [walkIn("l1", at(19), at(21))]]])
		);
		expect(result.collidingReservationIds.size).toBe(0);
		expect(result.collidingLockIds.size).toBe(0);
	});

	it("rolls up clashes per table", () => {
		const result = findCollisions(
			new Map([
				["t1", [booking("r1", at(19), at(21))]],
				["t2", [booking("r2", at(19), at(21))]],
			]),
			new Map([
				["t1", [walkIn("l1", at(18), at(20))]],
				["t2", [walkIn("l2", at(22), at(23))]],
			])
		);
		expect([...result.collidingReservationIds]).toEqual(["r1"]);
		expect([...result.collidingLockIds]).toEqual(["l1"]);
	});

	it("clears once the clash is resolved, with no second action", () => {
		// The whole reason this is derived. A stored flag would need explicitly
		// clearing, and the one that gets missed teaches everyone to ignore red.
		expect(
			findCollisions(
				new Map([["t1", [booking("r1", at(19), at(21))]]]),
				new Map([["t1", [walkIn("l1", at(18), at(20))]]])
			).collidingReservationIds.size
		).toBe(1);

		// Manager drags the booking later. Nothing else is touched.
		expect(
			findCollisions(
				new Map([["t1", [booking("r1", at(22), at(23))]]]),
				new Map([["t1", [walkIn("l1", at(18), at(20))]]])
			).collidingReservationIds.size
		).toBe(0);
	});

	it("is quiet on an empty timeline", () => {
		expect(findCollisions(new Map(), new Map()).collidingReservationIds.size).toBe(0);
	});
});

/**
 * The other kind of clash: two bookings against each other on one table
 * (TAVLI-101). A walk-in collision is the floor disagreeing with the book; this
 * is the book disagreeing with itself.
 */
describe("findDoubleBookedReservationIds", () => {
	const res = (id: string, from: number, to: number, status = "confirmed") => ({
		_id: id,
		startsAt: from,
		endsAt: to,
		status,
	});

	it("finds nothing when bookings merely sit side by side", () => {
		expect(
			findDoubleBookedReservationIds([res("a", at(19), at(20)), res("b", at(21), at(22))]).size
		).toBe(0);
	});

	it("treats an exact handover as clean", () => {
		expect(
			findDoubleBookedReservationIds([res("a", at(19), at(20)), res("b", at(20), at(21))]).size
		).toBe(0);
	});

	it("flags the later-starting booking of an overlapping pair", () => {
		expect([
			...findDoubleBookedReservationIds([
				res("early", at(19), at(21)),
				res("late", at(20), at(22)),
			]),
		]).toEqual(["late"]);
	});

	it("does not care what order the input arrives in", () => {
		expect([
			...findDoubleBookedReservationIds([
				res("late", at(20), at(22)),
				res("early", at(19), at(21)),
			]),
		]).toEqual(["late"]);
	});

	it("flags every booking in a pile-up, not just the last", () => {
		// Flagging only the last would leave the middle one looking clean while it
		// is equally half of a double-booking.
		expect(
			findDoubleBookedReservationIds([
				res("a", at(17), at(20)),
				res("b", at(18), at(21)),
				res("c", at(19), at(22)),
			])
		).toEqual(new Set(["b", "c"]));
	});

	it("ignores cancelled and no-show bookings sitting under a live one", () => {
		expect(
			findDoubleBookedReservationIds([
				res("live", at(19), at(21)),
				res("gone", at(20), at(22), "cancelled"),
				res("absent", at(20), at(22), "no_show"),
			]).size
		).toBe(0);
	});

	it("counts a completed visit as still holding its table", () => {
		// `completed` is in ACTIVE_RESERVATION_STATUSES: the table stays held for
		// the whole window so a mistyped duration surfaces rather than hiding.
		expect([
			...findDoubleBookedReservationIds([
				res("done", at(19), at(21), "completed"),
				res("late", at(20), at(22)),
			]),
		]).toEqual(["late"]);
	});

	it("treats a row with no status as active, for callers that do not track it", () => {
		expect(
			findDoubleBookedReservationIds([
				{ _id: "a", startsAt: at(19), endsAt: at(21) },
				{ _id: "b", startsAt: at(20), endsAt: at(22) },
			]).size
		).toBe(1);
	});
});

describe("findCollisions across both kinds", () => {
	it("finds a double-booking on a table carrying no lock at all", () => {
		// The walk-in pass iterates locks, so a table with none would never be
		// visited by it.
		const result = findCollisions(
			new Map([["t1", [booking("r1", at(19), at(21)), booking("r2", at(20), at(22))]]]),
			new Map()
		);
		expect([...result.collidingReservationIds]).toEqual(["r2"]);
	});
});
