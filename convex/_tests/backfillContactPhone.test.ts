/**
 * Backfill migration for `reservations.contact.phone`.
 *
 * Rows written before canonicalization hold whatever each source produced —
 * `8114906208` from staff, `+5218114906208` from WhatsApp — and `by_phone` is an
 * exact index match, so until they agree the same customer stays split across
 * spellings and the assistant can only find the bookings it made itself.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const NOW = Date.now();

async function seed(t: ReturnType<typeof convexTest>, timezone = "America/Mexico_City") {
	return t.run(async (ctx) => {
		await ctx.db.insert("userRoles", {
			userId: "admin-user",
			roles: ["admin"],
			createdAt: NOW,
			updatedAt: NOW,
		});
		const organizationId = await ctx.db.insert("organizations", {
			name: "Org",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-1",
			organizationId,
			name: "Phone Backfill",
			slug: "phone-backfill",
			currency: "MXN",
			timezone,
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		return restaurantId;
	});
}

async function seedReservation(
	t: ReturnType<typeof convexTest>,
	restaurantId: Id<"restaurants">,
	phone: string
) {
	return t.run(async (ctx) =>
		ctx.db.insert("reservations", {
			restaurantId,
			partySize: 2,
			startsAt: NOW + 86_400_000,
			endsAt: NOW + 86_400_000 + 5_400_000,
			tableIds: [],
			status: "pending",
			source: "staff",
			contact: { name: "Guest", phone },
			createdAt: NOW,
			updatedAt: NOW,
		})
	);
}

const phoneOf = async (t: ReturnType<typeof convexTest>, id: Id<"reservations">) =>
	(await t.run(async (ctx) => ctx.db.get(id)))!.contact.phone;

describe("migrations/backfillContactPhone", () => {
	it("brings every spelling of one customer onto the same stored number", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seed(t);
		const staffTyped = await seedReservation(t, restaurantId, "8114906208");
		const spaced = await seedReservation(t, restaurantId, "811 490 6208");
		const whatsapp = await seedReservation(t, restaurantId, "+5218114906208");

		const admin = t.withIdentity({ subject: "admin-user" });
		const result = await admin.mutation(api.migrations.backfillContactPhone.run, {});

		expect(result.ok).toBe(true);
		expect(await phoneOf(t, staffTyped)).toBe("+528114906208");
		expect(await phoneOf(t, spaced)).toBe("+528114906208");
		expect(await phoneOf(t, whatsapp)).toBe("+528114906208");
	});

	it("leaves a number it cannot place exactly as staff typed it", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seed(t);
		const unplaceable = await seedReservation(t, restaurantId, "ext. 4102");

		const admin = t.withIdentity({ subject: "admin-user" });
		await admin.mutation(api.migrations.backfillContactPhone.run, {});

		expect(await phoneOf(t, unplaceable)).toBe("ext. 4102");
	});

	it("is idempotent — a second run patches nothing", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seed(t);
		await seedReservation(t, restaurantId, "8114906208");

		const admin = t.withIdentity({ subject: "admin-user" });
		const first = await admin.mutation(api.migrations.backfillContactPhone.run, {});
		const second = await admin.mutation(api.migrations.backfillContactPhone.run, {});

		expect(first.ok && first.patched).toBe(1);
		expect(second.ok && second.patched).toBe(0);
	});

	it("uses each restaurant's own country rather than one global guess", async () => {
		const t = convexTest(schema, modules);
		const mx = await seed(t);
		const us = await t.run(async (ctx) => {
			const organizationId = await ctx.db.insert("organizations", {
				name: "Org US",
				isActive: true,
				createdAt: NOW,
				updatedAt: NOW,
			});
			return ctx.db.insert("restaurants", {
				ownerId: "owner-2",
				organizationId,
				name: "US Diner",
				slug: "us-diner",
				currency: "USD",
				timezone: "America/New_York",
				isActive: true,
				createdAt: NOW,
				updatedAt: NOW,
			});
		});
		const mxRow = await seedReservation(t, mx, "8114906208");
		const usRow = await seedReservation(t, us, "4155238886");

		const admin = t.withIdentity({ subject: "admin-user" });
		await admin.mutation(api.migrations.backfillContactPhone.run, {});

		expect(await phoneOf(t, mxRow)).toBe("+528114906208");
		expect(await phoneOf(t, usRow)).toBe("+14155238886");
	});

	it("refuses a caller who is not an admin", async () => {
		const t = convexTest(schema, modules);
		await seed(t);

		const stranger = t.withIdentity({ subject: "not-admin" });
		const result = await stranger.mutation(api.migrations.backfillContactPhone.run, {});

		expect(result.ok).toBe(false);
	});
});
