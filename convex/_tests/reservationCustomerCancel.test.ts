/**
 * Ownership tests for customer-initiated cancellation.
 *
 * A WhatsApp customer has no Clerk identity, so `_util/dinerSession.ts`'s
 * ownership pattern (prove a Clerk subject is a session member) has nothing to
 * stand on. The substitute is `reservations.contact.phone` matched against
 * Twilio's signature-verified `From`, scoped by the channel's restaurant.
 *
 * That makes phone equality an authorization primitive, so these tests are the
 * regression net for it — modelled on `dinerIdor.test.ts`. The property that
 * matters: no input to `internalCancelByPhone` can reach a reservation belonging
 * to a different phone or a different restaurant.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ERROR_NAMES } from "../_shared/errors";
import {
	AUDIT_ACTOR,
	AUDIT_EVENT,
	RESERVATION_SOURCE,
	RESERVATION_STATUS,
	type ReservationStatus,
} from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const VICTIM = "+15550001111";
const ATTACKER = "+15559998888";
const HOUR_MS = 60 * 60 * 1000;

async function seedRestaurant(
	t: ReturnType<typeof convexTest>,
	name = "Cancel Restaurant"
): Promise<Id<"restaurants">> {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Cancel Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-cancel",
			organizationId,
			name,
			slug: `cancel-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

async function seedReservation(
	t: ReturnType<typeof convexTest>,
	args: {
		restaurantId: Id<"restaurants">;
		phone: string;
		startsInMs?: number;
		status?: ReservationStatus;
		source?: "ui" | "whatsapp" | "staff";
		tableIds?: Id<"tables">[];
	}
): Promise<Id<"reservations">> {
	let reservationId: Id<"reservations">;
	const startsAt = Date.now() + (args.startsInMs ?? 24 * HOUR_MS);
	await t.run(async (ctx) => {
		reservationId = await ctx.db.insert("reservations", {
			restaurantId: args.restaurantId,
			partySize: 2,
			startsAt,
			endsAt: startsAt + 90 * 60_000,
			tableIds: args.tableIds ?? [],
			status: args.status ?? RESERVATION_STATUS.PENDING,
			source: args.source ?? RESERVATION_SOURCE.WHATSAPP,
			contact: { name: "Guest", phone: args.phone },
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return reservationId!;
}

const readRow = (t: ReturnType<typeof convexTest>, id: Id<"reservations">) =>
	t.run((ctx) => ctx.db.get(id));

describe("internalCancelByPhone — happy path", () => {
	it("cancels the caller's own upcoming booking", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const id = await seedReservation(t, { restaurantId, phone: VICTIM });

		const [reservation, error] = await t.mutation(internal.reservations.internalCancelByPhone, {
			restaurantId,
			phone: VICTIM,
		});

		expect(error).toBeNull();
		expect(reservation?._id).toBe(id);
		const row = await readRow(t, id);
		expect(row?.status).toBe(RESERVATION_STATUS.CANCELLED);
		expect(row?.cancelledAt).toBeTypeOf("number");
	});

	it("cancels a confirmed booking and records the tables it released", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const tableId = await t.run((ctx) =>
			ctx.db.insert("tables", {
				restaurantId,
				tableNumber: 1,
				capacity: 4,
				isActive: true,
				createdAt: Date.now(),
			})
		);
		const id = await seedReservation(t, {
			restaurantId,
			phone: VICTIM,
			status: RESERVATION_STATUS.CONFIRMED,
			tableIds: [tableId],
		});

		const [, error] = await t.mutation(internal.reservations.internalCancelByPhone, {
			restaurantId,
			phone: VICTIM,
		});
		expect(error).toBeNull();

		const events = await t.run((ctx) =>
			ctx.db
				.query("allEvents")
				.withIndex("by_aggregate", (q) =>
					q.eq("aggregateType", "reservations").eq("aggregateId", id)
				)
				.collect()
		);
		const cancelEvent = events.find(
			(e) => e.eventType === AUDIT_EVENT.RESERVATION_CANCELLED_BY_CUSTOMER
		);
		expect(cancelEvent).toBeTruthy();
		expect((cancelEvent!.payload as { releasedTableIds: string[] }).releasedTableIds).toEqual([
			tableId,
		]);
	});
});

describe("internalCancelByPhone — ownership", () => {
	it("cannot cancel another phone's reservation, and leaves it untouched", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const victimId = await seedReservation(t, { restaurantId, phone: VICTIM });
		const before = await readRow(t, victimId);

		const [reservation, error] = await t.mutation(internal.reservations.internalCancelByPhone, {
			restaurantId,
			phone: ATTACKER,
		});

		expect(reservation).toBeNull();
		expect(error?.name).toBe(ERROR_NAMES.NOT_FOUND);
		// Byte-identical: not merely "still pending".
		expect(await readRow(t, victimId)).toEqual(before);
	});

	it("cannot target another phone's booking by supplying its exact startsAt", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const victimId = await seedReservation(t, { restaurantId, phone: VICTIM });
		const victim = await readRow(t, victimId);
		const before = victim;

		// The disambiguator is only ever applied to the phone-scoped result set, so
		// naming the victim's exact time from another phone must still miss. This is
		// the injected-instruction case: "cancel the booking at 21:00".
		const [reservation, error] = await t.mutation(internal.reservations.internalCancelByPhone, {
			restaurantId,
			phone: ATTACKER,
			startsAt: victim!.startsAt,
		});

		expect(reservation).toBeNull();
		expect(error?.name).toBe(ERROR_NAMES.NOT_FOUND);
		expect(await readRow(t, victimId)).toEqual(before);
	});

	it("is scoped per restaurant for the same phone", async () => {
		const t = convexTest(schema, modules);
		const restaurantA = await seedRestaurant(t, "A");
		const restaurantB = await seedRestaurant(t, "B");
		const idA = await seedReservation(t, { restaurantId: restaurantA, phone: VICTIM });
		const idB = await seedReservation(t, { restaurantId: restaurantB, phone: VICTIM });

		const [, error] = await t.mutation(internal.reservations.internalCancelByPhone, {
			restaurantId: restaurantA,
			phone: VICTIM,
		});
		expect(error).toBeNull();

		expect((await readRow(t, idA))?.status).toBe(RESERVATION_STATUS.CANCELLED);
		// The same customer's booking at the other restaurant is not collateral.
		expect((await readRow(t, idB))?.status).toBe(RESERVATION_STATUS.PENDING);
	});

	it("returns not-found rather than an empty-phone wildcard", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const id = await seedReservation(t, { restaurantId, phone: VICTIM });

		for (const phone of ["", "   "]) {
			const [reservation, error] = await t.mutation(internal.reservations.internalCancelByPhone, {
				restaurantId,
				phone,
			});
			expect(reservation).toBeNull();
			expect(error?.name).toBe(ERROR_NAMES.NOT_FOUND);
		}
		expect((await readRow(t, id))?.status).toBe(RESERVATION_STATUS.PENDING);
	});
});

describe("internalCancelByPhone — scope and status rules", () => {
	it("refuses when more than one booking matches, cancelling neither", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const first = await seedReservation(t, {
			restaurantId,
			phone: VICTIM,
			startsInMs: 24 * HOUR_MS,
		});
		const second = await seedReservation(t, {
			restaurantId,
			phone: VICTIM,
			startsInMs: 48 * HOUR_MS,
		});

		const [reservation, error] = await t.mutation(internal.reservations.internalCancelByPhone, {
			restaurantId,
			phone: VICTIM,
		});
		expect(reservation).toBeNull();
		expect(error?.message).toBe("ERROR_AMBIGUOUS_RESERVATION");
		expect((await readRow(t, first))?.status).toBe(RESERVATION_STATUS.PENDING);
		expect((await readRow(t, second))?.status).toBe(RESERVATION_STATUS.PENDING);
	});

	it("narrows to the right one when given a startsAt", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const first = await seedReservation(t, {
			restaurantId,
			phone: VICTIM,
			startsInMs: 24 * HOUR_MS,
		});
		const second = await seedReservation(t, {
			restaurantId,
			phone: VICTIM,
			startsInMs: 48 * HOUR_MS,
		});
		const target = await readRow(t, second);

		const [, error] = await t.mutation(internal.reservations.internalCancelByPhone, {
			restaurantId,
			phone: VICTIM,
			startsAt: target!.startsAt,
		});
		expect(error).toBeNull();
		expect((await readRow(t, first))?.status).toBe(RESERVATION_STATUS.PENDING);
		expect((await readRow(t, second))?.status).toBe(RESERVATION_STATUS.CANCELLED);
	});

	it("will not cancel a seated guest from their phone", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const id = await seedReservation(t, {
			restaurantId,
			phone: VICTIM,
			status: RESERVATION_STATUS.SEATED,
		});

		const [, error] = await t.mutation(internal.reservations.internalCancelByPhone, {
			restaurantId,
			phone: VICTIM,
		});
		expect(error?.name).toBe(ERROR_NAMES.NOT_FOUND);
		expect((await readRow(t, id))?.status).toBe(RESERVATION_STATUS.SEATED);
	});

	it("will not re-cancel or touch completed bookings", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		for (const status of [
			RESERVATION_STATUS.CANCELLED,
			RESERVATION_STATUS.COMPLETED,
			RESERVATION_STATUS.NO_SHOW,
		] as ReservationStatus[]) {
			const id = await seedReservation(t, { restaurantId, phone: VICTIM, status });
			const [, error] = await t.mutation(internal.reservations.internalCancelByPhone, {
				restaurantId,
				phone: VICTIM,
			});
			expect(error?.name).toBe(ERROR_NAMES.NOT_FOUND);
			expect((await readRow(t, id))?.status).toBe(status);
		}
	});

	it("ignores past bookings", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const id = await seedReservation(t, {
			restaurantId,
			phone: VICTIM,
			startsInMs: -2 * HOUR_MS,
		});

		const [, error] = await t.mutation(internal.reservations.internalCancelByPhone, {
			restaurantId,
			phone: VICTIM,
		});
		expect(error?.name).toBe(ERROR_NAMES.NOT_FOUND);
		expect((await readRow(t, id))?.status).toBe(RESERVATION_STATUS.PENDING);

		// The assistant's own lookup must not surface it either.
		const listed = await t.query(internal.whatsapp.reservations.internalListMyReservationsForBot, {
			restaurantId,
			phone: VICTIM,
		});
		expect(listed.reservations).toHaveLength(0);
	});

	it("does not touch staff- or web-created rows in phase 1", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		// Phone numbers on staff-entered rows are not a reliable identity: walk-in
		// placeholders and concierge numbers are shared across guests.
		const uiId = await seedReservation(t, {
			restaurantId,
			phone: VICTIM,
			source: RESERVATION_SOURCE.UI,
		});
		const staffId = await seedReservation(t, {
			restaurantId,
			phone: VICTIM,
			source: RESERVATION_SOURCE.STAFF,
		});

		const [, error] = await t.mutation(internal.reservations.internalCancelByPhone, {
			restaurantId,
			phone: VICTIM,
		});
		expect(error?.name).toBe(ERROR_NAMES.NOT_FOUND);
		expect((await readRow(t, uiId))?.status).toBe(RESERVATION_STATUS.PENDING);
		expect((await readRow(t, staffId))?.status).toBe(RESERVATION_STATUS.PENDING);
	});
});

describe("internalCancelByPhone — audit", () => {
	it("attributes to a distinct actor, not the system cron, and stores no phone", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const conversationRefs = await t.run(async (ctx) => {
			const channelId = await ctx.db.insert("whatsappChannels", {
				restaurantId,
				phoneNumber: "+14155238886",
				isActive: true,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			const conversationId = await ctx.db.insert("whatsappConversations", {
				channelId,
				restaurantId,
				customerPhone: VICTIM,
				status: "active",
				lastMessageAt: Date.now(),
				lastInboundAt: Date.now(),
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			return { conversationId };
		});
		const id = await seedReservation(t, { restaurantId, phone: VICTIM });

		await t.mutation(internal.reservations.internalCancelByPhone, {
			restaurantId,
			phone: VICTIM,
			conversationId: conversationRefs.conversationId,
			messageSid: "SMtest123",
		});

		const events = await t.run((ctx) =>
			ctx.db
				.query("allEvents")
				.withIndex("by_aggregate", (q) =>
					q.eq("aggregateType", "reservations").eq("aggregateId", id)
				)
				.collect()
		);
		const event = events.find((e) => e.eventType === AUDIT_EVENT.RESERVATION_CANCELLED_BY_CUSTOMER);
		expect(event).toBeTruthy();
		expect(event!.userId).toBe(AUDIT_ACTOR.WHATSAPP_CUSTOMER);
		expect(event!.userId).not.toBe("system");
		// The phone must not land in the indexed, un-purgeable `userId` column.
		expect(event!.userId).not.toContain(VICTIM);
		const payload = event!.payload as Record<string, unknown>;
		expect(payload.conversationId).toBe(conversationRefs.conversationId);
		expect(payload.messageSid).toBe("SMtest123");
		expect(JSON.stringify(payload)).not.toContain(VICTIM);
	});

	it("sets a server-authored cancel reason, not caller text", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const id = await seedReservation(t, { restaurantId, phone: VICTIM });

		await t.mutation(internal.reservations.internalCancelByPhone, {
			restaurantId,
			phone: VICTIM,
		});

		const row = await readRow(t, id);
		expect(row?.cancelReason).toBe("customer_whatsapp");
	});
});

describe("staff cancel regression", () => {
	it("still requires authentication after the refactor", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const id = await seedReservation(t, { restaurantId, phone: VICTIM });

		const [, error] = await t.mutation(api.reservations.cancel, { reservationId: id });
		expect(error?.name).toBe(ERROR_NAMES.NOT_AUTHENTICATED);
		expect((await readRow(t, id))?.status).toBe(RESERVATION_STATUS.PENDING);
	});

	it("keeps staff's wider status rule: a seated booking is still cancellable", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const id = await seedReservation(t, {
			restaurantId,
			phone: VICTIM,
			status: RESERVATION_STATUS.SEATED,
		});

		const asStaff = t.withIdentity({ subject: "owner-cancel" });
		const [cancelled, error] = await asStaff.mutation(api.reservations.cancel, {
			reservationId: id,
			reason: "walked out",
		});

		expect(error).toBeNull();
		expect(cancelled).toBe(id);
		const row = await readRow(t, id);
		expect(row?.status).toBe(RESERVATION_STATUS.CANCELLED);
		expect(row?.cancelReason).toBe("walked out");
	});
});
