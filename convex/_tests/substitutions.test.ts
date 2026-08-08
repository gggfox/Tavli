/**
 * TAVLI-71 Phase 3A — substitution proposals on paid orders (ADR 008).
 *
 * Covers the proposal lifecycle (propose / cancel / accept / decline), the
 * supplemental delta payment (one-tap, Elements fallback, webhook confirm,
 * failure), the guard interplay with 86/cancel, and the cross-payment refund
 * of a substituted line.
 */
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const mockStripeClient = {
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
};

vi.mock("stripe", () => ({
	default: vi.fn(() => mockStripeClient),
}));

const DINER = "diner-sub";
const STAFF = "owner-sub";

/**
 * A paid pay-at-submit order (subtotal 1400 → charge 1568) with two live
 * lines: Tacos (800) and Agua fresca (600). The payment carries the saved
 * card (`pm_saved`) and the diner has a platform Stripe Customer, so one-tap
 * substitution charges resolve. Substitute menu items:
 * - Molcajete, 700 (delta +100 over the drink)
 * - Horchata, 600 (delta 0 over the drink)
 * - Limonada, 500 (cheaper — the equal-or-higher rule rejects it)
 */
async function seedPaidOrder(t: ReturnType<typeof convexTest>) {
	let restaurantId: Id<"restaurants">;
	let sessionId: Id<"sessions">;
	let orderId: Id<"orders">;
	let tacosItemId: Id<"orderItems">;
	let drinkItemId: Id<"orderItems">;
	let paymentId: Id<"payments">;
	let molcajeteId: Id<"menuItems">;
	let horchataId: Id<"menuItems">;
	let limonadaId: Id<"menuItems">;
	let unavailableId: Id<"menuItems">;

	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Sub Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: STAFF,
			organizationId,
			name: "Sub Test Restaurant",
			slug: `sub-test-${Math.random().toString(36).slice(2, 10)}`,
			currency: "USD",
			stripeAccountId: "acct_sub",
			stripeOnboardingComplete: true,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("userRoles", {
			userId: STAFF,
			roles: ["owner"],
			organizationId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 4,
			isActive: true,
			createdAt: Date.now(),
		});
		sessionId = await ctx.db.insert("sessions", {
			restaurantId,
			tableId,
			userId: DINER,
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
		const makeMenuItem = (name: string, basePrice: number, isAvailable = true) =>
			ctx.db.insert("menuItems", {
				categoryId,
				restaurantId,
				name,
				basePrice,
				isAvailable,
				displayOrder: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		const tacosMenuItemId = await makeMenuItem("Tacos", 800);
		const drinkMenuItemId = await makeMenuItem("Agua fresca", 600);
		molcajeteId = await makeMenuItem("Molcajete", 700);
		horchataId = await makeMenuItem("Horchata", 600);
		limonadaId = await makeMenuItem("Limonada", 500);
		unavailableId = await makeMenuItem("Fuera de carta", 900, false);

		orderId = await ctx.db.insert("orders", {
			sessionId,
			restaurantId,
			tableId,
			status: "submitted",
			totalAmount: 1400,
			paymentState: "paid",
			settledBy: "stripe",
			paidByUserId: DINER,
			dailyOrderNumber: 42,
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
			paidByUserId: DINER,
			stripePaymentMethodId: "pm_saved",
			currency: "usd",
			status: "succeeded",
			refundStatus: "none",
			attemptNumber: 1,
			stripePaymentIntentId: "pi_sub_order",
			succeededAt: Date.now(),
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.patch(orderId, { activePaymentId: paymentId });

		await ctx.db.insert("stripeCustomers", {
			userId: DINER,
			stripeCustomerId: "cus_sub",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});

	return {
		restaurantId: restaurantId!,
		sessionId: sessionId!,
		orderId: orderId!,
		tacosItemId: tacosItemId!,
		drinkItemId: drinkItemId!,
		paymentId: paymentId!,
		molcajeteId: molcajeteId!,
		horchataId: horchataId!,
		limonadaId: limonadaId!,
		unavailableId: unavailableId!,
		staff: t.withIdentity({ subject: STAFF }),
		diner: t.withIdentity({ subject: DINER }),
	};
}

describe("substitutions (TAVLI-71 Phase 3A)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.STRIPE_SECRET_KEY = "sk_test_123";
	});

	describe("proposeSubstitution", () => {
		it("snapshots the proposal with delta and fee-on-delta", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, molcajeteId, staff } = await seedPaidOrder(t);

			const [proposalId, error] = await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: molcajeteId,
			});
			expect(error).toBeNull();

			const proposal = await t.run(async (ctx) => ctx.db.get(proposalId!));
			expect(proposal).toMatchObject({
				status: "pending",
				proposedMenuItemName: "Molcajete",
				proposedUnitPrice: 700,
				quantity: 1,
				proposedLineTotal: 700,
				deltaAmount: 100,
				// round(100 × 12%) = 12 — fee on the delta alone.
				feeOnDelta: 12,
				proposedBy: STAFF,
			});
		});

		it("rejects a diner (staff-only guard)", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, molcajeteId, diner } = await seedPaidOrder(t);

			const [, error] = await diner.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: molcajeteId,
			});
			expect(error).toMatchObject({ name: "NOT_AUTHORIZED" });
		});

		it("enforces the equal-or-higher rule (delta >= 0)", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, limonadaId, staff } = await seedPaidOrder(t);

			await expect(
				staff.mutation(api.substitutions.proposeSubstitution, {
					orderId,
					orderItemId: drinkItemId,
					proposedMenuItemId: limonadaId,
				})
			).rejects.toThrow(/ERROR_SUBSTITUTION_DELTA_NEGATIVE/);
		});

		it("rejects a second pending proposal for the same line", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, molcajeteId, horchataId, staff } = await seedPaidOrder(t);

			await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: molcajeteId,
			});
			await expect(
				staff.mutation(api.substitutions.proposeSubstitution, {
					orderId,
					orderItemId: drinkItemId,
					proposedMenuItemId: horchataId,
				})
			).rejects.toThrow(/ERROR_SUBSTITUTION_PROPOSAL_EXISTS/);
		});

		it("rejects unpaid orders and non-kitchen statuses", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, molcajeteId, staff } = await seedPaidOrder(t);

			await t.run(async (ctx) => {
				await ctx.db.patch(orderId, { status: "ready" });
			});
			await expect(
				staff.mutation(api.substitutions.proposeSubstitution, {
					orderId,
					orderItemId: drinkItemId,
					proposedMenuItemId: molcajeteId,
				})
			).rejects.toThrow(/ERROR_SUBSTITUTION_NOT_ELIGIBLE/);

			await t.run(async (ctx) => {
				await ctx.db.patch(orderId, { status: "submitted", paymentState: "unpaid" });
			});
			await expect(
				staff.mutation(api.substitutions.proposeSubstitution, {
					orderId,
					orderItemId: drinkItemId,
					proposedMenuItemId: molcajeteId,
				})
			).rejects.toThrow(/ERROR_SUBSTITUTION_NOT_ELIGIBLE/);
		});

		it("rejects an unavailable replacement item", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, unavailableId, staff } = await seedPaidOrder(t);

			await expect(
				staff.mutation(api.substitutions.proposeSubstitution, {
					orderId,
					orderItemId: drinkItemId,
					proposedMenuItemId: unavailableId,
				})
			).rejects.toThrow(/ERROR_SUBSTITUTION_ITEM_UNAVAILABLE/);
		});

		it("refuses legacy (pre-fee) money", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, molcajeteId, paymentId, staff } = await seedPaidOrder(t);

			await t.run(async (ctx) => {
				await ctx.db.patch(paymentId, {
					kind: undefined,
					subtotalAmount: undefined,
					feeAmount: undefined,
				});
			});
			await expect(
				staff.mutation(api.substitutions.proposeSubstitution, {
					orderId,
					orderItemId: drinkItemId,
					proposedMenuItemId: molcajeteId,
				})
			).rejects.toThrow(/ERROR_SUBSTITUTION_NOT_ELIGIBLE/);
		});
	});

	describe("cancelProposal / getPending queries", () => {
		it("staff retract a pending proposal", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, molcajeteId, staff } = await seedPaidOrder(t);

			const [proposalId] = await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: molcajeteId,
			});
			const [, error] = await staff.mutation(api.substitutions.cancelProposal, {
				proposalId: proposalId!,
			});
			expect(error).toBeNull();

			const proposal = await t.run(async (ctx) => ctx.db.get(proposalId!));
			expect(proposal?.status).toBe("cancelled");
		});

		it("getPendingForSession joins the original line for members and hides it from strangers", async () => {
			const t = convexTest(schema, modules);
			const { orderId, sessionId, drinkItemId, molcajeteId, staff, diner } = await seedPaidOrder(t);

			await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: molcajeteId,
			});

			const pending = await diner.query(api.substitutions.getPendingForSession, { sessionId });
			expect(pending).toHaveLength(1);
			expect(pending[0]).toMatchObject({
				originalName: "Agua fresca",
				originalLineTotal: 600,
				proposedName: "Molcajete",
				proposedLineTotal: 700,
				deltaAmount: 100,
				feeOnDelta: 12,
				dailyOrderNumber: 42,
			});

			const stranger = t.withIdentity({ subject: "someone-else" });
			await expect(
				stranger.query(api.substitutions.getPendingForSession, { sessionId })
			).resolves.toEqual([]);
		});
	});

	describe("acceptProposal (delta 0)", () => {
		it("swaps the line in place with the order total unchanged", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, horchataId, staff, diner } = await seedPaidOrder(t);

			const [proposalId] = await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: horchataId,
			});
			await diner.mutation(api.substitutions.acceptProposal, { proposalId: proposalId! });

			const { proposal, item, order } = await t.run(async (ctx) => ({
				proposal: await ctx.db.get(proposalId!),
				item: await ctx.db.get(drinkItemId),
				order: await ctx.db.get(orderId),
			}));
			expect(proposal).toMatchObject({ status: "accepted", respondedByUserId: DINER });
			expect(item).toMatchObject({
				menuItemId: horchataId,
				menuItemName: "Horchata",
				unitPrice: 600,
				lineTotal: 600,
				selectedOptions: [],
			});
			expect(order?.totalAmount).toBe(1400);
		});

		it("rejects a positive delta — that path must go through the payment intent", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, molcajeteId, staff, diner } = await seedPaidOrder(t);

			const [proposalId] = await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: molcajeteId,
			});
			await expect(
				diner.mutation(api.substitutions.acceptProposal, { proposalId: proposalId! })
			).rejects.toThrow(/ERROR_SUBSTITUTION_REQUIRES_PAYMENT/);
		});

		it("rejects non-members", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, horchataId, staff } = await seedPaidOrder(t);

			const [proposalId] = await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: horchataId,
			});
			const stranger = t.withIdentity({ subject: "someone-else" });
			await expect(
				stranger.mutation(api.substitutions.acceptProposal, { proposalId: proposalId! })
			).rejects.toMatchObject({ name: "NOT_FOUND" });
		});
	});

	describe("declineProposal", () => {
		it("86's the line with the diner as actor and schedules the refund", async () => {
			vi.useFakeTimers();
			try {
				const t = convexTest(schema, modules);
				const { orderId, drinkItemId, molcajeteId, paymentId, staff, diner } =
					await seedPaidOrder(t);

				const [proposalId] = await staff.mutation(api.substitutions.proposeSubstitution, {
					orderId,
					orderItemId: drinkItemId,
					proposedMenuItemId: molcajeteId,
				});

				mockStripeClient.refunds.create.mockResolvedValueOnce({
					id: "re_decline",
					status: "succeeded",
					amount: 672,
				});

				await diner.mutation(api.substitutions.declineProposal, { proposalId: proposalId! });
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());

				// 600 line + round(600 × 12%) = 672 off the order payment, exactly
				// like a staff 86.
				expect(mockStripeClient.refunds.create).toHaveBeenCalledWith(
					{
						payment_intent: "pi_sub_order",
						amount: 672,
						reverse_transfer: true,
						refund_application_fee: true,
					},
					{ idempotencyKey: `refund:${paymentId}:${drinkItemId}` }
				);

				const { proposal, item, order, refundEvent } = await t.run(async (ctx) => ({
					proposal: await ctx.db.get(proposalId!),
					item: await ctx.db.get(drinkItemId),
					order: await ctx.db.get(orderId),
					refundEvent: (
						await ctx.db
							.query("allEvents")
							.filter((q) => q.eq(q.field("eventType"), "orders.itemRefunded"))
							.collect()
					).at(0),
				}));
				expect(proposal).toMatchObject({ status: "declined", respondedByUserId: DINER });
				// The diner declined, so the diner owns the cancellation trail.
				expect(item?.cancelledBy).toBe(DINER);
				expect(item?.refundAmount).toBe(672);
				expect(order?.totalAmount).toBe(800);
				expect(order?.status).toBe("submitted");
				expect(refundEvent?.userId).toBe(DINER);
			} finally {
				vi.useRealTimers();
			}
		});

		it("rejects a decline on a non-pending proposal", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, horchataId, staff, diner } = await seedPaidOrder(t);

			const [proposalId] = await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: horchataId,
			});
			await staff.mutation(api.substitutions.cancelProposal, { proposalId: proposalId! });
			await expect(
				diner.mutation(api.substitutions.declineProposal, { proposalId: proposalId! })
			).rejects.toThrow(/ERROR_SUBSTITUTION_NOT_PENDING/);
		});
	});

	describe("guard interplay with 86 and whole-order cancel", () => {
		it("staff 86 on a line with a pending proposal auto-cancels the proposal", async () => {
			vi.useFakeTimers();
			try {
				const t = convexTest(schema, modules);
				const { orderId, drinkItemId, molcajeteId, staff } = await seedPaidOrder(t);

				const [proposalId] = await staff.mutation(api.substitutions.proposeSubstitution, {
					orderId,
					orderItemId: drinkItemId,
					proposedMenuItemId: molcajeteId,
				});

				mockStripeClient.refunds.create.mockResolvedValueOnce({
					id: "re_86",
					status: "succeeded",
					amount: 672,
				});
				await staff.mutation(api.orders.cancelOrderItem, { orderItemId: drinkItemId });
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());

				const proposal = await t.run(async (ctx) => ctx.db.get(proposalId!));
				expect(proposal?.status).toBe("cancelled");
			} finally {
				vi.useRealTimers();
			}
		});

		it("a whole-order cancel withdraws every pending proposal on the order", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, molcajeteId, staff } = await seedPaidOrder(t);

			const [proposalId] = await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: molcajeteId,
			});
			const [, error] = await staff.mutation(api.orders.updateStatus, {
				orderId,
				newStatus: "cancelled",
			});
			expect(error).toBeNull();

			const proposal = await t.run(async (ctx) => ctx.db.get(proposalId!));
			expect(proposal?.status).toBe("cancelled");
		});
	});

	describe("createSubstitutionPaymentIntent", () => {
		it("one-tap charges the saved card with delta + fee and fee-on-delta application fee", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId, sessionId, orderId, drinkItemId, molcajeteId, staff, diner } =
				await seedPaidOrder(t);

			const [proposalId] = await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: molcajeteId,
			});

			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_sub_delta",
				status: "succeeded",
				client_secret: "pi_secret_delta",
			});

			const result = await diner.action(api.stripe.createSubstitutionPaymentIntent, {
				proposalId: proposalId!,
			});
			// One-tap confirmed — no Elements fallback needed.
			expect(result.clientSecret).toBeNull();

			expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledWith(
				{
					amount: 112,
					currency: "usd",
					application_fee_amount: 12,
					transfer_data: { destination: "acct_sub" },
					on_behalf_of: "acct_sub",
					metadata: {
						kind: "substitution",
						proposalId: proposalId!,
						orderId,
						sessionId,
						restaurantId,
						paymentId: result.paymentId,
						deltaAmount: "100",
						feeOnDelta: "12",
					},
					customer: "cus_sub",
					payment_method: "pm_saved",
					off_session: true,
					confirm: true,
				},
				{ idempotencyKey: `substitution-payment:${result.paymentId}` }
			);

			const { payment, proposal } = await t.run(async (ctx) => ({
				payment: await ctx.db.get(result.paymentId),
				proposal: await ctx.db.get(proposalId!),
			}));
			expect(payment).toMatchObject({
				kind: "substitution",
				amount: 112,
				subtotalAmount: 100,
				feeAmount: 12,
				paidByUserId: DINER,
				substitutionProposalId: proposalId,
				orderId,
				sessionId,
				status: "processing",
				stripePaymentIntentId: "pi_sub_delta",
			});
			expect(proposal?.supplementalPaymentId).toBe(result.paymentId);
			// The swap waits for the webhook — nothing moved yet.
			expect(proposal?.status).toBe("pending");
		});

		it("falls back to an unconfirmed Elements intent when no saved card exists", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, molcajeteId, paymentId, staff, diner } = await seedPaidOrder(t);

			// Strip the saved card off the order payment.
			await t.run(async (ctx) => {
				await ctx.db.patch(paymentId, { stripePaymentMethodId: undefined });
			});

			const [proposalId] = await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: molcajeteId,
			});

			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_sub_fallback",
				status: "requires_payment_method",
				client_secret: "pi_secret_fallback",
			});

			const result = await diner.action(api.stripe.createSubstitutionPaymentIntent, {
				proposalId: proposalId!,
			});
			expect(result.clientSecret).toBe("pi_secret_fallback");

			const createArgs = mockStripeClient.paymentIntents.create.mock.calls[0][0];
			// Unconfirmed — the diner confirms in the payment sheet — and the card
			// saves onto the existing Customer for next time.
			expect(createArgs.confirm).toBeUndefined();
			expect(createArgs.off_session).toBeUndefined();
			expect(createArgs.setup_future_usage).toBe("off_session");
		});

		it("hands back the 3DS client secret when the bank demands authentication", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, molcajeteId, staff, diner } = await seedPaidOrder(t);

			const [proposalId] = await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: molcajeteId,
			});

			mockStripeClient.paymentIntents.create.mockRejectedValueOnce(
				Object.assign(new Error("authentication required"), {
					code: "authentication_required",
					raw: {
						payment_intent: { id: "pi_sub_3ds", client_secret: "pi_secret_3ds" },
					},
				})
			);

			const result = await diner.action(api.stripe.createSubstitutionPaymentIntent, {
				proposalId: proposalId!,
			});
			expect(result.clientSecret).toBe("pi_secret_3ds");

			const payment = await t.run(async (ctx) => ctx.db.get(result.paymentId));
			expect(payment).toMatchObject({
				status: "processing",
				stripePaymentIntentId: "pi_sub_3ds",
			});
		});

		it("reuses a still-processing intent on a re-call", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, molcajeteId, staff, diner } = await seedPaidOrder(t);

			const [proposalId] = await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: molcajeteId,
			});

			mockStripeClient.paymentIntents.create.mockRejectedValueOnce(
				Object.assign(new Error("authentication required"), {
					code: "authentication_required",
					raw: {
						payment_intent: { id: "pi_sub_reuse", client_secret: "pi_secret_reuse" },
					},
				})
			);
			mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
				id: "pi_sub_reuse",
				status: "requires_action",
				client_secret: "pi_secret_reuse",
			});

			const first = await diner.action(api.stripe.createSubstitutionPaymentIntent, {
				proposalId: proposalId!,
			});
			const second = await diner.action(api.stripe.createSubstitutionPaymentIntent, {
				proposalId: proposalId!,
			});

			expect(first.paymentId).toBe(second.paymentId);
			expect(second.clientSecret).toBe("pi_secret_reuse");
			expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledTimes(1);
		});

		it("rejects strangers and non-pending proposals", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, molcajeteId, staff, diner } = await seedPaidOrder(t);

			const [proposalId] = await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: molcajeteId,
			});

			const stranger = t.withIdentity({ subject: "someone-else" });
			await expect(
				stranger.action(api.stripe.createSubstitutionPaymentIntent, { proposalId: proposalId! })
			).rejects.toMatchObject({ name: "NOT_AUTHORIZED" });

			await staff.mutation(api.substitutions.cancelProposal, { proposalId: proposalId! });
			await expect(
				diner.action(api.stripe.createSubstitutionPaymentIntent, { proposalId: proposalId! })
			).rejects.toThrow(/ERROR_SUBSTITUTION_NOT_PENDING/);
		});
	});

	describe("confirmSubstitutionPayment (webhook)", () => {
		async function seedProposalWithProcessingPayment(t: ReturnType<typeof convexTest>) {
			const seed = await seedPaidOrder(t);
			const [proposalId] = await seed.staff.mutation(api.substitutions.proposeSubstitution, {
				orderId: seed.orderId,
				orderItemId: seed.drinkItemId,
				proposedMenuItemId: seed.molcajeteId,
			});
			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_sub_hook",
				status: "processing",
				client_secret: "pi_secret_hook",
			});
			const { paymentId } = await seed.diner.action(api.stripe.createSubstitutionPaymentIntent, {
				proposalId: proposalId!,
			});
			return { ...seed, proposalId: proposalId!, subPaymentId: paymentId };
		}

		it("applies the swap, raises the order total by the delta, and is idempotent", async () => {
			const t = convexTest(schema, modules);
			const { orderId, drinkItemId, molcajeteId, proposalId, subPaymentId } =
				await seedProposalWithProcessingPayment(t);

			await t.mutation(internal.substitutions.confirmSubstitutionPayment, {
				paymentId: subPaymentId,
				stripePaymentIntentId: "pi_sub_hook",
				stripeChargeId: "ch_sub_hook",
			});
			// Replay: webhooks redeliver.
			await t.mutation(internal.substitutions.confirmSubstitutionPayment, {
				paymentId: subPaymentId,
				stripePaymentIntentId: "pi_sub_hook",
				stripeChargeId: "ch_sub_hook",
			});

			const { proposal, item, order, payment, acceptedEvents } = await t.run(async (ctx) => ({
				proposal: await ctx.db.get(proposalId),
				item: await ctx.db.get(drinkItemId),
				order: await ctx.db.get(orderId),
				payment: await ctx.db.get(subPaymentId),
				acceptedEvents: await ctx.db
					.query("allEvents")
					.filter((q) => q.eq(q.field("eventType"), "substitutions.accepted"))
					.collect(),
			}));
			expect(payment?.status).toBe("succeeded");
			expect(proposal).toMatchObject({
				status: "accepted",
				supplementalPaymentId: subPaymentId,
				respondedByUserId: DINER,
			});
			expect(item).toMatchObject({
				menuItemId: molcajeteId,
				menuItemName: "Molcajete",
				unitPrice: 700,
				lineTotal: 700,
			});
			// 1400 - 600 + 700 = 1500: the swap raises the total by the delta.
			expect(order?.totalAmount).toBe(1500);
			// The replay applied nothing twice.
			expect(acceptedEvents).toHaveLength(1);
		});

		it("refunds the delta in full when the proposal died under the charge", async () => {
			vi.useFakeTimers();
			try {
				const t = convexTest(schema, modules);
				const { staff, proposalId, subPaymentId, orderId, drinkItemId } =
					await seedProposalWithProcessingPayment(t);

				await staff.mutation(api.substitutions.cancelProposal, { proposalId });

				mockStripeClient.refunds.create.mockResolvedValueOnce({
					id: "re_dead_proposal",
					status: "succeeded",
					amount: 112,
				});
				await t.mutation(internal.substitutions.confirmSubstitutionPayment, {
					paymentId: subPaymentId,
					stripePaymentIntentId: "pi_sub_hook",
				});
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());

				// Full refund of the delta payment; nothing swapped.
				expect(mockStripeClient.refunds.create).toHaveBeenCalledWith(
					{
						payment_intent: "pi_sub_hook",
						reverse_transfer: true,
						refund_application_fee: true,
					},
					{ idempotencyKey: `refund:${subPaymentId}` }
				);
				const { item, order } = await t.run(async (ctx) => ({
					item: await ctx.db.get(drinkItemId),
					order: await ctx.db.get(orderId),
				}));
				expect(item?.menuItemName).toBe("Agua fresca");
				expect(order?.totalAmount).toBe(1400);
			} finally {
				vi.useRealTimers();
			}
		});

		it("a failed delta charge leaves the proposal pending for a retry", async () => {
			const t = convexTest(schema, modules);
			const { proposalId, subPaymentId } = await seedProposalWithProcessingPayment(t);

			await t.mutation(internal.substitutions.failSubstitutionPayment, {
				paymentId: subPaymentId,
				stripePaymentIntentId: "pi_sub_hook",
				failureCode: "card_declined",
				failureMessage: "Your card was declined.",
			});

			const { proposal, payment } = await t.run(async (ctx) => ({
				proposal: await ctx.db.get(proposalId),
				payment: await ctx.db.get(subPaymentId),
			}));
			expect(payment).toMatchObject({ status: "failed", failureCode: "card_declined" });
			expect(proposal?.status).toBe("pending");
		});
	});

	describe("cross-payment refund of a substituted line", () => {
		/** Paid order with the drink swapped to Molcajete via a settled delta payment. */
		async function seedSubstitutedLine(t: ReturnType<typeof convexTest>) {
			const seed = await seedPaidOrder(t);
			const [proposalId] = await seed.staff.mutation(api.substitutions.proposeSubstitution, {
				orderId: seed.orderId,
				orderItemId: seed.drinkItemId,
				proposedMenuItemId: seed.molcajeteId,
			});
			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_sub_cross",
				status: "succeeded",
				client_secret: null,
			});
			const { paymentId: subPaymentId } = await seed.diner.action(
				api.stripe.createSubstitutionPaymentIntent,
				{ proposalId: proposalId! }
			);
			await t.mutation(internal.substitutions.confirmSubstitutionPayment, {
				paymentId: subPaymentId,
				stripePaymentIntentId: "pi_sub_cross",
			});
			return { ...seed, proposalId: proposalId!, subPaymentId };
		}

		it("86'ing the substituted line refunds both payments with per-payment keys", async () => {
			vi.useFakeTimers();
			try {
				const t = convexTest(schema, modules);
				const { orderId, drinkItemId, paymentId, subPaymentId, staff } =
					await seedSubstitutedLine(t);

				mockStripeClient.refunds.create
					.mockResolvedValueOnce({ id: "re_sub_delta", status: "succeeded", amount: 112 })
					.mockResolvedValueOnce({ id: "re_sub_original", status: "succeeded", amount: 672 });

				await staff.mutation(api.orders.cancelOrderItem, { orderItemId: drinkItemId });
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());

				// (a) the substitution payment's remaining balance (delta 100 + fee 12)…
				expect(mockStripeClient.refunds.create).toHaveBeenNthCalledWith(
					1,
					{
						payment_intent: "pi_sub_cross",
						amount: 112,
						reverse_transfer: true,
						refund_application_fee: true,
					},
					{ idempotencyKey: `refund:${subPaymentId}:${drinkItemId}` }
				);
				// (b) …then the ORIGINAL line value (700 - 100 = 600) + its fee share
				// from the order payment.
				expect(mockStripeClient.refunds.create).toHaveBeenNthCalledWith(
					2,
					{
						payment_intent: "pi_sub_order",
						amount: 672,
						reverse_transfer: true,
						refund_application_fee: true,
					},
					{ idempotencyKey: `refund:${paymentId}:${drinkItemId}` }
				);

				const { item, order, orderPayment, subPayment } = await t.run(async (ctx) => ({
					item: await ctx.db.get(drinkItemId),
					order: await ctx.db.get(orderId),
					orderPayment: await ctx.db.get(paymentId),
					subPayment: await ctx.db.get(subPaymentId),
				}));

				// Invariant: total refunded across both payments === original line
				// refund (600 + 72) + (delta 100 + feeOnDelta 12).
				expect(item?.refundAmount).toBe(672 + 112);
				expect(orderPayment?.amountRefunded).toBe(672);
				expect(subPayment?.amountRefunded).toBe(112);
				// Neither payment refunds more than it captured.
				expect(orderPayment!.amountRefunded!).toBeLessThanOrEqual(orderPayment!.amount);
				expect(subPayment!.amountRefunded!).toBe(subPayment!.amount);
				expect(subPayment?.refundStatus).toBe("succeeded");
				// The order keeps cooking with the tacos.
				expect(order?.status).toBe("submitted");
				expect(order?.totalAmount).toBe(800);
			} finally {
				vi.useRealTimers();
			}
		});

		it("the last-live-line sweep clears the remaining balance of BOTH payments", async () => {
			vi.useFakeTimers();
			try {
				const t = convexTest(schema, modules);
				const { orderId, tacosItemId, drinkItemId, paymentId, subPaymentId, staff } =
					await seedSubstitutedLine(t);

				mockStripeClient.refunds.create
					// Tacos 86: 800 + 96.
					.mockResolvedValueOnce({ id: "re_tacos", status: "succeeded", amount: 896 })
					// Substituted drink 86 (last live line): delta payment 112…
					.mockResolvedValueOnce({ id: "re_last_delta", status: "succeeded", amount: 112 })
					// …then the order payment's entire remaining balance 1568 - 896.
					.mockResolvedValueOnce({ id: "re_last_sweep", status: "succeeded", amount: 672 });

				await staff.mutation(api.orders.cancelOrderItem, { orderItemId: tacosItemId });
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());
				await staff.mutation(api.orders.cancelOrderItem, { orderItemId: drinkItemId });
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());

				const amounts = mockStripeClient.refunds.create.mock.calls.map(
					(call) => (call[0] as { amount: number }).amount
				);
				expect(amounts).toEqual([896, 112, 672]);

				const { order, orderPayment, subPayment } = await t.run(async (ctx) => ({
					order: await ctx.db.get(orderId),
					orderPayment: await ctx.db.get(paymentId),
					subPayment: await ctx.db.get(subPaymentId),
				}));
				// Both charges fully returned — no residue on either payment.
				expect(orderPayment?.amountRefunded).toBe(orderPayment?.amount);
				expect(subPayment?.amountRefunded).toBe(subPayment?.amount);
				expect(order?.status).toBe("cancelled");
				expect(order?.paymentState).toBe("refunded");
			} finally {
				vi.useRealTimers();
			}
		});

		it("clamps the original share to the order payment's remaining balance", async () => {
			vi.useFakeTimers();
			try {
				const t = convexTest(schema, modules);
				const { drinkItemId, paymentId, subPaymentId, staff } = await seedSubstitutedLine(t);

				// Simulate most of the order payment already refunded elsewhere.
				await t.run(async (ctx) => {
					await ctx.db.patch(paymentId, { amountRefunded: 1200 });
				});

				mockStripeClient.refunds.create
					.mockResolvedValueOnce({ id: "re_clamp_delta", status: "succeeded", amount: 112 })
					.mockResolvedValueOnce({ id: "re_clamp", status: "succeeded", amount: 368 });

				await staff.mutation(api.orders.cancelOrderItem, { orderItemId: drinkItemId });
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());

				const amounts = mockStripeClient.refunds.create.mock.calls.map(
					(call) => (call[0] as { amount: number }).amount
				);
				// Original share wants 672 but only 1568 - 1200 = 368 remains.
				expect(amounts).toEqual([112, 368]);

				const { orderPayment, subPayment } = await t.run(async (ctx) => ({
					orderPayment: await ctx.db.get(paymentId),
					subPayment: await ctx.db.get(subPaymentId),
				}));
				expect(orderPayment!.amountRefunded!).toBeLessThanOrEqual(orderPayment!.amount);
				expect(subPayment!.amountRefunded!).toBeLessThanOrEqual(subPayment!.amount);
			} finally {
				vi.useRealTimers();
			}
		});
	});
});
