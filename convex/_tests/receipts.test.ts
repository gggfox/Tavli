/**
 * TAVLI-71 Phase 3C — restaurant-branded receipt emails (ADR 008).
 *
 * Covers the pull-only send action: session-membership auth, the paid gate,
 * recipient always being the caller's own verified identity email, the
 * per-order rate limit, the cash-order (no fee) rendering path, reply-to
 * routing to the restaurant's support inbox, and the audit trail.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { AUDIT_EVENT } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const DINER = "diner-receipt";
const OTHER_MEMBER = "member-receipt";
const STRANGER = "stranger-receipt";

const fetchMock = vi.fn(async () => ({ ok: true, text: async () => "" }));

/** Body of the nth Resend call, parsed. */
function resendBody(n = 0): Record<string, unknown> {
	const call = fetchMock.mock.calls[n] as unknown as [string, { body: string }];
	return JSON.parse(call[1].body) as Record<string, unknown>;
}

type SeedOptions = {
	cash?: boolean;
	unpaid?: boolean;
	supportEmail?: string;
};

async function seedOrder(t: ReturnType<typeof convexTest>, options: SeedOptions = {}) {
	let restaurantId: Id<"restaurants">;
	let sessionId: Id<"sessions">;
	let orderId: Id<"orders">;

	await t.run(async (ctx) => {
		const now = Date.now();
		const organizationId = await ctx.db.insert("organizations", {
			name: "Receipt Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-receipt",
			organizationId,
			name: "La Cocina",
			slug: `receipt-test-${Math.random().toString(36).slice(2, 10)}`,
			currency: "USD",
			timezone: "America/Monterrey",
			supportEmail: options.supportEmail,
			rfc: "COC010101ABC",
			razonSocial: "La Cocina S.A. de C.V.",
			fiscalAddress: "Av. Siempre Viva 123, Monterrey",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 7,
			isActive: true,
			createdAt: now,
		});
		sessionId = await ctx.db.insert("sessions", {
			restaurantId,
			tableId,
			userId: DINER,
			memberUserIds: [OTHER_MEMBER],
			status: "active",
			startedAt: now,
		});
		const menuId = await ctx.db.insert("menus", {
			restaurantId,
			name: "Menu",
			isActive: true,
			displayOrder: 0,
			createdAt: now,
			updatedAt: now,
		});
		const categoryId = await ctx.db.insert("menuCategories", {
			menuId,
			restaurantId,
			name: "Cat",
			displayOrder: 0,
			createdAt: now,
			updatedAt: now,
		});
		const menuItemId = await ctx.db.insert("menuItems", {
			categoryId,
			restaurantId,
			name: "Pozole",
			basePrice: 5000,
			isAvailable: true,
			displayOrder: 0,
			createdAt: now,
			updatedAt: now,
		});

		orderId = await ctx.db.insert("orders", {
			sessionId,
			restaurantId,
			tableId,
			status: options.unpaid ? "draft" : "submitted",
			totalAmount: 10000,
			paymentState: options.unpaid ? "unpaid" : "paid",
			...(options.unpaid ? {} : { settledBy: options.cash ? "staff" : "stripe" }),
			...(options.unpaid || options.cash ? {} : { paidByUserId: DINER }),
			dailyOrderNumber: 42,
			paidAt: options.unpaid ? undefined : now,
			submittedAt: options.unpaid ? undefined : now,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("orderItems", {
			orderId,
			menuItemId,
			menuItemName: "Pozole",
			quantity: 2,
			unitPrice: 5000,
			selectedOptions: [],
			lineTotal: 10000,
			createdAt: now,
		});

		// Card orders carry the ADR 008 pay-at-submit payment row; cash orders
		// deliberately have none (`markOrderPaidInPerson` writes no payments row).
		if (!options.cash && !options.unpaid) {
			const paymentId = await ctx.db.insert("payments", {
				restaurantId,
				orderId,
				amount: 11200,
				subtotalAmount: 10000,
				feeAmount: 1200,
				kind: "order",
				paidByUserId: DINER,
				currency: "usd",
				status: "succeeded",
				refundStatus: "none",
				attemptNumber: 1,
				stripePaymentIntentId: "pi_receipt_order",
				succeededAt: now,
				createdAt: now,
				updatedAt: now,
			});
			await ctx.db.patch(orderId, { activePaymentId: paymentId });
		}
	});

	return {
		restaurantId: restaurantId!,
		sessionId: sessionId!,
		orderId: orderId!,
		diner: t.withIdentity({ subject: DINER, email: "diner@example.com", emailVerified: true }),
		member: t.withIdentity({
			subject: OTHER_MEMBER,
			email: "friend@example.com",
			emailVerified: true,
		}),
		stranger: t.withIdentity({
			subject: STRANGER,
			email: "stranger@example.com",
			emailVerified: true,
		}),
	};
}

describe("receipts (TAVLI-71 Phase 3C)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.RESEND_API_KEY = "re_test_123";
		process.env.RESEND_FROM_ADDRESS = "no-reply@tavliai.com";
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("sends the receipt to the CALLER's identity email, branded as the restaurant", async () => {
		const t = convexTest(schema, modules);
		const { orderId, diner } = await seedOrder(t);

		const result = await diner.action(api.receiptActions.sendReceiptEmail, {
			orderId,
			locale: "en",
		});

		expect(result).toEqual({ sentTo: "diner@example.com" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const body = resendBody();
		expect(body.to).toEqual(["diner@example.com"]);
		expect(body.from).toBe("La Cocina via Tavli <no-reply@tavliai.com>");
		expect(body.subject).toBe("Your receipt from La Cocina");
		// The charged split from the payment row — never recomputed from the rate.
		expect(body.html).toContain("Tavli service fee (12%)");
		expect(body.html).toContain("$12.00");
		expect(body.html).toContain("$112.00");
		// Tax block + mandatory not-a-CFDI footer.
		expect(body.html).toContain("RFC: COC010101ABC");
		expect(body.html).toContain("This is not a CFDI");
	});

	it("any session member may request a receipt — but the email goes to THEIR address", async () => {
		const t = convexTest(schema, modules);
		const { orderId, member } = await seedOrder(t);

		const result = await member.action(api.receiptActions.sendReceiptEmail, {
			orderId,
			locale: "en",
		});

		expect(result).toEqual({ sentTo: "friend@example.com" });
		expect(resendBody().to).toEqual(["friend@example.com"]);
	});

	it("rejects a caller who is not a session member", async () => {
		const t = convexTest(schema, modules);
		const { orderId, stranger } = await seedOrder(t);

		await expect(
			stranger.action(api.receiptActions.sendReceiptEmail, { orderId, locale: "en" })
		).rejects.toThrowError(/ERROR_SESSION_ACCESS_DENIED/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects an unpaid order", async () => {
		const t = convexTest(schema, modules);
		const { orderId, diner } = await seedOrder(t, { unpaid: true });

		await expect(
			diner.action(api.receiptActions.sendReceiptEmail, { orderId, locale: "en" })
		).rejects.toThrowError(/ERROR_RECEIPT_ORDER_NOT_PAID/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects a caller without a verified identity email", async () => {
		const t = convexTest(schema, modules);
		const { orderId } = await seedOrder(t);
		const unverified = t.withIdentity({
			subject: DINER,
			email: "diner@example.com",
			emailVerified: false,
		});

		await expect(
			unverified.action(api.receiptActions.sendReceiptEmail, { orderId, locale: "en" })
		).rejects.toThrowError(/ERROR_RECEIPT_NO_VERIFIED_EMAIL/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rate limit: the 4th send within the hour is rejected and never emails", async () => {
		const t = convexTest(schema, modules);
		const { orderId, diner } = await seedOrder(t);

		for (let i = 0; i < 3; i++) {
			await diner.action(api.receiptActions.sendReceiptEmail, { orderId, locale: "en" });
		}
		expect(fetchMock).toHaveBeenCalledTimes(3);

		await expect(
			diner.action(api.receiptActions.sendReceiptEmail, { orderId, locale: "en" })
		).rejects.toThrowError(/ERROR_RECEIPT_RATE_LIMITED/);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("cash order: subtotal only, no fee line, paid-in-person hint", async () => {
		const t = convexTest(schema, modules);
		const { orderId, diner } = await seedOrder(t, { cash: true });

		await diner.action(api.receiptActions.sendReceiptEmail, { orderId, locale: "en" });

		const body = resendBody();
		expect(body.html).not.toContain("Tavli service fee");
		expect(body.html).toContain("Paid in person");
		// Total falls back to the order total — no fee was ever charged on cash.
		expect(body.html).toContain("$100.00");
		expect(body.html).not.toContain("$112.00");
	});

	it("sets reply_to to the restaurant's support email when configured", async () => {
		const t = convexTest(schema, modules);
		const { orderId, diner } = await seedOrder(t, { supportEmail: "hola@lacocina.mx" });

		await diner.action(api.receiptActions.sendReceiptEmail, { orderId, locale: "en" });

		expect(resendBody().reply_to).toBe("hola@lacocina.mx");
	});

	it("omits reply_to when the restaurant has no support email", async () => {
		const t = convexTest(schema, modules);
		const { orderId, diner } = await seedOrder(t);

		await diner.action(api.receiptActions.sendReceiptEmail, { orderId, locale: "en" });

		expect(resendBody()).not.toHaveProperty("reply_to");
	});

	it("renders the Spanish template when locale is es", async () => {
		const t = convexTest(schema, modules);
		const { orderId, diner } = await seedOrder(t);

		await diner.action(api.receiptActions.sendReceiptEmail, { orderId, locale: "es" });

		const body = resendBody();
		expect(body.subject).toBe("Tu recibo de La Cocina");
		expect(body.html).toContain("Tarifa de servicio Tavli (12%)");
		expect(body.html).toContain("Este documento no es un CFDI");
	});

	it("records the receipts.emailSent audit event with the recipient", async () => {
		const t = convexTest(schema, modules);
		const { orderId, restaurantId, sessionId, diner } = await seedOrder(t);

		await diner.action(api.receiptActions.sendReceiptEmail, { orderId, locale: "en" });

		const events = await t.run(async (ctx) =>
			(await ctx.db.query("allEvents").collect()).filter(
				(e) => e.eventType === AUDIT_EVENT.RECEIPT_EMAIL_SENT
			)
		);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			aggregateId: String(orderId),
			restaurantId,
			userId: DINER,
		});
		expect(events[0].payload).toMatchObject({
			sessionId,
			recipient: "diner@example.com",
			locale: "en",
		});
	});

	it("surfaces a Resend failure as a stable error instead of a false success", async () => {
		const t = convexTest(schema, modules);
		const { orderId, diner } = await seedOrder(t);
		fetchMock.mockResolvedValueOnce({ ok: false, text: async () => '{"message":"boom"}' } as never);

		await expect(
			diner.action(api.receiptActions.sendReceiptEmail, { orderId, locale: "en" })
		).rejects.toThrowError(/ERROR_RECEIPT_SEND_FAILED/);

		// No audit event for a send that never happened.
		const events = await t.run(async (ctx) =>
			(await ctx.db.query("allEvents").collect()).filter(
				(e) => e.eventType === AUDIT_EVENT.RECEIPT_EMAIL_SENT
			)
		);
		expect(events).toHaveLength(0);
	});
});
