import { convexTest } from "convex-test";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const mockStripeClient = {
	v2: {
		core: {
			accounts: {
				create: vi.fn(),
				retrieve: vi.fn(),
			},
			accountLinks: {
				create: vi.fn(),
			},
			events: {
				retrieve: vi.fn(),
			},
		},
	},
	paymentIntents: {
		create: vi.fn(),
		retrieve: vi.fn(),
	},
	refunds: {
		create: vi.fn(),
	},
	webhooks: {
		constructEvent: vi.fn(),
	},
	parseEventNotification: vi.fn(),
};

const StripeConstructor = vi.fn(() => mockStripeClient);

vi.mock("stripe", () => ({
	default: StripeConstructor,
}));

async function seedOrganization(t: ReturnType<typeof convexTest>) {
	let organizationId: Id<"organizations">;

	await t.run(async (ctx) => {
		organizationId = await ctx.db.insert("organizations", {
			name: "Stripe Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});

	return organizationId!;
}

async function seedRestaurant(
	t: ReturnType<typeof convexTest>,
	args: {
		ownerId: string;
		organizationId: Id<"organizations">;
		stripeAccountId?: string;
		stripeOnboardingComplete?: boolean;
	}
) {
	let restaurantId: Id<"restaurants">;

	await t.run(async (ctx) => {
		const slug = `stripe-test-${Math.random().toString(36).slice(2, 10)}`;
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: args.ownerId,
			organizationId: args.organizationId,
			name: "Stripe Test Restaurant",
			slug,
			currency: "USD",
			stripeAccountId: args.stripeAccountId,
			stripeOnboardingComplete: args.stripeOnboardingComplete,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await insertMenuForRestaurant(ctx, {
			restaurantId,
			name: slug,
			userId: args.ownerId,
		});
	});

	return restaurantId!;
}

async function seedDraftOrder(
	t: ReturnType<typeof convexTest>,
	args: {
		restaurantId: Id<"restaurants">;
		totalAmount: number;
		dinerId?: string;
	}
) {
	const dinerId = args.dinerId ?? "diner-stripe";
	let tableId: Id<"tables">;
	let sessionId: Id<"sessions">;
	let orderId: Id<"orders">;

	await t.run(async (ctx) => {
		tableId = await ctx.db.insert("tables", {
			restaurantId: args.restaurantId,
			tableNumber: 1,
			isActive: true,
			createdAt: Date.now(),
		});

		sessionId = await ctx.db.insert("sessions", {
			restaurantId: args.restaurantId,
			tableId,
			userId: dinerId,
			status: "active",
			startedAt: Date.now(),
		});

		orderId = await ctx.db.insert("orders", {
			sessionId,
			restaurantId: args.restaurantId,
			tableId,
			status: "draft",
			totalAmount: args.totalAmount,
			paymentState: "unpaid",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});

	return { orderId: orderId!, diner: t.withIdentity({ subject: dinerId }) };
}

/**
 * Seeds an active session locked for payment with a submitted (payable) order
 * and a processing tab payment carrying `stripePaymentIntentId`. Mirrors the
 * mid-flight state a dropped `payment_intent.succeeded` webhook leaves behind.
 */
async function seedLockedTab(
	t: ReturnType<typeof convexTest>,
	args: {
		restaurantId: Id<"restaurants">;
		lockedForPaymentAt: number;
		stripePaymentIntentId: string;
		amount: number;
		gratuityAmount?: number;
	}
) {
	let sessionId: Id<"sessions">;
	let orderId: Id<"orders">;
	let paymentId: Id<"payments">;

	await t.run(async (ctx) => {
		const tableId = await ctx.db.insert("tables", {
			restaurantId: args.restaurantId,
			tableNumber: 7,
			isActive: true,
			createdAt: Date.now(),
		});
		sessionId = await ctx.db.insert("sessions", {
			restaurantId: args.restaurantId,
			tableId,
			userId: "diner-locked",
			status: "active",
			startedAt: args.lockedForPaymentAt - 60 * 60 * 1000,
			lockedForPaymentAt: args.lockedForPaymentAt,
			paymentState: "processing",
		});
		orderId = await ctx.db.insert("orders", {
			sessionId,
			restaurantId: args.restaurantId,
			tableId,
			status: "submitted",
			totalAmount: args.amount - (args.gratuityAmount ?? 0),
			paymentState: "unpaid",
			submittedAt: Date.now(),
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		paymentId = await ctx.db.insert("payments", {
			restaurantId: args.restaurantId,
			sessionId,
			amount: args.amount,
			currency: "usd",
			status: "processing",
			refundStatus: "none",
			attemptNumber: 1,
			stripePaymentIntentId: args.stripePaymentIntentId,
			gratuityAmount: args.gratuityAmount ?? 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.patch(sessionId, { activePaymentId: paymentId });
	});

	return { sessionId: sessionId!, orderId: orderId!, paymentId: paymentId! };
}

async function seedUserRole(
	t: ReturnType<typeof convexTest>,
	args: {
		userId: string;
		roles: Array<"admin" | "owner" | "manager" | "employee" | "customer">;
		organizationId?: Id<"organizations">;
	}
) {
	await t.run(async (ctx) => {
		await ctx.db.insert("userRoles", {
			userId: args.userId,
			roles: args.roles,
			organizationId: args.organizationId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
}

describe("stripe actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.STRIPE_SECRET_KEY = "sk_test_123";
		process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
		process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_connect_test";
	});

	it("allows a restaurant owner to create a connected account and persists the account id", async () => {
		const t = convexTest(schema, modules);
		const organizationId = await seedOrganization(t);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			organizationId,
		});

		mockStripeClient.v2.core.accounts.create.mockResolvedValueOnce({
			id: "acct_owner_success",
		});

		const owner = t.withIdentity({
			subject: "owner-1",
			email: "owner@example.com",
		});

		const result = await owner.action(api.stripe.createConnectAccount, {
			restaurantId,
		});

		expect(result).toEqual({ stripeAccountId: "acct_owner_success" });

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.stripeAccountId).toBe("acct_owner_success");
	});

	it("denies non-owners from reading Stripe status for another restaurant", async () => {
		const t = convexTest(schema, modules);
		const organizationId = await seedOrganization(t);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			organizationId,
		});

		const intruder = t.withIdentity({
			subject: "intruder-1",
			email: "intruder@example.com",
		});

		await expect(
			intruder.action(api.stripe.getAccountStatus, {
				restaurantId,
			})
		).rejects.toMatchObject({
			name: "NOT_AUTHORIZED",
		});
	});

	it("allows admins to read Stripe status for any restaurant", async () => {
		const t = convexTest(schema, modules);
		const organizationId = await seedOrganization(t);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			organizationId,
		});

		await seedUserRole(t, {
			userId: "admin-1",
			roles: ["admin"],
		});

		const admin = t.withIdentity({
			subject: "admin-1",
			email: "admin@example.com",
		});

		const result = await admin.action(api.stripe.getAccountStatus, {
			restaurantId,
		});

		expect(result).toEqual({
			connected: false,
			readyToReceivePayments: false,
			onboardingComplete: false,
			requirementsStatus: null,
		});
	});

	it("updates onboarding state via stripeAccountId lookups", async () => {
		const t = convexTest(schema, modules);
		const organizationId = await seedOrganization(t);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			organizationId,
			stripeAccountId: "acct_lookup_test",
			stripeOnboardingComplete: false,
		});

		await t.mutation(internal.stripeHelpers.updateOnboardingByAccountId, {
			stripeAccountId: "acct_lookup_test",
			stripeOnboardingComplete: true,
		});

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.stripeOnboardingComplete).toBe(true);
	});

	it("reuses an existing payment intent when the draft order is unchanged", async () => {
		const t = convexTest(schema, modules);
		const organizationId = await seedOrganization(t);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			organizationId,
			stripeAccountId: "acct_ready",
			stripeOnboardingComplete: true,
		});
		const { orderId, diner } = await seedDraftOrder(t, {
			restaurantId,
			totalAmount: 2400,
		});

		mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
			id: "pi_reuse_test",
			client_secret: "pi_secret_reuse",
		});
		mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
			id: "pi_reuse_test",
			client_secret: "pi_secret_reuse",
		});

		const first = await diner.action(api.stripe.createPaymentIntent, {
			orderId,
		});
		const second = await diner.action(api.stripe.createPaymentIntent, {
			orderId,
		});

		expect(first.clientSecret).toBe("pi_secret_reuse");
		expect(second.clientSecret).toBe("pi_secret_reuse");
		expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledTimes(1);
		expect(mockStripeClient.paymentIntents.retrieve).toHaveBeenCalledTimes(1);
	});

	it("supersedes the previous payment attempt when the draft order changes", async () => {
		const t = convexTest(schema, modules);
		const organizationId = await seedOrganization(t);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			organizationId,
			stripeAccountId: "acct_ready",
			stripeOnboardingComplete: true,
		});
		const { orderId, diner } = await seedDraftOrder(t, {
			restaurantId,
			totalAmount: 1800,
		});

		mockStripeClient.paymentIntents.create
			.mockResolvedValueOnce({
				id: "pi_original",
				client_secret: "pi_secret_original",
			})
			.mockResolvedValueOnce({
				id: "pi_replaced",
				client_secret: "pi_secret_replaced",
			});

		await diner.action(api.stripe.createPaymentIntent, {
			orderId,
		});

		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, {
				totalAmount: 2400,
				updatedAt: Date.now() + 5000,
			});
		});

		const second = await diner.action(api.stripe.createPaymentIntent, {
			orderId,
		});

		expect(second.clientSecret).toBe("pi_secret_replaced");

		const payments = await t.run(async (ctx) => ctx.db.query("payments").collect());
		expect(payments).toHaveLength(2);
		expect(payments.some((payment) => payment.status === "superseded")).toBe(true);
		expect(payments.some((payment) => payment.stripePaymentIntentId === "pi_replaced")).toBe(true);

		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.paymentState).toBe("processing");
		expect(order?.activePaymentId).toBeTruthy();
	});

	it("records Stripe webhook events once and ignores duplicate deliveries", async () => {
		const t = convexTest(schema, modules);
		const organizationId = await seedOrganization(t);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			organizationId,
			stripeAccountId: "acct_ready",
			stripeOnboardingComplete: true,
		});
		const { orderId } = await seedDraftOrder(t, {
			restaurantId,
			totalAmount: 2400,
		});

		const paymentId = await t.run(async (ctx) => {
			const order = await ctx.db.get(orderId);
			const menuId = await ctx.db.insert("menus", {
				restaurantId,
				name: "Menu",
				isActive: true,
				displayOrder: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			const categoryId = await ctx.db.insert("menuCategories", {
				menuId,
				restaurantId,
				name: "Cat",
				displayOrder: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			const menuItemId = await ctx.db.insert("menuItems", {
				categoryId,
				restaurantId,
				name: "Pizza",
				basePrice: 2400,
				isAvailable: true,
				displayOrder: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			await ctx.db.insert("orderItems", {
				orderId,
				menuItemId,
				menuItemName: "Pizza",
				quantity: 1,
				unitPrice: 2400,
				selectedOptions: [],
				lineTotal: 2400,
				createdAt: Date.now(),
			});
			const id = await ctx.db.insert("payments", {
				restaurantId,
				orderId,
				amount: 2400,
				currency: "usd",
				status: "processing",
				refundStatus: "none",
				attemptNumber: 1,
				orderUpdatedAtSnapshot: order!.updatedAt,
				stripePaymentIntentId: "pi_duplicate",
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			await ctx.db.patch(orderId, {
				activePaymentId: id,
				stripePaymentIntentId: "pi_duplicate",
				paymentState: "processing",
			});
			return id;
		});

		mockStripeClient.webhooks.constructEvent.mockReturnValue({
			id: "evt_duplicate",
			type: "payment_intent.succeeded",
			data: {
				object: {
					id: "pi_duplicate",
					metadata: { orderId, paymentId },
				},
			},
		});

		await t.action(internal.stripe.fulfillPayment, {
			payloadString: "{}",
			signatureHeader: "sig",
		});
		await t.action(internal.stripe.fulfillPayment, {
			payloadString: "{}",
			signatureHeader: "sig",
		});

		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.status).toBe("succeeded");

		const events = await t.run(async (ctx) => ctx.db.query("stripeWebhookEvents").collect());
		expect(events).toHaveLength(1);
		expect(events[0].eventId).toBe("evt_duplicate");
	});

	it("creates a refund with the destination-charge reversal settings after cancellation", async () => {
		vi.useFakeTimers();
		try {
			const t = convexTest(schema, modules);
			const organizationId = await seedOrganization(t);
			const restaurantId = await seedRestaurant(t, {
				ownerId: "owner-1",
				organizationId,
				stripeAccountId: "acct_refund",
				stripeOnboardingComplete: true,
			});
			const { orderId } = await seedDraftOrder(t, {
				restaurantId,
				totalAmount: 2400,
			});

			await t.run(async (ctx) => {
				const paymentId = await ctx.db.insert("payments", {
					restaurantId,
					orderId,
					amount: 2400,
					currency: "usd",
					status: "succeeded",
					refundStatus: "none",
					attemptNumber: 1,
					orderUpdatedAtSnapshot: Date.now(),
					stripePaymentIntentId: "pi_refund",
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});

				await ctx.db.patch(orderId, {
					status: "submitted",
					paymentState: "paid",
					activePaymentId: paymentId,
					stripePaymentIntentId: "pi_refund",
					paidAt: Date.now(),
					submittedAt: Date.now(),
					updatedAt: Date.now(),
				});

				await ctx.db.insert("userRoles", {
					userId: "owner-1",
					roles: ["owner"],
					organizationId,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});

			mockStripeClient.refunds.create.mockResolvedValueOnce({
				id: "re_refund",
				status: "succeeded",
				amount: 2400,
			});

			const owner = t.withIdentity({ subject: "owner-1" });
			const [result, error] = await owner.action(api.stripe.cancelOrderAndRefund, {
				orderId,
			});
			expect(error).toBeNull();
			expect(result?.refunded).toBe(true);

			// Legacy per-order payment: the order's share IS the whole charge, so
			// `amount` is omitted and the call matches the pre-partial-refund shape.
			expect(mockStripeClient.refunds.create).toHaveBeenCalledWith(
				{
					payment_intent: "pi_refund",
					reverse_transfer: true,
					refund_application_fee: true,
				},
				expect.objectContaining({
					idempotencyKey: expect.stringContaining("refund:"),
				})
			);

			const order = await t.run(async (ctx) => ctx.db.get(orderId));
			expect(order?.paymentState).toBe("refunded");
		} finally {
			vi.useRealTimers();
		}
	});

	describe("cancelOrderAndRefund — tab payments (TAVLI-50)", () => {
		/**
		 * One succeeded tab payment covering two submitted orders, plus a manager.
		 * Mirrors production: `payments.orderId` is unset (the tab carries
		 * `sessionId`), and the payment total includes a tip.
		 */
		async function seedPaidTabWithTwoOrders(t: ReturnType<typeof convexTest>) {
			const organizationId = await seedOrganization(t);
			const restaurantId = await seedRestaurant(t, {
				ownerId: "owner-tab",
				organizationId,
				stripeAccountId: "acct_tab",
				stripeOnboardingComplete: true,
			});

			let firstOrderId: Id<"orders">;
			let secondOrderId: Id<"orders">;
			let paymentId: Id<"payments">;

			await t.run(async (ctx) => {
				const tableId = await ctx.db.insert("tables", {
					restaurantId,
					tableNumber: 7,
					isActive: true,
					createdAt: Date.now(),
				});
				const sessionId = await ctx.db.insert("sessions", {
					restaurantId,
					tableId,
					userId: "diner-tab",
					status: "closed",
					startedAt: Date.now(),
				});

				const makeOrder = (totalAmount: number) =>
					ctx.db.insert("orders", {
						sessionId,
						restaurantId,
						tableId,
						status: "submitted",
						totalAmount,
						paymentState: "paid",
						paidAt: Date.now(),
						submittedAt: Date.now(),
						createdAt: Date.now(),
						updatedAt: Date.now(),
					});
				firstOrderId = await makeOrder(6000);
				secondOrderId = await makeOrder(4000);

				// 10000 subtotal + 1000 tip. No `orderId` — this is a tab payment.
				paymentId = await ctx.db.insert("payments", {
					restaurantId,
					sessionId,
					amount: 11000,
					gratuityAmount: 1000,
					currency: "mxn",
					status: "succeeded",
					refundStatus: "none",
					attemptNumber: 1,
					orderUpdatedAtSnapshot: Date.now(),
					stripePaymentIntentId: "pi_tab",
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});

				await ctx.db.patch(sessionId, { activePaymentId: paymentId });
				await ctx.db.insert("userRoles", {
					userId: "manager-tab",
					roles: ["manager"],
					organizationId,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("restaurantMembers", {
					userId: "manager-tab",
					restaurantId,
					organizationId,
					role: "manager",
					isActive: true,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					updatedBy: "system",
				});
			});

			return {
				firstOrderId: firstOrderId!,
				secondOrderId: secondOrderId!,
				paymentId: paymentId!,
				manager: t.withIdentity({ subject: "manager-tab" }),
			};
		}

		it("refunds only the cancelled order's share and leaves the rest of the tab alone", async () => {
			const t = convexTest(schema, modules);
			const { firstOrderId, secondOrderId, paymentId, manager } = await seedPaidTabWithTwoOrders(t);

			mockStripeClient.refunds.create.mockResolvedValueOnce({
				id: "re_first",
				status: "succeeded",
				amount: 6000,
			});

			const [result, error] = await manager.action(api.stripe.cancelOrderAndRefund, {
				orderId: firstOrderId,
			});

			expect(error).toBeNull();
			expect(result).toMatchObject({ refunded: true, amountRefunded: 6000 });

			// The order's own total, not the whole 11000 charge — and not the tip.
			expect(mockStripeClient.refunds.create).toHaveBeenCalledWith(
				{
					payment_intent: "pi_tab",
					amount: 6000,
					reverse_transfer: true,
					refund_application_fee: true,
				},
				{ idempotencyKey: `refund:${paymentId}:${firstOrderId}` }
			);

			const [first, second, payment] = await t.run(async (ctx) => [
				await ctx.db.get(firstOrderId),
				await ctx.db.get(secondOrderId),
				await ctx.db.get(paymentId),
			]);

			expect(first?.status).toBe("cancelled");
			expect(first?.paymentState).toBe("refunded");
			// The other order on the tab is untouched — the whole point of partial.
			expect(second?.status).toBe("submitted");
			expect(second?.paymentState).toBe("paid");
			// Money is left on the charge, so the payment is `partial`, matching
			// what the `charge.refunded` webhook independently derives.
			expect(payment?.refundStatus).toBe("partial");
		});

		it("uses a distinct idempotency key for a second order on the same tab", async () => {
			// With the old payment-scoped key Stripe would replay the first
			// refund's response and the diner would never see this money.
			const t = convexTest(schema, modules);
			const { firstOrderId, secondOrderId, paymentId, manager } = await seedPaidTabWithTwoOrders(t);

			mockStripeClient.refunds.create
				.mockResolvedValueOnce({ id: "re_first", status: "succeeded", amount: 6000 })
				.mockResolvedValueOnce({ id: "re_second", status: "succeeded", amount: 4000 });

			await manager.action(api.stripe.cancelOrderAndRefund, { orderId: firstOrderId });
			await manager.action(api.stripe.cancelOrderAndRefund, { orderId: secondOrderId });

			const keys = mockStripeClient.refunds.create.mock.calls.map(
				(call) => (call[1] as { idempotencyKey: string }).idempotencyKey
			);
			expect(keys).toEqual([
				`refund:${paymentId}:${firstOrderId}`,
				`refund:${paymentId}:${secondOrderId}`,
			]);
			expect(new Set(keys).size).toBe(2);
		});

		it("cancels the order and flags refund_failed when Stripe rejects the refund", async () => {
			// Cancel-first: the kitchen must stop cooking even if the money fails,
			// and the failure has to be visible rather than swallowed.
			const t = convexTest(schema, modules);
			const { firstOrderId, paymentId, manager } = await seedPaidTabWithTwoOrders(t);

			mockStripeClient.refunds.create.mockRejectedValueOnce(new Error("card_error"));

			const [result, error] = await manager.action(api.stripe.cancelOrderAndRefund, {
				orderId: firstOrderId,
			});

			expect(result).toBeNull();
			expect(error!.message).toBe("ERROR_REFUND_FAILED");

			const [order, payment] = await t.run(async (ctx) => [
				await ctx.db.get(firstOrderId),
				await ctx.db.get(paymentId),
			]);
			expect(order?.status).toBe("cancelled");
			expect(order?.paymentState).toBe("refund_failed");
			expect(payment?.refundStatus).toBe("failed");
		});

		it("cancels an unpaid order without calling Stripe", async () => {
			const t = convexTest(schema, modules);
			const { firstOrderId, manager } = await seedPaidTabWithTwoOrders(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(firstOrderId, { paymentState: "unpaid", paidAt: undefined });
			});

			const [result, error] = await manager.action(api.stripe.cancelOrderAndRefund, {
				orderId: firstOrderId,
			});

			expect(error).toBeNull();
			expect(result).toMatchObject({ refunded: false, skippedReason: "not_paid" });
			expect(mockStripeClient.refunds.create).not.toHaveBeenCalled();
		});

		it("refuses to let an employee cancel and refund", async () => {
			const t = convexTest(schema, modules);
			const { firstOrderId, manager: _manager } = await seedPaidTabWithTwoOrders(t);

			const [result, error] = await t
				.withIdentity({ subject: "nobody" })
				.action(api.stripe.cancelOrderAndRefund, { orderId: firstOrderId });

			expect(result).toBeNull();
			expect(error!.name).toBe("NOT_AUTHORIZED");
			expect(mockStripeClient.refunds.create).not.toHaveBeenCalled();
		});
	});

	it("rejects invalid webhook signatures without mutating local state", async () => {
		const t = convexTest(schema, modules);
		mockStripeClient.webhooks.constructEvent.mockImplementationOnce(() => {
			throw new Error("Invalid signature");
		});

		await expect(
			t.action(internal.stripe.fulfillPayment, {
				payloadString: "{}",
				signatureHeader: "bad_sig",
			})
		).rejects.toThrow("Invalid signature");

		const events = await t.run(async (ctx) => ctx.db.query("stripeWebhookEvents").collect());
		expect(events).toHaveLength(0);
	});

	describe("reconcileStuckTabPayments (TAVLI-45)", () => {
		it("settles a stuck tab whose PaymentIntent already succeeded", async () => {
			const t = convexTest(schema, modules);
			const organizationId = await seedOrganization(t);
			const restaurantId = await seedRestaurant(t, {
				ownerId: "owner-1",
				organizationId,
				stripeAccountId: "acct_ready",
				stripeOnboardingComplete: true,
			});
			const { sessionId, orderId, paymentId } = await seedLockedTab(t, {
				restaurantId,
				lockedForPaymentAt: Date.now() - 15 * 60 * 1000,
				stripePaymentIntentId: "pi_stuck_success",
				amount: 1980,
				gratuityAmount: 180,
			});

			mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
				id: "pi_stuck_success",
				status: "succeeded",
				latest_charge: "ch_stuck",
				metadata: { gratuityAmount: "180" },
			});

			await t.action(internal.stripe.reconcileStuckTabPayments, {});

			await t.run(async (ctx) => {
				const session = await ctx.db.get(sessionId);
				expect(session!.status).toBe("closed");
				expect(session!.paymentState).toBe("paid");
				expect(session!.lockedForPaymentAt).toBeUndefined();
				expect(session!.settledBy).toBe("stripe");
				expect(session!.tipAmount).toBe(180);

				const order = await ctx.db.get(orderId);
				expect(order!.paymentState).toBe("paid");

				const payment = await ctx.db.get(paymentId);
				expect(payment!.status).toBe("succeeded");
				expect(payment!.stripeChargeId).toBe("ch_stuck");
			});
		});

		it("unlocks a stuck tab whose PaymentIntent was canceled", async () => {
			const t = convexTest(schema, modules);
			const organizationId = await seedOrganization(t);
			const restaurantId = await seedRestaurant(t, {
				ownerId: "owner-1",
				organizationId,
				stripeAccountId: "acct_ready",
				stripeOnboardingComplete: true,
			});
			const { sessionId, orderId, paymentId } = await seedLockedTab(t, {
				restaurantId,
				lockedForPaymentAt: Date.now() - 20 * 60 * 1000,
				stripePaymentIntentId: "pi_stuck_canceled",
				amount: 1800,
			});

			mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
				id: "pi_stuck_canceled",
				status: "canceled",
			});

			await t.action(internal.stripe.reconcileStuckTabPayments, {});

			await t.run(async (ctx) => {
				const session = await ctx.db.get(sessionId);
				// Unlocked but not closed — the group can retry or staff can settle.
				expect(session!.status).toBe("active");
				expect(session!.lockedForPaymentAt).toBeUndefined();
				expect(session!.paymentState).toBe("failed");

				const order = await ctx.db.get(orderId);
				expect(order!.paymentState).toBe("unpaid");

				const payment = await ctx.db.get(paymentId);
				expect(payment!.status).toBe("failed");
				expect(payment!.failureCode).toBe("reconcile_canceled");
			});
		});

		it("leaves a still-processing tab locked", async () => {
			const t = convexTest(schema, modules);
			const organizationId = await seedOrganization(t);
			const restaurantId = await seedRestaurant(t, {
				ownerId: "owner-1",
				organizationId,
				stripeAccountId: "acct_ready",
				stripeOnboardingComplete: true,
			});
			const lockedForPaymentAt = Date.now() - 15 * 60 * 1000;
			const { sessionId, paymentId } = await seedLockedTab(t, {
				restaurantId,
				lockedForPaymentAt,
				stripePaymentIntentId: "pi_stuck_processing",
				amount: 1800,
			});

			mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
				id: "pi_stuck_processing",
				status: "processing",
			});

			await t.action(internal.stripe.reconcileStuckTabPayments, {});

			await t.run(async (ctx) => {
				const session = await ctx.db.get(sessionId);
				expect(session!.status).toBe("active");
				expect(session!.lockedForPaymentAt).toBe(lockedForPaymentAt);
				expect(session!.paymentState).toBe("processing");

				const payment = await ctx.db.get(paymentId);
				expect(payment!.status).toBe("processing");
			});
		});

		it("ignores tabs locked more recently than the reconcile window", async () => {
			const t = convexTest(schema, modules);
			const organizationId = await seedOrganization(t);
			const restaurantId = await seedRestaurant(t, {
				ownerId: "owner-1",
				organizationId,
				stripeAccountId: "acct_ready",
				stripeOnboardingComplete: true,
			});
			const lockedForPaymentAt = Date.now() - 2 * 60 * 1000;
			const { sessionId } = await seedLockedTab(t, {
				restaurantId,
				lockedForPaymentAt,
				stripePaymentIntentId: "pi_fresh_lock",
				amount: 1800,
			});

			await t.action(internal.stripe.reconcileStuckTabPayments, {});

			// The freshly-locked tab is outside the (0, now-10m) index window, so
			// Stripe is never consulted and the lock stands.
			expect(mockStripeClient.paymentIntents.retrieve).not.toHaveBeenCalled();
			await t.run(async (ctx) => {
				const session = await ctx.db.get(sessionId);
				expect(session!.lockedForPaymentAt).toBe(lockedForPaymentAt);
			});
		});
	});
});
