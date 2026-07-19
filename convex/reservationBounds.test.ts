import { describe, expect, it } from "vitest";
import type { Id } from "./_generated/dataModel";
import { RESERVATION_SOURCE, TABLE } from "./constants";
import {
	attemptLimitForSource,
	isBookablePartySize,
	MAX_PARTY_SIZE,
	RESERVATION_CREATE_ATTEMPT_LIMIT,
	RESERVATION_CREATE_ATTEMPT_LIMIT_BOT,
	reservationCreateRateLimitKeys,
	windowIntersectsHorizon,
} from "./reservationHelpers";

const restaurantId = "rest_1" as Id<typeof TABLE.RESTAURANTS>;

describe("isBookablePartySize", () => {
	it("accepts positive integers within the cap", () => {
		expect(isBookablePartySize(1)).toBe(true);
		expect(isBookablePartySize(2)).toBe(true);
		expect(isBookablePartySize(MAX_PARTY_SIZE)).toBe(true);
	});

	it("rejects zero, negatives, and sizes above the cap", () => {
		expect(isBookablePartySize(0)).toBe(false);
		expect(isBookablePartySize(-3)).toBe(false);
		expect(isBookablePartySize(MAX_PARTY_SIZE + 1)).toBe(false);
	});

	it("rejects non-integers and non-finite values", () => {
		expect(isBookablePartySize(2.5)).toBe(false);
		expect(isBookablePartySize(Number.NaN)).toBe(false);
		expect(isBookablePartySize(Number.POSITIVE_INFINITY)).toBe(false);
	});
});

describe("windowIntersectsHorizon", () => {
	const now = 1_000_000_000_000;
	const DAY = 86_400_000;

	it("returns true for a window overlapping the horizon", () => {
		expect(
			windowIntersectsHorizon({
				fromMs: now,
				toMs: now + DAY,
				now,
				minAdvanceMinutes: 0,
				maxAdvanceDays: 90,
			})
		).toBe(true);
	});

	it("returns false for a window entirely in the past", () => {
		expect(
			windowIntersectsHorizon({
				fromMs: now - 2 * DAY,
				toMs: now - DAY,
				now,
				minAdvanceMinutes: 0,
				maxAdvanceDays: 90,
			})
		).toBe(false);
	});

	it("returns false for a window beyond the max-advance horizon", () => {
		expect(
			windowIntersectsHorizon({
				fromMs: now + 91 * DAY,
				toMs: now + 92 * DAY,
				now,
				minAdvanceMinutes: 0,
				maxAdvanceDays: 90,
			})
		).toBe(false);
	});

	it("returns false for a window entirely before the min-advance cutoff", () => {
		expect(
			windowIntersectsHorizon({
				fromMs: now,
				toMs: now + 60 * 60_000, // 1h out
				now,
				minAdvanceMinutes: 120, // earliest bookable is 2h out
				maxAdvanceDays: 90,
			})
		).toBe(false);
	});
});

describe("reservationCreateRateLimitKeys", () => {
	it("scopes phone (and email when present) per restaurant, normalized", () => {
		const keys = reservationCreateRateLimitKeys(restaurantId, {
			phone: " 555 ",
			email: " A@B.com ",
		});
		expect(keys).toEqual([
			"reservation_create:rest_1:phone:555",
			"reservation_create:rest_1:email:a@b.com",
		]);
	});

	it("omits the email key when no email is supplied", () => {
		expect(reservationCreateRateLimitKeys(restaurantId, { phone: "555" })).toEqual([
			"reservation_create:rest_1:phone:555",
		]);
	});

	it("omits the phone key when the phone is blank", () => {
		expect(reservationCreateRateLimitKeys(restaurantId, { phone: "   " })).toEqual([]);
	});
});

describe("attemptLimitForSource", () => {
	it("uses the standard limit for UI creates", () => {
		expect(attemptLimitForSource(RESERVATION_SOURCE.UI)).toBe(RESERVATION_CREATE_ATTEMPT_LIMIT);
	});

	it("uses the generous limit for bot (WhatsApp) creates", () => {
		expect(attemptLimitForSource(RESERVATION_SOURCE.WHATSAPP)).toBe(
			RESERVATION_CREATE_ATTEMPT_LIMIT_BOT
		);
	});

	it("exempts staff creates (no limit)", () => {
		expect(attemptLimitForSource(RESERVATION_SOURCE.STAFF)).toBeNull();
	});
});
