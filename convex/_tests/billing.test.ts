/**
 * Platform subscription — the 2,000 MXN/month a RESTAURANT pays Tavli
 * (ADR 008 / TAVLI-71 Phase 4B).
 *
 * Not the diner-paid 12% service fee: nothing in here creates a payment row,
 * an order, or a Connect transfer.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { AUDIT_EVENT, BILLING_STATUS } from "../constants";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const mockStripeClient = {
	customers: { create: vi.fn() },
	checkout: { sessions: { create: vi.fn() } },
	subscriptions: { update: vi.fn() },
	webhooks: { constructEvent: vi.fn() },
	v2: { core: { accounts: { create: vi.fn(), retrieve: vi.fn() } } },
};

vi.mock("stripe", () => ({ default: vi.fn(() => mockStripeClient) }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

async function seedRestaurant(
	t: ReturnType<typeof convexTest>,
	args: {
		ownerId: string;
		platformSubscriptionEnabled?: boolean;
		stripeBillingCustomerId?: string;
		stripeSubscriptionId?: string;
		billingStatus?: string;
		supportEmail?: string;
	}
) {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Billing Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const slug = `billing-${Math.random().toString(36).slice(2, 10)}`;
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: args.ownerId,
			organizationId,
			name: "La Cocina",
			slug,
			currency: "MXN",
			supportEmail: args.supportEmail,
			platformSubscriptionEnabled: args.platformSubscriptionEnabled,
			stripeBillingCustomerId: args.stripeBillingCustomerId,
			stripeSubscriptionId: args.stripeSubscriptionId,
			billingStatus: args.billingStatus,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await insertMenuForRestaurant(ctx, { restaurantId, name: slug, userId: args.ownerId });
	});
	return restaurantId!;
}

function auditEventsFor(t: ReturnType<typeof convexTest>, eventType: string) {
	return t.run(async (ctx) => {
		const all = await ctx.db.query("allEvents").collect();
		return all.filter((event) => event.eventType === eventType);
	});
}

/** Drives a signed snapshot webhook through the real dispatch path. */
async function deliverWebhook(t: ReturnType<typeof convexTest>, event: Record<string, unknown>) {
	mockStripeClient.webhooks.constructEvent.mockReturnValueOnce(event);
	await t.action(internal.stripe.fulfillPayment, {
		payloadString: "{}",
		signatureHeader: "sig",
	});
}

function subscriptionObject(overrides: Record<string, unknown> = {}) {
	return {
		id: "sub_123",
		object: "subscription",
		status: BILLING_STATUS.ACTIVE,
		customer: "cus_123",
		cancel_at_period_end: false,
		metadata: {},
		items: { data: [{ current_period_end: 1_800_000_000 }] },
		...overrides,
	};
}

function invoiceObject(overrides: Record<string, unknown> = {}) {
	return {
		id: "in_123",
		object: "invoice",
		number: "TAVLI-0001",
		customer: "cus_123",
		currency: "mxn",
		amount_paid: 200000,
		amount_due: 200000,
		period_start: 1_797_000_000,
		period_end: 1_800_000_000,
		hosted_invoice_url: "https://invoice.stripe.com/i/test",
		parent: { subscription_details: { subscription: "sub_123" } },
		...overrides,
	};
}

