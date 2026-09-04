import { describe, expect, it } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import { RESERVATION_STATUS, TABLE } from "./constants";
import { placeParty } from "./_util/tablePlacement";

const restaurantId = "rest_1" as Id<typeof TABLE.RESTAURANTS>;

const HOUR = 60 * 60_000;
const T19 = 1_900_000_000_000;
const T20 = T19 + HOUR;
const T21 = T19 + 2 * HOUR;

function table(
	tableNumber: number,
	capacity: number,
	overrides: Partial<Doc<typeof TABLE.TABLES>> = {}
): Doc<typeof TABLE.TABLES> {
	return {
		_id: `table_${tableNumber}` as Id<typeof TABLE.TABLES>,
		_creationTime: 0,
		restaurantId,
		tableNumber,
		capacity,
		isActive: true,
		createdAt: 0,
		...overrides,
	} as Doc<typeof TABLE.TABLES>;
}

function reservation(
	tableIds: Id<typeof TABLE.TABLES>[],
	startsAt: number,
	endsAt: number,
	overrides: Partial<Doc<typeof TABLE.RESERVATIONS>> = {}
): Doc<typeof TABLE.RESERVATIONS> {
	return {
		_id: `res_${startsAt}_${tableIds.join("-")}` as Id<typeof TABLE.RESERVATIONS>,
		_creationTime: 0,
		restaurantId,
		partySize: 2,
		startsAt,
		endsAt,
		tableIds,
		status: RESERVATION_STATUS.CONFIRMED,
		source: "ui",
		contact: { name: "A", phone: "+521" },
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	} as Doc<typeof TABLE.RESERVATIONS>;
}

function numbersOf(tables: Doc<typeof TABLE.TABLES>[] | null): number[] | null {
	return tables === null ? null : tables.map((t) => t.tableNumber);
}

describe("placeParty", () => {
	it("seats the party on the smallest table that fits", () => {
		const placed = placeParty({
			tables: [table(1, 8), table(2, 2), table(3, 4)],
			reservations: [],
			locks: [],
			partySize: 3,
			startsAt: T19,
			endsAt: T20,
		});

		expect(numbersOf(placed)).toEqual([3]);
	});

	it("breaks ties on equal capacity by lowest table number", () => {
		const placed = placeParty({
			tables: [table(7, 4), table(2, 4), table(5, 4)],
			reservations: [],
			locks: [],
			partySize: 4,
			startsAt: T19,
			endsAt: T20,
		});

		expect(numbersOf(placed)).toEqual([2]);
	});

	it("skips a table occupied by an overlapping reservation", () => {
		const placed = placeParty({
			tables: [table(1, 4), table(2, 6)],
			reservations: [reservation(["table_1" as Id<typeof TABLE.TABLES>], T19, T20)],
			locks: [],
			partySize: 4,
			startsAt: T19,
			endsAt: T20,
		});

		expect(numbersOf(placed)).toEqual([2]);
	});

	it("treats a back-to-back reservation as free — exact touch is not a conflict", () => {
		const placed = placeParty({
			tables: [table(1, 4), table(2, 6)],
			reservations: [reservation(["table_1" as Id<typeof TABLE.TABLES>], T19, T20)],
			locks: [],
			partySize: 4,
			startsAt: T20,
			endsAt: T21,
		});

		expect(numbersOf(placed)).toEqual([1]);
	});

	it("ignores cancelled and no-show reservations", () => {
		const placed = placeParty({
			tables: [table(1, 4), table(2, 6)],
			reservations: [
				reservation(["table_1" as Id<typeof TABLE.TABLES>], T19, T20, {
					status: RESERVATION_STATUS.CANCELLED,
				}),
			],
			locks: [],
			partySize: 4,
			startsAt: T19,
			endsAt: T20,
		});

		expect(numbersOf(placed)).toEqual([1]);
	});

	it("skips a table under an overlapping lock", () => {
		const placed = placeParty({
			tables: [table(1, 4), table(2, 6)],
			reservations: [],
			locks: [
				{
					_id: "lock_1" as Id<typeof TABLE.TABLE_LOCKS>,
					_creationTime: 0,
					restaurantId,
					tableId: "table_1" as Id<typeof TABLE.TABLES>,
					startsAt: T19,
					endsAt: T20,
					lockedBy: "user_1",
					createdAt: 0,
				} as Doc<typeof TABLE.TABLE_LOCKS>,
			],
			partySize: 4,
			startsAt: T19,
			endsAt: T20,
		});

		expect(numbersOf(placed)).toEqual([2]);
	});

	it("ignores the reservation being re-placed", () => {
		const own = reservation(["table_1" as Id<typeof TABLE.TABLES>], T19, T20);

		const placed = placeParty({
			tables: [table(1, 4), table(2, 6)],
			reservations: [own],
			locks: [],
			partySize: 4,
			startsAt: T19,
			endsAt: T20,
			excludeReservationId: own._id,
		});

		expect(numbersOf(placed)).toEqual([1]);
	});

	it("splits the party across tables when no single table fits", () => {
		const placed = placeParty({
			tables: [table(1, 6), table(2, 6)],
			reservations: [],
			locks: [],
			partySize: 12,
			startsAt: T19,
			endsAt: T20,
		});

		expect(numbersOf(placed)?.slice().sort()).toEqual([1, 2]);
	});

	it("splits greedily largest-first, taking as few tables as it can", () => {
		const placed = placeParty({
			tables: [table(1, 4), table(2, 8), table(3, 6)],
			reservations: [],
			locks: [],
			partySize: 12,
			startsAt: T19,
			endsAt: T20,
		});

		expect(numbersOf(placed)).toEqual([2, 3]);
	});

	it("returns null when the free tables cannot cover the party", () => {
		const placed = placeParty({
			tables: [table(1, 4), table(2, 4)],
			reservations: [],
			locks: [],
			partySize: 12,
			startsAt: T19,
			endsAt: T20,
		});

		expect(placed).toBeNull();
	});

	it("returns null when every table that fits is occupied", () => {
		const placed = placeParty({
			tables: [table(1, 4)],
			reservations: [reservation(["table_1" as Id<typeof TABLE.TABLES>], T19, T21)],
			locks: [],
			partySize: 4,
			startsAt: T19,
			endsAt: T20,
		});

		expect(placed).toBeNull();
	});

	it("excludes inactive and soft-deleted tables", () => {
		const placed = placeParty({
			tables: [table(1, 4, { isActive: false }), table(2, 4, { deletedAt: 123 }), table(3, 8)],
			reservations: [],
			locks: [],
			partySize: 4,
			startsAt: T19,
			endsAt: T20,
		});

		expect(numbersOf(placed)).toEqual([3]);
	});
});
