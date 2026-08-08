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
		cancel: vi.fn(),
	},
	customers: {
		create: vi.fn(),
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

		mockStripeClient.customers.create.mockResolvedValue({ id: "cus_reuse" });
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

		mockStripeClient.customers.create.mockResolvedValue({ id: "cus_supersede" });
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

	describe("createTabPaymentIntent — settlement blocking", () => {
		/** An open tab holding one order at `status`, ready for checkout. */
		async function seedTabAtStatus(
			t: ReturnType<typeof convexTest>,
			args: { restaurantId: Id<"restaurants">; status: string; totalAmount: number }
		) {
			let sessionId: Id<"sessions">;
			await t.run(async (ctx) => {
				const tableId = await ctx.db.insert("tables", {
					restaurantId: args.restaurantId,
					tableNumber: 3,
					isActive: true,
					createdAt: Date.now(),
				});
				sessionId = await ctx.db.insert("sessions", {
					restaurantId: args.restaurantId,
					tableId,
					userId: "diner-checkout",
					status: "active",
					startedAt: Date.now(),
				});
				await ctx.db.insert("orders", {
					sessionId,
					restaurantId: args.restaurantId,
					tableId,
					status: args.status,
					totalAmount: args.totalAmount,
					paymentState: "unpaid",
					submittedAt: Date.now(),
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});
			return {
				sessionId: sessionId!,
				diner: t.withIdentity({ subject: "diner-checkout" }),
			};
		}

		async function seedPayableRestaurant(t: ReturnType<typeof convexTest>) {
			const organizationId = await seedOrganization(t);
			return seedRestaurant(t, {
				ownerId: "owner-checkout",
				organizationId,
				stripeAccountId: "acct_checkout",
				stripeOnboardingComplete: true,
			});
		}

		it("refuses to charge a tab holding food the kitchen hasn't delivered", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedPayableRestaurant(t);
			const { sessionId, diner } = await seedTabAtStatus(t, {
				restaurantId,
				status: "preparing",
				totalAmount: 1800,
			});

			await expect(
				diner.action(api.stripe.createTabPaymentIntent, { sessionId, tipAmount: 0 })
			).rejects.toThrow(/ERROR_TAB_HAS_UNSERVED_ORDERS/);

			// The point of the whole ticket: no charge exists, so there is nothing
			// to refund when this order is cancelled.
			expect(mockStripeClient.paymentIntents.create).not.toHaveBeenCalled();
		});

		it("creates the intent once every order has been served", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedPayableRestaurant(t);
			const { sessionId, diner } = await seedTabAtStatus(t, {
				restaurantId,
				status: "served",
				totalAmount: 1800,
			});
			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_served_tab",
				client_secret: "cs_served_tab",
			});

			const result = await diner.action(api.stripe.createTabPaymentIntent, {
				sessionId,
				tipAmount: 200,
			});

			expect(result.clientSecret).toBe("cs_served_tab");
			expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledWith(
				expect.objectContaining({ amount: 2000 }),
				expect.anything()
			);
		});

		it("still reports an empty tab as empty rather than blocked", async () => {
			// Pins the check ordering: TAB_EMPTY wins at subtotal 0, matching the
			// frontend, which short-circuits to its empty state on `subtotal <= 0`.
			const t = convexTest(schema, modules);
			const restaurantId = await seedPayableRestaurant(t);
			const { sessionId, diner } = await seedTabAtStatus(t, {
				restaurantId,
				status: "preparing",
				totalAmount: 0,
			});

			await expect(
				diner.action(api.stripe.createTabPaymentIntent, { sessionId, tipAmount: 0 })
			).rejects.toThrow(/ERROR_TAB_EMPTY/);
			expect(mockStripeClient.paymentIntents.create).not.toHaveBeenCalled();
		});
	});

	describe("createPaymentIntent — pay-at-submit (ADR 008)", () => {
		/** Menu scaffolding + one order item so `confirmPayment` can settle the order. */
		async function seedOrderItemFor(
			t: ReturnType<typeof convexTest>,
			args: { restaurantId: Id<"restaurants">; orderId: Id<"orders">; lineTotal: number }
		) {
			await t.run(async (ctx) => {
				const menuId = await ctx.db.insert("menus", {
					restaurantId: args.restaurantId,
					name: "Menu",
					isActive: true,
					displayOrder: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				const categoryId = await ctx.db.insert("menuCategories", {
					menuId,
					restaurantId: args.restaurantId,
					name: "Cat",
					displayOrder: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				const menuItemId = await ctx.db.insert("menuItems", {
					categoryId,
					restaurantId: args.restaurantId,
					name: "Pozole",
					basePrice: args.lineTotal,
					isAvailable: true,
					displayOrder: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId: args.orderId,
					menuItemId,
					menuItemName: "Pozole",
					quantity: 1,
					unitPrice: args.lineTotal,
					selectedOptions: [],
					lineTotal: args.lineTotal,
					createdAt: Date.now(),
				});
			});
		}

		it("charges subtotal + customer-borne fee and saves the card on the diner's Customer", async () => {
			const t = convexTest(schema, modules);
			const organizationId = await seedOrganization(t);
			const restaurantId = await seedRestaurant(t, {
				ownerId: "owner-1",
				organizationId,
				stripeAccountId: "acct_ready",
				stripeOnboardingComplete: true,
			});
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 10000 });

			mockStripeClient.customers.create.mockResolvedValueOnce({ id: "cus_fee" });
			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_fee",
				client_secret: "cs_fee",
			});

			const result = await diner.action(api.stripe.createPaymentIntent, { orderId });
			expect(result.clientSecret).toBe("cs_fee");

			// One platform-level Customer per Clerk user, created idempotently.
			expect(mockStripeClient.customers.create).toHaveBeenCalledWith(
				{ metadata: { clerkUserId: "diner-stripe" } },
				{ idempotencyKey: "customer:diner-stripe" }
			);

			// 10000 subtotal → 1200 fee (12%, on top) → 11200 charged; the fee is
			// the application fee so the restaurant nets the full subtotal.
			expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledWith(
				expect.objectContaining({
					amount: 11200,
					currency: "usd",
					customer: "cus_fee",
					setup_future_usage: "off_session",
					application_fee_amount: 1200,
					transfer_data: { destination: "acct_ready" },
					on_behalf_of: "acct_ready",
					metadata: expect.objectContaining({
						orderId,
						kind: "order",
						subtotalAmount: "10000",
						feeAmount: "1200",
					}),
				}),
				{ idempotencyKey: `order-payment:${result.paymentId}` }
			);

			const { payment, customerRow } = await t.run(async (ctx) => ({
				payment: await ctx.db.get(result.paymentId),
				customerRow: await ctx.db
					.query("stripeCustomers")
					.withIndex("by_user", (q) => q.eq("userId", "diner-stripe"))
					.first(),
			}));
			expect(payment).toMatchObject({
				amount: 11200,
				subtotalAmount: 10000,
				feeAmount: 1200,
				kind: "order",
				paidByUserId: "diner-stripe",
				status: "processing",
			});
			expect(customerRow?.stripeCustomerId).toBe("cus_fee");
		});

		it("lets a join-code member pay for their own draft but rejects a non-member", async () => {
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
				dinerId: "opener-1",
			});
			await t.run(async (ctx) => {
				const order = await ctx.db.get(orderId);
				await ctx.db.patch(order!.sessionId, { memberUserIds: ["joiner-1"] });
			});

			await expect(
				t.withIdentity({ subject: "stranger-1" }).action(api.stripe.createPaymentIntent, {
					orderId,
				})
			).rejects.toThrow(/ERROR_SESSION_ACCESS_DENIED/);
			expect(mockStripeClient.paymentIntents.create).not.toHaveBeenCalled();

			mockStripeClient.customers.create.mockResolvedValueOnce({ id: "cus_joiner" });
			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_joiner",
				client_secret: "cs_joiner",
			});

			const result = await t
				.withIdentity({ subject: "joiner-1" })
				.action(api.stripe.createPaymentIntent, { orderId });
			expect(result.clientSecret).toBe("cs_joiner");

			// The payer is the joiner, not the session opener.
			const payment = await t.run(async (ctx) => ctx.db.get(result.paymentId));
			expect(payment?.paidByUserId).toBe("joiner-1");
		});

		it("settles the order via the webhook and persists the saved payment method", async () => {
			const t = convexTest(schema, modules);
			const organizationId = await seedOrganization(t);
			const restaurantId = await seedRestaurant(t, {
				ownerId: "owner-1",
				organizationId,
				stripeAccountId: "acct_ready",
				stripeOnboardingComplete: true,
			});
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 2400 });
			await seedOrderItemFor(t, { restaurantId, orderId, lineTotal: 2400 });

			mockStripeClient.customers.create.mockResolvedValueOnce({ id: "cus_settle" });
			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_settle",
				client_secret: "cs_settle",
			});
			const { paymentId } = await diner.action(api.stripe.createPaymentIntent, { orderId });

			mockStripeClient.webhooks.constructEvent.mockReturnValue({
				id: "evt_settle",
				type: "payment_intent.succeeded",
				data: {
					object: {
						id: "pi_settle",
						latest_charge: "ch_settle",
						payment_method: "pm_saved_card",
						metadata: { orderId, paymentId },
					},
				},
			});
			await t.action(internal.stripe.fulfillPayment, {
				payloadString: "{}",
				signatureHeader: "sig",
			});

			const { order, payment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(orderId),
				payment: await ctx.db.get(paymentId),
			}));
			// The kitchen sees the order only now.
			expect(order?.status).toBe("submitted");
			expect(order?.paymentState).toBe("paid");
			expect(order?.settledBy).toBe("stripe");
			expect(order?.paidByUserId).toBe("diner-stripe");
			expect(order?.dailyOrderNumber).toBe(1);
			expect(payment?.status).toBe("succeeded");
			// Needed for one-tap tips / substitution deltas later.
			expect(payment?.stripePaymentMethodId).toBe("pm_saved_card");
		});

		it("no-ops confirmation when the order total drifted from the payment's subtotal", async () => {
			const t = convexTest(schema, modules);
			const organizationId = await seedOrganization(t);
			const restaurantId = await seedRestaurant(t, {
				ownerId: "owner-1",
				organizationId,
				stripeAccountId: "acct_ready",
				stripeOnboardingComplete: true,
			});
			const { orderId } = await seedDraftOrder(t, { restaurantId, totalAmount: 6000 });
			await seedOrderItemFor(t, { restaurantId, orderId, lineTotal: 6000 });

			const paymentId = await t.run(async (ctx) => {
				const order = await ctx.db.get(orderId);
				const id = await ctx.db.insert("payments", {
					restaurantId,
					orderId,
					// Intent priced off an older 5000 subtotal; the order now says 6000.
					amount: 5600,
					subtotalAmount: 5000,
					feeAmount: 600,
					kind: "order",
					currency: "usd",
					status: "processing",
					refundStatus: "none",
					attemptNumber: 1,
					orderUpdatedAtSnapshot: order!.updatedAt,
					stripePaymentIntentId: "pi_drift",
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.patch(orderId, { activePaymentId: id });
				return id;
			});

			await t.mutation(internal.orders.confirmPayment, {
				paymentId,
				stripePaymentIntentId: "pi_drift",
			});

			const { order, payment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(orderId),
				payment: await ctx.db.get(paymentId),
			}));
			// Warn-and-skip: a fresh intent will supersede this one.
			expect(order?.status).toBe("draft");
			expect(payment?.status).toBe("processing");
		});

		it("still settles a legacy payment that has no subtotalAmount (?? fallback)", async () => {
			const t = convexTest(schema, modules);
			const organizationId = await seedOrganization(t);
			const restaurantId = await seedRestaurant(t, {
				ownerId: "owner-1",
				organizationId,
				stripeAccountId: "acct_ready",
				stripeOnboardingComplete: true,
			});
			const { orderId } = await seedDraftOrder(t, { restaurantId, totalAmount: 2400 });
			await seedOrderItemFor(t, { restaurantId, orderId, lineTotal: 2400 });

			const paymentId = await t.run(async (ctx) => {
				const order = await ctx.db.get(orderId);
				const id = await ctx.db.insert("payments", {
					restaurantId,
					orderId,
					amount: 2400,
					currency: "usd",
					status: "processing",
					refundStatus: "none",
					attemptNumber: 1,
					orderUpdatedAtSnapshot: order!.updatedAt,
					stripePaymentIntentId: "pi_legacy_confirm",
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.patch(orderId, { activePaymentId: id });
				return id;
			});

			await t.mutation(internal.orders.confirmPayment, {
				paymentId,
				stripePaymentIntentId: "pi_legacy_confirm",
			});

			const order = await t.run(async (ctx) => ctx.db.get(orderId));
			expect(order?.status).toBe("submitted");
			expect(order?.paymentState).toBe("paid");
		});

		it("lets a diner switch from cash to card: awaiting_payment order pays and settles", async () => {
			const t = convexTest(schema, modules);
			const organizationId = await seedOrganization(t);
			const restaurantId = await seedRestaurant(t, {
				ownerId: "owner-1",
				organizationId,
				stripeAccountId: "acct_ready",
				stripeOnboardingComplete: true,
			});
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 2400 });
			await seedOrderItemFor(t, { restaurantId, orderId, lineTotal: 2400 });

			await diner.mutation(api.orders.requestPayInPerson, { orderId });
			const committed = await t.run(async (ctx) => ctx.db.get(orderId));
			expect(committed?.status).toBe("awaiting_payment");
			expect(committed?.dailyOrderNumber).toBe(1);

			mockStripeClient.customers.create.mockResolvedValueOnce({ id: "cus_switch" });
			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_switch",
				client_secret: "cs_switch",
			});
			const { paymentId } = await diner.action(api.stripe.createPaymentIntent, { orderId });

			mockStripeClient.webhooks.constructEvent.mockReturnValue({
				id: "evt_switch",
				type: "payment_intent.succeeded",
				data: {
					object: {
						id: "pi_switch",
						payment_method: "pm_switch",
						metadata: { orderId, paymentId },
					},
				},
			});
			await t.action(internal.stripe.fulfillPayment, {
				payloadString: "{}",
				signatureHeader: "sig",
			});

			const order = await t.run(async (ctx) => ctx.db.get(orderId));
			expect(order?.status).toBe("submitted");
			expect(order?.paymentState).toBe("paid");
			expect(order?.settledBy).toBe("stripe");
			// The number allocated at cash-commit time survives — no re-allocation.
			expect(order?.dailyOrderNumber).toBe(1);
		});
	});

	describe("cancelOrderPaymentIntent — stale-payment-sheet interlock (ADR 008)", () => {
		/** Draft order with a live processing intent, exactly as the checkout leaves it. */
		async function seedOrderWithProcessingIntent(t: ReturnType<typeof convexTest>) {
			const organizationId = await seedOrganization(t);
			const restaurantId = await seedRestaurant(t, {
				ownerId: "owner-1",
				organizationId,
				stripeAccountId: "acct_ready",
				stripeOnboardingComplete: true,
			});
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 5000 });

			mockStripeClient.customers.create.mockResolvedValueOnce({ id: "cus_cancel" });
			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_cancel_me",
				client_secret: "cs_cancel_me",
			});
			const { paymentId } = await diner.action(api.stripe.createPaymentIntent, { orderId });

			return { orderId, paymentId, diner, restaurantId };
		}

		it("cancels the intent at Stripe and clears the payment row + order pointer", async () => {
			const t = convexTest(schema, modules);
			const { orderId, paymentId, diner } = await seedOrderWithProcessingIntent(t);

			mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
				id: "pi_cancel_me",
				status: "requires_payment_method",
			});
			mockStripeClient.paymentIntents.cancel.mockResolvedValueOnce({
				id: "pi_cancel_me",
				status: "canceled",
			});

			const result = await diner.action(api.stripe.cancelOrderPaymentIntent, { orderId });
			expect(result).toEqual({ cancelled: true, settled: false });
			expect(mockStripeClient.paymentIntents.cancel).toHaveBeenCalledWith("pi_cancel_me");

			const { order, payment, events } = await t.run(async (ctx) => ({
				order: await ctx.db.get(orderId),
				payment: await ctx.db.get(paymentId),
				events: await ctx.db
					.query("allEvents")
					.filter((q) => q.eq(q.field("aggregateId"), orderId))
					.collect(),
			}));
			expect(payment?.status).toBe("cancelled");
			expect(order?.activePaymentId).toBeUndefined();
			expect(order?.stripePaymentIntentId).toBeUndefined();
			expect(order?.paymentState).toBe("unpaid");
			// Still a draft — abandoning payment never advances the order.
			expect(order?.status).toBe("draft");
			expect(events.some((e) => e.eventType === "orders.paymentCancelled")).toBe(true);
		});

		it("cash switch REQUIRES the cancel: requestPayInPerson rejects in-flight, succeeds after", async () => {
			const t = convexTest(schema, modules);
			const { orderId, diner, restaurantId } = await seedOrderWithProcessingIntent(t);
			// The action path settles through confirmPayment eventually; the cash
			// path needs a live line to commit.
			await t.run(async (ctx) => {
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
					name: "Tacos",
					basePrice: 5000,
					isAvailable: true,
					displayOrder: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId,
					menuItemId,
					menuItemName: "Tacos",
					quantity: 1,
					unitPrice: 5000,
					selectedOptions: [],
					lineTotal: 5000,
					createdAt: Date.now(),
				});
			});

			await expect(diner.mutation(api.orders.requestPayInPerson, { orderId })).rejects.toThrow(
				/ERROR_ORDER_PAYMENT_IN_FLIGHT/
			);

			mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
				id: "pi_cancel_me",
				status: "requires_confirmation",
			});
			mockStripeClient.paymentIntents.cancel.mockResolvedValueOnce({
				id: "pi_cancel_me",
				status: "canceled",
			});
			await diner.action(api.stripe.cancelOrderPaymentIntent, { orderId });

			await diner.mutation(api.orders.requestPayInPerson, { orderId });
			const order = await t.run(async (ctx) => ctx.db.get(orderId));
			expect(order?.status).toBe("awaiting_payment");
		});

		it("leaves an intent that already succeeded at Stripe for the webhook to settle", async () => {
			const t = convexTest(schema, modules);
			const { orderId, paymentId, diner } = await seedOrderWithProcessingIntent(t);

			mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
				id: "pi_cancel_me",
				status: "succeeded",
			});

			const result = await diner.action(api.stripe.cancelOrderPaymentIntent, { orderId });
			// `settled` is what tells the checkout to stand down instead of firing
			// `requestPayInPerson` into ERROR_ORDER_PAYMENT_IN_FLIGHT.
			expect(result).toEqual({ cancelled: false, settled: true });
			expect(mockStripeClient.paymentIntents.cancel).not.toHaveBeenCalled();

			const { order, payment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(orderId),
				payment: await ctx.db.get(paymentId),
			}));
			// Untouched: the webhook owns this settlement.
			expect(payment?.status).toBe("processing");
			expect(order?.activePaymentId).toBe(paymentId);
		});

		it("no-ops without an active payment and rejects non-members", async () => {
			const t = convexTest(schema, modules);
			const organizationId = await seedOrganization(t);
			const restaurantId = await seedRestaurant(t, {
				ownerId: "owner-1",
				organizationId,
				stripeAccountId: "acct_ready",
				stripeOnboardingComplete: true,
			});
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 3000 });

			await expect(
				t
					.withIdentity({ subject: "stranger-1" })
					.action(api.stripe.cancelOrderPaymentIntent, { orderId })
			).rejects.toThrow(/ERROR_SESSION_ACCESS_DENIED/);

			// Nothing to cancel is NOT a settled charge — the cash switch proceeds.
			const result = await diner.action(api.stripe.cancelOrderPaymentIntent, { orderId });
			expect(result).toEqual({ cancelled: false, settled: false });
			expect(mockStripeClient.paymentIntents.cancel).not.toHaveBeenCalled();
		});
	});

	describe("refundOrderItem — 86 on a paid order (ADR 008)", () => {
		/**
		 * A paid pay-at-submit order (subtotal 1400 → charge 1568) with two live
		 * lines, plus a staff identity. `activePaymentId` points at the succeeded
		 * kind-"order" payment, as `confirmPayment` leaves it.
		 */
		async function seedPaidOrderWithTwoLines(t: ReturnType<typeof convexTest>) {
			const organizationId = await seedOrganization(t);
			const restaurantId = await seedRestaurant(t, {
				ownerId: "owner-86",
				organizationId,
				stripeAccountId: "acct_86",
				stripeOnboardingComplete: true,
			});

			let orderId: Id<"orders">;
			let tacosItemId: Id<"orderItems">;
			let drinkItemId: Id<"orderItems">;
			let paymentId: Id<"payments">;

			await t.run(async (ctx) => {
				await ctx.db.insert("userRoles", {
					userId: "owner-86",
					roles: ["owner"],
					organizationId,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				const tableId = await ctx.db.insert("tables", {
					restaurantId,
					tableNumber: 12,
					isActive: true,
					createdAt: Date.now(),
				});
				const sessionId = await ctx.db.insert("sessions", {
					restaurantId,
					tableId,
					userId: "diner-86",
					status: "active",
					startedAt: Date.now(),
				});
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
				const makeMenuItem = (name: string, basePrice: number) =>
					ctx.db.insert("menuItems", {
						categoryId,
						restaurantId,
						name,
						basePrice,
						isAvailable: true,
						displayOrder: 0,
						createdAt: Date.now(),
						updatedAt: Date.now(),
					});
				const tacosMenuItemId = await makeMenuItem("Tacos", 800);
				const drinkMenuItemId = await makeMenuItem("Agua fresca", 600);

				orderId = await ctx.db.insert("orders", {
					sessionId,
					restaurantId,
					tableId,
					status: "submitted",
					totalAmount: 1400,
					paymentState: "paid",
					settledBy: "stripe",
					paidAt: Date.now(),
					submittedAt: Date.now(),
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				const makeItem = (menuItemId: Id<"menuItems">, name: string, lineTotal: number) =>
					ctx.db.insert("orderItems", {
						orderId,
						menuItemId,
						menuItemName: name,
						quantity: 1,
						unitPrice: lineTotal,
						selectedOptions: [],
						lineTotal,
						createdAt: Date.now(),
					});
				tacosItemId = await makeItem(tacosMenuItemId, "Tacos", 800);
				drinkItemId = await makeItem(drinkMenuItemId, "Agua fresca", 600);

				paymentId = await ctx.db.insert("payments", {
					restaurantId,
					orderId,
					amount: 1568,
					subtotalAmount: 1400,
					feeAmount: 168,
					kind: "order",
					paidByUserId: "diner-86",
					currency: "usd",
					status: "succeeded",
					refundStatus: "none",
					attemptNumber: 1,
					stripePaymentIntentId: "pi_86",
					succeededAt: Date.now(),
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.patch(orderId, { activePaymentId: paymentId });
			});

			return {
				orderId: orderId!,
				tacosItemId: tacosItemId!,
				drinkItemId: drinkItemId!,
				paymentId: paymentId!,
				staff: t.withIdentity({ subject: "owner-86" }),
			};
		}

		it("refunds the line plus its fee share while the order keeps cooking", async () => {
			vi.useFakeTimers();
			try {
				const t = convexTest(schema, modules);
				const { orderId, drinkItemId, paymentId, staff } = await seedPaidOrderWithTwoLines(t);

				mockStripeClient.refunds.create.mockResolvedValueOnce({
					id: "re_line",
					status: "succeeded",
					amount: 672,
				});

				const [, error] = await staff.mutation(api.orders.cancelOrderItem, {
					orderItemId: drinkItemId,
				});
				expect(error).toBeNull();
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());

				// 600 line + round(600 × 12%) = 672, keyed per (payment, line).
				expect(mockStripeClient.refunds.create).toHaveBeenCalledWith(
					{
						payment_intent: "pi_86",
						amount: 672,
						reverse_transfer: true,
						refund_application_fee: true,
					},
					{ idempotencyKey: `refund:${paymentId}:${drinkItemId}` }
				);

				const { order, item, payment } = await t.run(async (ctx) => ({
					order: await ctx.db.get(orderId),
					item: await ctx.db.get(drinkItemId),
					payment: await ctx.db.get(paymentId),
				}));
				// The order keeps cooking and stays paid — only the line's money moved.
				expect(order?.status).toBe("submitted");
				expect(order?.paymentState).toBe("paid");
				expect(order?.totalAmount).toBe(800);
				expect(item?.refundedAt).toBeTypeOf("number");
				expect(item?.refundAmount).toBe(672);
				expect(item?.stripeRefundId).toBe("re_line");
				expect(payment?.refundStatus).toBe("partial");
				expect(payment?.amountRefunded).toBe(672);
			} finally {
				vi.useRealTimers();
			}
		});

		it("sweeps the entire remaining balance when the last live line is 86'd", async () => {
			vi.useFakeTimers();
			try {
				const t = convexTest(schema, modules);
				const { orderId, tacosItemId, drinkItemId, paymentId, staff } =
					await seedPaidOrderWithTwoLines(t);

				mockStripeClient.refunds.create
					.mockResolvedValueOnce({ id: "re_first", status: "succeeded", amount: 672 })
					.mockResolvedValueOnce({ id: "re_last", status: "succeeded", amount: 896 });

				await staff.mutation(api.orders.cancelOrderItem, { orderItemId: drinkItemId });
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());
				await staff.mutation(api.orders.cancelOrderItem, { orderItemId: tacosItemId });
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());

				// 672 + 896 = 1568 — the sum of line refunds is exactly the charge,
				// so no rounding residue survives a fully-86'd order.
				const amounts = mockStripeClient.refunds.create.mock.calls.map(
					(call) => (call[0] as { amount: number }).amount
				);
				expect(amounts).toEqual([672, 896]);

				const { order, payment } = await t.run(async (ctx) => ({
					order: await ctx.db.get(orderId),
					payment: await ctx.db.get(paymentId),
				}));
				expect(order?.status).toBe("cancelled");
				expect(order?.paymentState).toBe("refunded");
				expect(payment?.amountRefunded).toBe(1568);
			} finally {
				vi.useRealTimers();
			}
		});

		it("surfaces refund_failed when Stripe rejects the line refund", async () => {
			vi.useFakeTimers();
			try {
				const t = convexTest(schema, modules);
				const { orderId, drinkItemId, staff } = await seedPaidOrderWithTwoLines(t);

				mockStripeClient.refunds.create.mockRejectedValueOnce(new Error("card_error"));

				await staff.mutation(api.orders.cancelOrderItem, { orderItemId: drinkItemId });
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());

				const { order, item } = await t.run(async (ctx) => ({
					order: await ctx.db.get(orderId),
					item: await ctx.db.get(drinkItemId),
				}));
				// Money is owed and staff must see it, cooking or not.
				expect(order?.paymentState).toBe("refund_failed");
				// The line records no refund, so a retry path stays open.
				expect(item?.refundedAt).toBeUndefined();
			} finally {
				vi.useRealTimers();
			}
		});

		it("refuses to touch a legacy payment even when scheduled directly", async () => {
			// Defense in depth below cancelOrderItem's own vintage guard: if a
			// line refund is ever scheduled against tab-era money (no
			// subtotalAmount — one payment covering many orders plus the tip),
			// the action must return without reaching Stripe. The fee top-up and
			// the last-live-line remaining-balance sweep are both wrong there.
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, paymentId } = await seedPaidOrderWithTwoLines(t);

			await t.run(async (ctx) => {
				// Strip the ADR 008 vintage markers, making this a legacy row.
				await ctx.db.patch(paymentId, {
					kind: undefined,
					subtotalAmount: undefined,
					feeAmount: undefined,
				});
				// Cancel the line by hand, as a buggy scheduler-caller would have.
				await ctx.db.patch(drinkItemId, { cancelledAt: Date.now(), cancelledBy: "owner-86" });
			});

			await t.action(internal.stripe.refundOrderItem, {
				orderId,
				orderItemId: drinkItemId,
				paymentId,
			});

			expect(mockStripeClient.refunds.create).not.toHaveBeenCalled();
			const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
			expect(payment?.amountRefunded).toBeUndefined();
			expect(payment?.refundStatus).toBe("none");
		});

		it("replaying the scheduled refund is a no-op once the line is refunded", async () => {
			vi.useFakeTimers();
			try {
				const t = convexTest(schema, modules);
				const { orderId, drinkItemId, paymentId, staff } = await seedPaidOrderWithTwoLines(t);

				mockStripeClient.refunds.create.mockResolvedValue({
					id: "re_once",
					status: "succeeded",
					amount: 672,
				});

				await staff.mutation(api.orders.cancelOrderItem, { orderItemId: drinkItemId });
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());
				await t.action(internal.stripe.refundOrderItem, {
					orderId,
					orderItemId: drinkItemId,
					paymentId,
				});

				expect(mockStripeClient.refunds.create).toHaveBeenCalledTimes(1);
			} finally {
				vi.useRealTimers();
			}
		});
	});
});