describe("platform subscription checkout", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.STRIPE_SECRET_KEY = "sk_test_123";
		process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
		process.env.STRIPE_PLATFORM_FEE_PRICE_ID = "price_platform_monthly";
		process.env.PUBLIC_APP_URL = "https://app.tavliai.com";
	});

	it("refuses when the restaurant is not on the platform subscription", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: false,
		});
		const owner = t.withIdentity({ subject: "owner-1" });

		await expect(
			owner.action(api.billing.createSubscriptionCheckout, { restaurantId })
		).rejects.toThrow("ERROR_BILLING_NOT_ENABLED");

		expect(mockStripeClient.checkout.sessions.create).not.toHaveBeenCalled();
	});

	it("fails closed with a stable code when the Price env var is unset", async () => {
		delete process.env.STRIPE_PLATFORM_FEE_PRICE_ID;
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
		});
		const owner = t.withIdentity({ subject: "owner-1" });

		await expect(
			owner.action(api.billing.createSubscriptionCheckout, { restaurantId })
		).rejects.toThrow("ERROR_BILLING_PRICE_NOT_CONFIGURED");

		// Nothing may reach Stripe before the Price is known.
		expect(mockStripeClient.customers.create).not.toHaveBeenCalled();
		expect(mockStripeClient.checkout.sessions.create).not.toHaveBeenCalled();
	});

	it("refuses a second checkout while a live subscription exists", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
			stripeSubscriptionId: "sub_live",
			billingStatus: BILLING_STATUS.ACTIVE,
		});
		const owner = t.withIdentity({ subject: "owner-1" });

		await expect(
			owner.action(api.billing.createSubscriptionCheckout, { restaurantId })
		).rejects.toThrow("ERROR_BILLING_SUBSCRIPTION_EXISTS");
	});

	it("lets a cancelled restaurant subscribe again", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
			stripeBillingCustomerId: "cus_existing",
			billingStatus: BILLING_STATUS.CANCELED,
		});
		mockStripeClient.checkout.sessions.create.mockResolvedValueOnce({
			id: "cs_1",
			url: "https://checkout.stripe.com/c/pay/cs_1",
		});
		const owner = t.withIdentity({ subject: "owner-1" });

		const result = await owner.action(api.billing.createSubscriptionCheckout, { restaurantId });

		expect(result).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_1" });
	});

	it("creates a subscription-mode session against the configured Price, stamped with the restaurant", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
			supportEmail: "hola@lacocina.mx",
		});
		mockStripeClient.customers.create.mockResolvedValueOnce({ id: "cus_new" });
		mockStripeClient.checkout.sessions.create.mockResolvedValueOnce({
			id: "cs_1",
			url: "https://checkout.stripe.com/c/pay/cs_1",
		});
		const owner = t.withIdentity({ subject: "owner-1" });

		const result = await owner.action(api.billing.createSubscriptionCheckout, { restaurantId });

		expect(result.url).toBe("https://checkout.stripe.com/c/pay/cs_1");
		expect(mockStripeClient.customers.create).toHaveBeenCalledWith(
			expect.objectContaining({ metadata: { restaurantId } }),
			{ idempotencyKey: `billing-customer:${restaurantId}` }
		);
		expect(mockStripeClient.checkout.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "subscription",
				customer: "cus_new",
				line_items: [{ price: "price_platform_monthly", quantity: 1 }],
				client_reference_id: restaurantId,
				subscription_data: { metadata: { restaurantId } },
			})
		);

		// Return URLs are built server-side (never taken from the caller) and
		// land back on this restaurant's settings canvas.
		const session = mockStripeClient.checkout.sessions.create.mock.calls[0][0];
		expect(session.success_url).toContain(`settings=${encodeURIComponent(restaurantId)}`);
		expect(session.success_url).toContain("billing=success");
		expect(session.cancel_url).toContain("billing=cancelled");
		expect(session.success_url.startsWith("https://app.tavliai.com/admin/restaurants?")).toBe(true);

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.stripeBillingCustomerId).toBe("cus_new");
	});

	it("reuses the stored billing Customer instead of creating a second one", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
			stripeBillingCustomerId: "cus_existing",
		});
		mockStripeClient.checkout.sessions.create.mockResolvedValueOnce({
			id: "cs_2",
			url: "https://checkout.stripe.com/c/pay/cs_2",
		});
		const owner = t.withIdentity({ subject: "owner-1" });

		await owner.action(api.billing.createSubscriptionCheckout, { restaurantId });

		expect(mockStripeClient.customers.create).not.toHaveBeenCalled();
		expect(mockStripeClient.checkout.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({ customer: "cus_existing" })
		);
	});

	it("denies a caller who neither owns the restaurant nor is a platform admin", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
		});
		const intruder = t.withIdentity({ subject: "intruder-1" });

		await expect(
			intruder.action(api.billing.createSubscriptionCheckout, { restaurantId })
		).rejects.toMatchObject({ name: "NOT_AUTHORIZED" });
	});
});

