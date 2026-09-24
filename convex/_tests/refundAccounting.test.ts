/**
 * Refund accounting on a paid ADR 008 order: Stripe's cumulative total is the
 * only figure `payments.amountRefunded` holds, refunds on one charge are
 * serialized by a reservation on the payment row, and a failed refund is
 * never a dead end.
 *
 * Every scenario runs against the same order: subtotal 1400 (tacos 800 +
 * agua fresca 600) → charge 1568 with the 12% customer-borne fee. Removing the
 * drink refunds 600 + 72 = 672; the tacos, as the last live line, sweep the
 * remaining 896.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { mockStripeClient } from "./_fixtures/stripeMock.fixture";

const modules = import.meta.glob("../**/*.ts");

vi.mock("stripe", async () => (await import("./_fixtures/stripeMock.fixture")).stripeModuleMock());

const CHARGE = 1568;
const DRINK_REFUND = 672;

/** The charge `refunds.create` returns under `expand: ["charge"]`. */
function chargeAfterRefunds(amountRefunded: number) {
	return {
		id: "ch_acct",
		object: "charge",
		payment_intent: "pi_acct",
		amount: CHARGE,
		amount_captured: CHARGE,
		amount_refunded: amountRefunded,
		refunded: amountRefunded >= CHARGE,
	};
}

function refundResult(id: string, amount: number, cumulative: number) {
	return { id, status: "succeeded", amount, charge: chargeAfterRefunds(cumulative) };
}

