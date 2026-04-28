import { convexTest } from "convex-test";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
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
	parseThinEvent: vi.fn(),
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
	},
) {
	let restaurantId: Id<"restaurants">;

	await t.run(async (ctx) => {
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: args.ownerId,
			organizationId: args.organizationId,
			name: "Stripe Test Restaurant",
			slug: `stripe-test-${Math.random().toString(36).slice(2, 10)}`,
			currency: "USD",
			stripeAccountId: args.stripeAccountId,
			stripeOnboardingComplete: args.stripeOnboardingComplete,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});

	return restaurantId!;
}

async function seedDraftOrder(
	t: ReturnType<typeof convexTest>,
	args: {
		restaurantId: Id<"restaurants">;
		totalAmount: number;
	},
) {
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

	return orderId!;
}

async function seedUserRole(
	t: ReturnType<typeof convexTest>,
	args: { userId: string; roles: Array<"admin" | "owner" | "manager" | "employee" | "customer">; organizationId?: Id<"organizations"> },
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
			}),
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
		const orderId = await seedDraftOrder(t, {
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

		const first = await t.action(api.stripe.createPaymentIntent, {
			orderId,
		});
		const second = await t.action(api.stripe.createPaymentIntent, {
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
		const orderId = await seedDraftOrder(t, {
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

		await t.action(api.stripe.createPaymentIntent, {
			orderId,
		});

		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, {
				totalAmount: 2400,
				updatedAt: Date.now() + 5000,
			});
		});

		const second = await t.action(api.stripe.createPaymentIntent, {
			orderId,
		});

		expect(second.clientSecret).toBe("pi_secret_replaced");

		const payments = await t.run(async (ctx) =>
			ctx.db.query("payments").collect()
		);
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
		const orderId = await seedDraftOrder(t, {
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
			const orderId = await seedDraftOrder(t, {
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
			});

			const owner = t.withIdentity({ subject: "owner-1" });
			const [, error] = await owner.mutation(api.orders.updateStatus, {
				orderId,
				newStatus: "cancelled",
			});
			expect(error).toBeNull();

			await t.finishAllScheduledFunctions(() => {
				vi.runAllTimers();
			});

			expect(mockStripeClient.refunds.create).toHaveBeenCalledWith(
				{
					payment_intent: "pi_refund",
					reverse_transfer: true,
					refund_application_fee: true,
				},
				expect.objectContaining({
					idempotencyKey: expect.stringContaining("refund:"),
				}),
			);

			const order = await t.run(async (ctx) => ctx.db.get(orderId));
			expect(order?.paymentState).toBe("refunded");
		} finally {
			vi.useRealTimers();
		}
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
});