describe("cancelSubscription", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.STRIPE_SECRET_KEY = "sk_test_123";
		process.env.STRIPE_PLATFORM_FEE_PRICE_ID = "price_platform_monthly";
		process.env.PUBLIC_APP_URL = "https://app.tavliai.com";
	});

	it("cancels at period end rather than immediately, and caches the pending cancellation", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
			stripeSubscriptionId: "sub_123",
			billingStatus: BILLING_STATUS.ACTIVE,
		});
		mockStripeClient.subscriptions.update.mockResolvedValueOnce(
			subscriptionObject({ cancel_at_period_end: true })
		);
		const owner = t.withIdentity({ subject: "owner-1" });

		const result = await owner.action(api.billing.cancelSubscription, { restaurantId });

		expect(mockStripeClient.subscriptions.update).toHaveBeenCalledWith("sub_123", {
			cancel_at_period_end: true,
		});
		expect(result.cancelAtPeriodEnd).toBe(true);
		expect(result.currentPeriodEnd).toBe(1_800_000_000_000);

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		// Still active — they paid for this period and keep it.
		expect(restaurant?.billingStatus).toBe(BILLING_STATUS.ACTIVE);
		expect(restaurant?.billingCancelAtPeriodEnd).toBe(true);
		expect(restaurant?.billingCurrentPeriodEnd).toBe(1_800_000_000_000);

		const audited = await auditEventsFor(t, AUDIT_EVENT.RESTAURANT_SUBSCRIPTION_CANCEL_SCHEDULED);
		expect(audited).toHaveLength(1);
		expect(audited[0].userId).toBe("owner-1");
	});

	it("refuses when there is no subscription to cancel", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
		});
		const owner = t.withIdentity({ subject: "owner-1" });

		await expect(owner.action(api.billing.cancelSubscription, { restaurantId })).rejects.toThrow(
			"ERROR_BILLING_NO_SUBSCRIPTION"
		);
		expect(mockStripeClient.subscriptions.update).not.toHaveBeenCalled();
	});
});