async function seed(t: ReturnType<typeof convexTest>) {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const organizationId = await ctx.db.insert("organizations", {
			name: "Refund Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-acct",
			organizationId,
			name: "Refund Restaurant",
			slug: `refund-acct-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			stripeAccountId: "acct_refund_acct",
			stripeOnboardingComplete: true,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		for (const [userId, role] of [
			["manager-acct", "manager"],
			["employee-acct", "employee"],
		] as const) {
			await ctx.db.insert("userRoles", {
				userId,
				roles: [role],
				organizationId,
				createdAt: now,
				updatedAt: now,
			});
			await ctx.db.insert("restaurantMembers", {
				userId,
				restaurantId,
				organizationId,
				role,
				isActive: true,
				createdAt: now,
				updatedAt: now,
				updatedBy: "system",
			});
		}
		const tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 3,
			isActive: true,
			createdAt: now,
		});
		const sessionId = await ctx.db.insert("sessions", {
			restaurantId,
			tableId,
			userId: "diner-acct",
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
		const orderId = await ctx.db.insert("orders", {
			sessionId,
			restaurantId,
			tableId,
			status: "submitted",
			totalAmount: 1400,
			paymentState: "paid",
			settledBy: "stripe",
			paidAt: now,
			submittedAt: now,
			createdAt: now,
			updatedAt: now,
		});
		const makeItem = async (name: string, lineTotal: number) => {
			const menuItemId = await ctx.db.insert("menuItems", {
				categoryId,
				restaurantId,
				name,
				basePrice: lineTotal,
				isAvailable: true,
				displayOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
			return await ctx.db.insert("orderItems", {
				orderId,
				menuItemId,
				menuItemName: name,
				quantity: 1,
				unitPrice: lineTotal,
				selectedOptions: [],
				lineTotal,
				createdAt: now,
			});
		};
		const tacosItemId = await makeItem("Tacos", 800);
		const drinkItemId = await makeItem("Agua fresca", 600);
		const paymentId = await ctx.db.insert("payments", {
			restaurantId,
			orderId,
			amount: CHARGE,
			subtotalAmount: 1400,
			feeAmount: 168,
			kind: "order",
			paidByUserId: "diner-acct",
			currency: "mxn",
			status: "succeeded",
			refundStatus: "none",
			attemptNumber: 1,
			stripePaymentIntentId: "pi_acct",
			succeededAt: now,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.patch(orderId, { activePaymentId: paymentId });
		return { orderId, tacosItemId, drinkItemId, paymentId };
	});
}

function manager(t: ReturnType<typeof convexTest>) {
	return t.withIdentity({ subject: "manager-acct" });
}

async function flush(t: ReturnType<typeof convexTest>) {
	await t.finishAllScheduledFunctions(() => vi.runAllTimers());
}

async function read(
	t: ReturnType<typeof convexTest>,
	ids: { orderId: Id<"orders">; paymentId: Id<"payments"> }
) {
	return await t.run(async (ctx) => ({
		order: await ctx.db.get(ids.orderId),
		payment: await ctx.db.get(ids.paymentId),
	}));
}

/** The refunds Tavli asked Stripe for, in order: `[amount | undefined, key]`. */
function refundCalls() {
	return mockStripeClient.refunds.create.mock.calls.map((call) => [
		(call[0] as { amount?: number }).amount,
		(call[1] as { idempotencyKey: string }).idempotencyKey,
	]);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("amountRefunded is Stripe's cumulative total", () => {
	it("is not double-counted when the charge.refunded webhook commits before the refund is recorded", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);

		// Stripe delivers `charge.refunded` while the refund call is still
		// returning — the webhook's mutation commits first.
		mockStripeClient.refunds.create.mockImplementationOnce(async () => {
			await t.mutation(internal.stripeHelpers.recordChargeRefund, {
				paymentId: ids.paymentId,
				amountRefunded: DRINK_REFUND,
				amountCaptured: CHARGE,
				isFullyRefunded: false,
			});
			return refundResult("re_drink", DRINK_REFUND, DRINK_REFUND);
		});

		await manager(t).mutation(api.orders.cancelOrderItem, { orderItemId: ids.drinkItemId });
		await flush(t);

		const { order, payment } = await read(t, ids);
		expect(payment?.amountRefunded).toBe(DRINK_REFUND);
		expect(payment?.refundStatus).toBe("partial");
		expect(payment?.pendingRefund).toBeUndefined();
		expect(order?.paymentState).toBe("paid");
	});

	it("still refunds the whole remainder on the last line after a webhook-first partial", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);

		mockStripeClient.refunds.create
			.mockImplementationOnce(async () => {
				await t.mutation(internal.stripeHelpers.recordChargeRefund, {
					paymentId: ids.paymentId,
					amountRefunded: DRINK_REFUND,
					amountCaptured: CHARGE,
					isFullyRefunded: false,
				});
				return refundResult("re_drink", DRINK_REFUND, DRINK_REFUND);
			})
			.mockResolvedValueOnce(refundResult("re_tacos", CHARGE - DRINK_REFUND, CHARGE));

		const staff = manager(t);
		await staff.mutation(api.orders.cancelOrderItem, { orderItemId: ids.drinkItemId });
		await flush(t);
		await staff.mutation(api.orders.cancelOrderItem, { orderItemId: ids.tacosItemId });
		await flush(t);

		// The sweep sends no amount — Stripe decides what remains — so a stale
		// local total could not under-refund the diner even if there were one.
		expect(refundCalls().map(([amount]) => amount)).toEqual([DRINK_REFUND, undefined]);
		const { order, payment } = await read(t, ids);
		expect(payment?.amountRefunded).toBe(CHARGE);
		expect(payment?.refundStatus).toBe("succeeded");
		expect(order?.status).toBe("cancelled");
		expect(order?.paymentState).toBe("refunded");
	});

	it("does not regress when a partial refund's charge.refunded arrives after the full one", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);

		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId: ids.paymentId,
			amountRefunded: CHARGE,
			amountCaptured: CHARGE,
			isFullyRefunded: true,
		});
		// The earlier partial's event, delivered late.
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId: ids.paymentId,
			amountRefunded: DRINK_REFUND,
			amountCaptured: CHARGE,
			isFullyRefunded: false,
		});

		const { order, payment } = await read(t, ids);
		expect(payment?.amountRefunded).toBe(CHARGE);
		expect(payment?.refundStatus).toBe("succeeded");
		expect(order?.paymentState).toBe("refunded");
	});
});

describe("refunds on one charge are serialized", () => {
	it("refuses a second line removal while the first line's refund is in flight, then sizes it correctly", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const staff = manager(t);

		mockStripeClient.refunds.create
			.mockResolvedValueOnce(refundResult("re_drink", DRINK_REFUND, DRINK_REFUND))
			.mockResolvedValueOnce(refundResult("re_tacos", CHARGE - DRINK_REFUND, CHARGE));

		// Two removals a moment apart: the first has reserved its refund and not
		// yet reached Stripe when the second arrives.
		await staff.mutation(api.orders.cancelOrderItem, { orderItemId: ids.drinkItemId });
		await expect(
			staff.mutation(api.orders.cancelOrderItem, { orderItemId: ids.tacosItemId })
		).rejects.toThrow("ERROR_REFUND_IN_PROGRESS");

		// Refused before anything changed: the line is still live.
		const tacos = await t.run(async (ctx) => ctx.db.get(ids.tacosItemId));
		expect(tacos?.cancelledAt).toBeUndefined();

		await flush(t);
		await staff.mutation(api.orders.cancelOrderItem, { orderItemId: ids.tacosItemId });
		await flush(t);

		// Never more than remains: the line, then the sweep with no amount.
		expect(refundCalls()).toEqual([
			[DRINK_REFUND, `refund:${ids.paymentId}:${ids.drinkItemId}`],
			[undefined, `refund:${ids.paymentId}:${ids.tacosItemId}`],
		]);
		const { order, payment } = await read(t, ids);
		expect(order?.paymentState).toBe("refunded");
		expect(payment?.amountRefunded).toBe(CHARGE);
	});

	it("refuses a whole-order cancel racing a line refund without cancelling the order", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const staff = manager(t);

		await staff.mutation(api.orders.cancelOrderItem, { orderItemId: ids.drinkItemId });
		await expect(
			staff.action(api.stripe.cancelOrderAndRefund, { orderId: ids.orderId })
		).rejects.toThrow("ERROR_REFUND_IN_PROGRESS");

		const { order } = await read(t, ids);
		expect(order?.status).toBe("submitted");
		expect(order?.paymentState).toBe("paid");
		expect(mockStripeClient.refunds.create).not.toHaveBeenCalled();
	});
});

describe("a failed refund is not a dead end", () => {
	it("a whole-order cancel after a failed line refund refunds everything that remains", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const staff = manager(t);

		mockStripeClient.refunds.create
			.mockRejectedValueOnce(new Error("card_error"))
			.mockResolvedValueOnce(refundResult("re_whole", CHARGE, CHARGE));

		await staff.mutation(api.orders.cancelOrderItem, { orderItemId: ids.drinkItemId });
		await flush(t);
		expect((await read(t, ids)).order?.paymentState).toBe("refund_failed");

		const [result, error] = await staff.action(api.stripe.cancelOrderAndRefund, {
			orderId: ids.orderId,
		});
		expect(error).toBeNull();
		expect(result).toMatchObject({ refunded: true, amountRefunded: CHARGE });
		expect(refundCalls()[1]).toEqual([undefined, `refund:${ids.paymentId}:${ids.orderId}`]);

		const { order, payment } = await read(t, ids);
		expect(order?.status).toBe("cancelled");
		expect(order?.paymentState).toBe("refunded");
		expect(payment?.refundStatus).toBe("succeeded");
		expect(payment?.pendingRefund).toBeUndefined();
	});

	it("a manager's retry re-sends the failed line refund's own key and amount", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const staff = manager(t);

		mockStripeClient.refunds.create
			.mockRejectedValueOnce(new Error("api_connection_error"))
			.mockResolvedValueOnce(refundResult("re_drink", DRINK_REFUND, DRINK_REFUND));

		await staff.mutation(api.orders.cancelOrderItem, { orderItemId: ids.drinkItemId });
		await flush(t);
		expect((await read(t, ids)).payment?.pendingRefund?.failedAt).toBeTypeOf("number");

		const [result, error] = await staff.action(api.stripe.retryOrderRefund, {
			orderId: ids.orderId,
		});
		expect(error).toBeNull();
		expect(result?.paymentState).toBe("paid");

		const key = `refund:${ids.paymentId}:${ids.drinkItemId}`;
		expect(refundCalls()).toEqual([
			[DRINK_REFUND, key],
			[DRINK_REFUND, key],
		]);
		const { order, payment } = await read(t, ids);
		// The order keeps cooking, paid, with the line's money back.
		expect(order?.status).toBe("submitted");
		expect(order?.paymentState).toBe("paid");
		expect(payment?.amountRefunded).toBe(DRINK_REFUND);
		expect(payment?.pendingRefund).toBeUndefined();
		const drink = await t.run(async (ctx) => ctx.db.get(ids.drinkItemId));
		expect(drink?.refundAmount).toBe(DRINK_REFUND);
	});

	it("a retry of a failed whole-order refund reuses the order key and settles", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const staff = manager(t);

		mockStripeClient.refunds.create
			.mockRejectedValueOnce(new Error("api_connection_error"))
			.mockResolvedValueOnce(refundResult("re_whole", CHARGE, CHARGE));

		const [, cancelError] = await staff.action(api.stripe.cancelOrderAndRefund, {
			orderId: ids.orderId,
		});
		expect(cancelError?.message).toBe("ERROR_REFUND_FAILED");

		const [result, error] = await staff.action(api.stripe.retryOrderRefund, {
			orderId: ids.orderId,
		});
		expect(error).toBeNull();
		expect(result?.paymentState).toBe("refunded");
		const key = `refund:${ids.paymentId}:${ids.orderId}`;
		expect(refundCalls()).toEqual([
			[undefined, key],
			[undefined, key],
		]);
	});

	it("reports a retry that fails again", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const staff = manager(t);

		mockStripeClient.refunds.create.mockRejectedValue(new Error("api_connection_error"));

		await staff.action(api.stripe.cancelOrderAndRefund, { orderId: ids.orderId });
		const [, error] = await staff.action(api.stripe.retryOrderRefund, { orderId: ids.orderId });

		expect(error?.message).toBe("ERROR_REFUND_RETRY_FAILED");
		expect((await read(t, ids)).order?.paymentState).toBe("refund_failed");
	});

	it("does not flag refund_failed when Stripe says the charge is already fully refunded", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const staff = manager(t);

		mockStripeClient.refunds.create
			.mockResolvedValueOnce(refundResult("re_drink", DRINK_REFUND, DRINK_REFUND))
			// An operator finished the refund from the Dashboard before the sweep.
			.mockRejectedValueOnce(
				Object.assign(new Error("Charge has already been refunded."), {
					code: "charge_already_refunded",
				})
			);

		await staff.mutation(api.orders.cancelOrderItem, { orderItemId: ids.drinkItemId });
		await flush(t);
		await staff.mutation(api.orders.cancelOrderItem, { orderItemId: ids.tacosItemId });
		await flush(t);

		const { order, payment } = await read(t, ids);
		expect(order?.paymentState).toBe("refunded");
		expect(payment?.refundStatus).toBe("succeeded");
		expect(payment?.amountRefunded).toBe(CHARGE);
		expect(payment?.pendingRefund).toBeUndefined();
	});

	it("only lets a manager retry a refund", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);

		mockStripeClient.refunds.create
			.mockRejectedValueOnce(new Error("api_connection_error"))
			.mockResolvedValueOnce(refundResult("re_drink", DRINK_REFUND, DRINK_REFUND));

		await manager(t).mutation(api.orders.cancelOrderItem, { orderItemId: ids.drinkItemId });
		await flush(t);

		const [, employeeError] = await t
			.withIdentity({ subject: "employee-acct" })
			.action(api.stripe.retryOrderRefund, { orderId: ids.orderId });
		expect(employeeError?.name).toBe("NOT_AUTHORIZED");
		expect(mockStripeClient.refunds.create).toHaveBeenCalledTimes(1);
		expect((await read(t, ids)).order?.paymentState).toBe("refund_failed");

		const [, managerError] = await manager(t).action(api.stripe.retryOrderRefund, {
			orderId: ids.orderId,
		});
		expect(managerError).toBeNull();
		expect((await read(t, ids)).order?.paymentState).toBe("paid");
	});

	it("refuses a retry on an order whose refund did not fail", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);

		const [, error] = await manager(t).action(api.stripe.retryOrderRefund, {
			orderId: ids.orderId,
		});
		expect(error?.message).toBe("ERROR_REFUND_NOT_RETRYABLE");
		expect(mockStripeClient.refunds.create).not.toHaveBeenCalled();
	});
});