describe("platform subscription webhooks (snapshot destination)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		process.env.STRIPE_SECRET_KEY = "sk_test_123";
		process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
		fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("binds the subscription from checkout.session.completed and audits creation", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
			stripeBillingCustomerId: "cus_123",
		});

		await deliverWebhook(t, {
			id: "evt_checkout",
			type: "checkout.session.completed",
			data: {
				object: {
					id: "cs_1",
					mode: "subscription",
					subscription: "sub_123",
					customer: "cus_123",
					client_reference_id: restaurantId,
				},
			},
		});

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.stripeSubscriptionId).toBe("sub_123");
		// Pessimistic until `customer.subscription.created` says otherwise: Stripe
		// does not order the two events, and caching "active" for a subscription
		// that is really `incomplete` would be a lie the UI acts on.
		expect(restaurant?.billingStatus).toBe(BILLING_STATUS.INCOMPLETE);
		expect(await auditEventsFor(t, AUDIT_EVENT.RESTAURANT_SUBSCRIPTION_CREATED)).toHaveLength(1);
	});

	it("upgrades the pessimistic status when customer.subscription.created lands after checkout", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
			stripeBillingCustomerId: "cus_123",
		});

		await deliverWebhook(t, {
			id: "evt_checkout_ordering",
			type: "checkout.session.completed",
			data: {
				object: {
					id: "cs_1",
					mode: "subscription",
					subscription: "sub_123",
					customer: "cus_123",
					client_reference_id: restaurantId,
				},
			},
		});
		await deliverWebhook(t, {
			id: "evt_sub_created_ordering",
			type: "customer.subscription.created",
			data: { object: subscriptionObject({ metadata: { restaurantId } }) },
		});

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.billingStatus).toBe(BILLING_STATUS.ACTIVE);
	});

	it("ignores subscription events for a soft-deleted restaurant", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
			stripeBillingCustomerId: "cus_123",
			stripeSubscriptionId: "sub_123",
			billingStatus: BILLING_STATUS.ACTIVE,
		});
		await t.run(async (ctx) => ctx.db.patch(restaurantId, { deletedAt: Date.now() }));

		// No `metadata.restaurantId`, so this can only resolve through the customer
		// and subscription indexes — the two lookups the guard covers.
		await deliverWebhook(t, {
			id: "evt_sub_deleted_restaurant",
			type: "customer.subscription.updated",
			data: { object: subscriptionObject({ status: BILLING_STATUS.PAST_DUE }) },
		});

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.billingStatus).toBe(BILLING_STATUS.ACTIVE);
	});

	it("ignores a checkout session that is not in subscription mode", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			stripeBillingCustomerId: "cus_123",
		});

		await deliverWebhook(t, {
			id: "evt_payment_mode",
			type: "checkout.session.completed",
			data: {
				object: {
					id: "cs_2",
					mode: "payment",
					subscription: null,
					customer: "cus_123",
					client_reference_id: restaurantId,
				},
			},
		});

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.stripeSubscriptionId).toBeUndefined();
	});

	it("caches status and period end from customer.subscription.updated", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
			stripeBillingCustomerId: "cus_123",
			stripeSubscriptionId: "sub_123",
			billingStatus: BILLING_STATUS.ACTIVE,
		});

		await deliverWebhook(t, {
			id: "evt_sub_updated",
			type: "customer.subscription.updated",
			data: {
				object: subscriptionObject({
					status: BILLING_STATUS.PAST_DUE,
					cancel_at_period_end: true,
					metadata: { restaurantId },
				}),
			},
		});

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.billingStatus).toBe(BILLING_STATUS.PAST_DUE);
		expect(restaurant?.billingCurrentPeriodEnd).toBe(1_800_000_000_000);
		expect(restaurant?.billingCancelAtPeriodEnd).toBe(true);
		expect(
			await auditEventsFor(t, AUDIT_EVENT.RESTAURANT_SUBSCRIPTION_STATUS_CHANGED)
		).toHaveLength(1);
	});

	it("clears the subscription on customer.subscription.deleted but leaves the flag armed", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
			stripeBillingCustomerId: "cus_123",
			stripeSubscriptionId: "sub_123",
			billingStatus: BILLING_STATUS.ACTIVE,
		});

		await deliverWebhook(t, {
			id: "evt_sub_deleted",
			type: "customer.subscription.deleted",
			data: { object: subscriptionObject({ status: BILLING_STATUS.CANCELED }) },
		});

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.stripeSubscriptionId).toBeUndefined();
		expect(restaurant?.billingStatus).toBe(BILLING_STATUS.CANCELED);
		expect(restaurant?.billingCurrentPeriodEnd).toBeUndefined();
		// Whether Tavli still bills them is an operator call, not Stripe's.
		expect(restaurant?.platformSubscriptionEnabled).toBe(true);
		expect(await auditEventsFor(t, AUDIT_EVENT.RESTAURANT_SUBSCRIPTION_CANCELLED)).toHaveLength(1);
	});

	it("audits invoice.paid with the invoice's own amount and schedules the receipt email", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
			stripeBillingCustomerId: "cus_123",
			stripeSubscriptionId: "sub_123",
			supportEmail: "facturas@lacocina.mx",
		});
		process.env.RESEND_API_KEY = "re_test";
		process.env.RESEND_FROM_ADDRESS = "Tavli <no-reply@tavliai.com>";

		await deliverWebhook(t, {
			id: "evt_invoice_paid",
			// A prorated first invoice: the amount must come off the invoice, not
			// off PLATFORM_MONTHLY_FEE_MXN_CENTS.
			type: "invoice.paid",
			data: { object: invoiceObject({ amount_paid: 123456 }) },
		});

		const audited = await auditEventsFor(t, AUDIT_EVENT.RESTAURANT_SUBSCRIPTION_INVOICE_PAID);
		expect(audited).toHaveLength(1);
		expect(audited[0].payload).toMatchObject({
			stripeInvoiceId: "in_123",
			invoiceNumber: "TAVLI-0001",
			amountPaidCents: 123456,
			currency: "MXN",
		});

		const scheduled = await t.run(
			async (ctx) => await ctx.db.system.query("_scheduled_functions").collect()
		);
		const receiptJob = scheduled.find((job) => job.name.includes("sendPlatformFeeReceiptEmail"));
		expect(receiptJob).toBeDefined();
		expect(receiptJob!.args[0]).toMatchObject({
			restaurantId,
			stripeInvoiceId: "in_123",
			amountPaidCents: 123456,
			currency: "MXN",
		});

		// Drain rather than leak: an in-flight job outliving the test writes to
		// the fake scheduler table after its transaction closed.
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());
	});

	it("sends Tavli's receipt to the restaurant's supportEmail", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
			supportEmail: "facturas@lacocina.mx",
		});
		process.env.RESEND_API_KEY = "re_test";
		process.env.RESEND_FROM_ADDRESS = "Tavli <no-reply@tavliai.com>";

		await t.action(internal.billing.sendPlatformFeeReceiptEmail, {
			restaurantId,
			stripeInvoiceId: "in_123",
			invoiceNumber: "TAVLI-0001",
			amountPaidCents: 200000,
			currency: "MXN",
			periodStart: 1_797_000_000_000,
			periodEnd: 1_800_000_000_000,
			hostedInvoiceUrl: "https://invoice.stripe.com/i/test",
		});

		const emailCall = fetchMock.mock.calls.find(([url]) => url === "https://api.resend.com/emails");
		expect(emailCall).toBeDefined();
		const body = JSON.parse(emailCall![1].body);
		expect(body.to).toEqual(["facturas@lacocina.mx"]);
		expect(body.from).toBe("Tavli <no-reply@tavliai.com>");
		expect(body.html).toContain("$2,000.00 MXN");
	});

	it("falls back to the owner's email when the restaurant configured no supportEmail", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
		});
		await t.run(async (ctx) => {
			await ctx.db.insert("userRoles", {
				userId: "owner-1",
				email: "dueno@lacocina.mx",
				roles: ["owner"],
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});
		process.env.RESEND_API_KEY = "re_test";
		process.env.RESEND_FROM_ADDRESS = "Tavli <no-reply@tavliai.com>";

		await t.action(internal.billing.sendPlatformFeeReceiptEmail, {
			restaurantId,
			stripeInvoiceId: "in_456",
			amountPaidCents: 200000,
			currency: "MXN",
			periodStart: 1_797_000_000_000,
			periodEnd: 1_800_000_000_000,
		});

		const emailCall = fetchMock.mock.calls.find(([url]) => url === "https://api.resend.com/emails");
		const body = JSON.parse(emailCall![1].body);
		expect(body.to).toEqual(["dueno@lacocina.mx"]);
	});

	it("skips the send entirely when no recipient can be resolved — never a hardcoded address", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
		});
		process.env.RESEND_API_KEY = "re_test";
		process.env.RESEND_FROM_ADDRESS = "Tavli <no-reply@tavliai.com>";

		await t.action(internal.billing.sendPlatformFeeReceiptEmail, {
			restaurantId,
			stripeInvoiceId: "in_789",
			amountPaidCents: 200000,
			currency: "MXN",
			periodStart: 1_797_000_000_000,
			periodEnd: 1_800_000_000_000,
		});

		expect(fetchMock.mock.calls.some(([url]) => url === "https://api.resend.com/emails")).toBe(
			false
		);
	});

	it("flips the restaurant to past_due on invoice.payment_failed", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
			stripeBillingCustomerId: "cus_123",
			stripeSubscriptionId: "sub_123",
			billingStatus: BILLING_STATUS.ACTIVE,
		});

		await deliverWebhook(t, {
			id: "evt_invoice_failed",
			type: "invoice.payment_failed",
			data: { object: invoiceObject({ id: "in_failed" }) },
		});

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.billingStatus).toBe(BILLING_STATUS.PAST_DUE);
		expect(
			await auditEventsFor(t, AUDIT_EVENT.RESTAURANT_SUBSCRIPTION_PAYMENT_FAILED)
		).toHaveLength(1);
	});

	it("dedups a redelivered subscription event through stripeWebhookEvents", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, {
			ownerId: "owner-1",
			platformSubscriptionEnabled: true,
			stripeBillingCustomerId: "cus_123",
			stripeSubscriptionId: "sub_123",
			billingStatus: BILLING_STATUS.ACTIVE,
		});

		const event = {
			id: "evt_repeat",
			type: "customer.subscription.updated",
			data: {
				object: subscriptionObject({
					status: BILLING_STATUS.PAST_DUE,
					metadata: { restaurantId },
				}),
			},
		};
		await deliverWebhook(t, event);
		await deliverWebhook(t, event);

		expect(
			await auditEventsFor(t, AUDIT_EVENT.RESTAURANT_SUBSCRIPTION_STATUS_CHANGED)
		).toHaveLength(1);
		const recorded = await t.run(async (ctx) => ctx.db.query("stripeWebhookEvents").collect());
		expect(recorded.filter((row) => row.eventId === "evt_repeat")).toHaveLength(1);
	});

	it("is a benign no-op for a subscription that belongs to no restaurant", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t, { ownerId: "owner-1", platformSubscriptionEnabled: true });

		await deliverWebhook(t, {
			id: "evt_foreign",
			type: "customer.subscription.updated",
			data: { object: subscriptionObject({ id: "sub_other", customer: "cus_other" }) },
		});

		// Still recorded for dedup, but nothing was patched or audited.
		const recorded = await t.run(async (ctx) => ctx.db.query("stripeWebhookEvents").collect());
		expect(recorded).toHaveLength(1);
		expect(
			await auditEventsFor(t, AUDIT_EVENT.RESTAURANT_SUBSCRIPTION_STATUS_CHANGED)
		).toHaveLength(0);
	});
});

describe("setPlatformSubscriptionEnabled", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("lets a platform admin arm the subscription", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { ownerId: "owner-1" });
		await t.run(async (ctx) => {
			await ctx.db.insert("userRoles", {
				userId: "admin-1",
				roles: ["admin"],
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		const [id, error] = await t
			.withIdentity({ subject: "admin-1" })
			.mutation(api.billingHelpers.setPlatformSubscriptionEnabled, {
				restaurantId,
				enabled: true,
			});

		expect(error).toBeNull();
		expect(id).toBe(restaurantId);
		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.platformSubscriptionEnabled).toBe(true);
	});

	it("refuses the restaurant owner — arming their own billing is not theirs to decide", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { ownerId: "owner-1" });

		const [id, error] = await t
			.withIdentity({ subject: "owner-1" })
			.mutation(api.billingHelpers.setPlatformSubscriptionEnabled, {
				restaurantId,
				enabled: true,
			});

		expect(id).toBeNull();
		expect(error?.name).toBe("NOT_AUTHORIZED");
		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.platformSubscriptionEnabled).toBeUndefined();
	});
});
