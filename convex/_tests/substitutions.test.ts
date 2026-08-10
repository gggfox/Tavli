/**
 * TAVLI-71 Phase 3A — substitution proposals on paid orders (ADR 008).
 *
 * Covers the proposal lifecycle (propose / cancel / accept / decline), the
 * supplemental delta payment (one-tap, Elements fallback, webhook confirm,
 * failure), the guard interplay with 86/cancel, and the cross-payment refund
 * of a substituted line.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

		it("prices the decline refund as line + fee share while the payment is untouched", async () => {
			const t = convexTest(schema, modules);
			const { orderId, sessionId, drinkItemId, molcajeteId, staff, diner } = await seedPaidOrder(t);

			await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: molcajeteId,
			});

			const pending = await diner.query(api.substitutions.getPendingForSession, { sessionId });
			// 600 + round(600 x 12%) = 672 — one of two live lines, so no sweep.
			expect(pending[0].declineRefundAmount).toBe(672);
		});

		it("clamps the decline refund to what is LEFT on the payment", async () => {
			const t = convexTest(schema, modules);
			const { orderId, sessionId, drinkItemId, molcajeteId, paymentId, staff, diner } =
				await seedPaidOrder(t);

			await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: molcajeteId,
			});
			// Something already came back off this charge: only 200 is left.
			await t.run(async (ctx) => {
				await ctx.db.patch(paymentId, { amountRefunded: 1368, refundStatus: "partial" });
			});

			const pending = await diner.query(api.substitutions.getPendingForSession, { sessionId });
			// The unclamped client-side formula promised 672; the diner gets 200.
			expect(pending[0].declineRefundAmount).toBe(200);
		});

		it("previews the whole remaining balance when the line is the order's last live one", async () => {
			const t = convexTest(schema, modules);
			const { orderId, sessionId, tacosItemId, drinkItemId, molcajeteId, staff, diner } =
				await seedPaidOrder(t);

			await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: molcajeteId,
			});
			// Tacos already 86'd by hand: declining now cancels the order, and the
			// refund sweeps the payment's entire remainder (fee included).
			await t.run(async (ctx) => {
				await ctx.db.patch(tacosItemId, { cancelledAt: Date.now(), cancelledBy: STAFF });
			});

			const pending = await diner.query(api.substitutions.getPendingForSession, { sessionId });
			expect(pending[0].declineRefundAmount).toBe(1568);
		});

		it("reports null rather than a wrong figure when the money is legacy/unresolvable", async () => {
			const t = convexTest(schema, modules);
			const { orderId, sessionId, drinkItemId, molcajeteId, paymentId, staff, diner } =
				await seedPaidOrder(t);

			await staff.mutation(api.substitutions.proposeSubstitution, {
				orderId,
				orderItemId: drinkItemId,
				proposedMenuItemId: molcajeteId,
			});
			// Strip the ADR 008 vintage markers: declineProposal would refuse with
			// ERROR_REFUND_PAYMENT_UNRESOLVED, so no figure may be promised.
			await t.run(async (ctx) => {
				await ctx.db.patch(paymentId, {
					kind: undefined,
					subtotalAmount: undefined,
					feeAmount: undefined,
				});
			});

			const pending = await diner.query(api.substitutions.getPendingForSession, { sessionId });
			expect(pending[0].declineRefundAmount).toBeNull();
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

		it("a retry after a half-failure records the line's COMBINED refund, not just the retry's leg", async () => {
			vi.useFakeTimers();
			try {
				const t = convexTest(schema, modules);
				const { orderId, drinkItemId, paymentId, subPaymentId, staff } =
					await seedSubstitutedLine(t);

				// Attempt 1: the delta refund goes through, the order-payment refund
				// throws. The line is deliberately left unstamped so it can retry.
				mockStripeClient.refunds.create
					.mockResolvedValueOnce({ id: "re_half_delta", status: "succeeded", amount: 112 })
					.mockRejectedValueOnce(new Error("stripe_unavailable"));

				await staff.mutation(api.orders.cancelOrderItem, { orderItemId: drinkItemId });
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());

				const half = await t.run(async (ctx) => ({
					item: await ctx.db.get(drinkItemId),
					order: await ctx.db.get(orderId),
					subPayment: await ctx.db.get(subPaymentId),
				}));
				expect(half.item?.refundedAt).toBeUndefined();
				expect(half.order?.paymentState).toBe("refund_failed");
				// The delta that DID come back is on the record already.
				expect(half.subPayment?.amountRefunded).toBe(112);

				// Attempt 2: the substitution payment now has nothing left, so this
				// run only moves the order-payment share.
				mockStripeClient.refunds.create.mockResolvedValueOnce({
					id: "re_retry_original",
					status: "succeeded",
					amount: 672,
				});
				await t.action(internal.stripe.refundOrderItem, {
					orderId,
					orderItemId: drinkItemId,
					paymentId,
				});

				const after = await t.run(async (ctx) => ({
					item: await ctx.db.get(drinkItemId),
					order: await ctx.db.get(orderId),
					orderPayment: await ctx.db.get(paymentId),
					subPayment: await ctx.db.get(subPaymentId),
				}));
				// Three Stripe calls total: the delta was NOT refunded twice.
				expect(mockStripeClient.refunds.create).toHaveBeenCalledTimes(3);
				expect(after.subPayment?.amountRefunded).toBe(112);
				expect(after.orderPayment?.amountRefunded).toBe(672);
				// The figure staff read off the line is the combined one — the retry
				// used to record 672 and understate the line by the whole delta.
				expect(after.item?.refundAmount).toBe(672 + 112);
				expect(after.item?.refundedAt).toBeTypeOf("number");
			} finally {
				vi.useRealTimers();
			}
		});
	});

	/**
	 * The whole-order sibling of the block above (TAVLI-71 Phase 5): a staff comp
	 * of an order holding accepted substitutions has to return the delta charges
	 * too. Before this, `cancelOrderAndRefund` refunded only the order payment and
	 * the diner stayed out of pocket by every accepted delta.
	 */
	describe("whole-order cancel sweeps the substitution payments", () => {
		afterEach(() => {
			// These tests install call-shape-driven implementations; reset so they
			// cannot leak into anything appended after this block.
			mockStripeClient.refunds.create.mockReset();
			mockStripeClient.paymentIntents.create.mockReset();
		});

		/**
		 * Proposes a substitution, charges its delta on the saved card, and lands
		 * the webhook — leaving one ACCEPTED proposal with settled supplemental
		 * money. Parameterised by line and replacement so a single line can be
		 * substituted twice (the chained case).
		 */
		async function acceptSubstitution(
			t: ReturnType<typeof convexTest>,
			seed: Awaited<ReturnType<typeof seedPaidOrder>>,
			args: {
				orderItemId: Id<"orderItems">;
				proposedMenuItemId: Id<"menuItems">;
				stripePaymentIntentId: string;
			}
		) {
			const [proposalId] = await seed.staff.mutation(api.substitutions.proposeSubstitution, {
				orderId: seed.orderId,
				orderItemId: args.orderItemId,
				proposedMenuItemId: args.proposedMenuItemId,
			});
			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: args.stripePaymentIntentId,
				status: "succeeded",
				client_secret: null,
			});
			const { paymentId: subPaymentId } = await seed.diner.action(
				api.stripe.createSubstitutionPaymentIntent,
				{ proposalId: proposalId! }
			);
			await t.mutation(internal.substitutions.confirmSubstitutionPayment, {
				paymentId: subPaymentId,
				stripePaymentIntentId: args.stripePaymentIntentId,
			});
			return { proposalId: proposalId!, subPaymentId };
		}

		/** A second, pricier replacement for the chained-substitution case. */
		async function insertMenuItem(
			t: ReturnType<typeof convexTest>,
			restaurantId: Id<"restaurants">,
			args: { name: string; basePrice: number }
		): Promise<Id<"menuItems">> {
			return await t.run(async (ctx) => {
				const sibling = (await ctx.db.query("menuItems").collect()).find(
					(item) => item.restaurantId === restaurantId
				)!;
				return await ctx.db.insert("menuItems", {
					categoryId: sibling.categoryId,
					restaurantId,
					name: args.name,
					basePrice: args.basePrice,
					isAvailable: true,
					displayOrder: 9,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});
		}

		/** Every `refunds.create` call as `{ payment_intent, amount, idempotencyKey }`. */
		function refundCalls() {
			return mockStripeClient.refunds.create.mock.calls.map((call) => ({
				...(call[0] as { payment_intent: string; amount?: number }),
				idempotencyKey: (call[1] as { idempotencyKey: string }).idempotencyKey,
			}));
		}

		it("refunds the order payment AND the accepted delta, with distinct keys", async () => {
			const t = convexTest(schema, modules);
			const seed = await seedPaidOrder(t);
			const { subPaymentId } = await acceptSubstitution(t, seed, {
				orderItemId: seed.drinkItemId,
				proposedMenuItemId: seed.molcajeteId,
				stripePaymentIntentId: "pi_sub_whole",
			});

			mockStripeClient.refunds.create
				.mockResolvedValueOnce({ id: "re_whole_delta", status: "succeeded", amount: 112 })
				.mockResolvedValueOnce({ id: "re_whole_order", status: "succeeded", amount: 1568 });

			const [result, error] = await seed.staff.action(api.stripe.cancelOrderAndRefund, {
				orderId: seed.orderId,
			});
			expect(error).toBeNull();

			// (a) the substitution charge in full (delta 100 + feeOnDelta 12), keyed
			// on (payment, ORDER) — distinct from the (payment, line) key an 86
			// would use on this very same charge.
			expect(mockStripeClient.refunds.create).toHaveBeenNthCalledWith(
				1,
				{
					payment_intent: "pi_sub_whole",
					amount: 112,
					reverse_transfer: true,
					refund_application_fee: true,
				},
				{ idempotencyKey: `refund:${subPaymentId}:${seed.orderId}` }
			);
			// (b) then the order payment. Fee-inclusive ⇒ its whole remaining
			// balance, so `amount` is omitted and Stripe empties the charge.
			expect(mockStripeClient.refunds.create).toHaveBeenNthCalledWith(
				2,
				{
					payment_intent: "pi_sub_order",
					reverse_transfer: true,
					refund_application_fee: true,
				},
				{ idempotencyKey: `refund:${seed.paymentId}:${seed.orderId}` }
			);
			expect(new Set(refundCalls().map((call) => call.idempotencyKey)).size).toBe(2);

			const { order, orderPayment, subPayment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(seed.orderId),
				orderPayment: await ctx.db.get(seed.paymentId),
				subPayment: await ctx.db.get(subPaymentId),
			}));

			// The invariant that matters: the diner is made EXACTLY whole across
			// both PaymentIntents — 1568 + 112 charged, 1568 + 112 back.
			expect(result?.amountRefunded).toBe(orderPayment!.amount + subPayment!.amount);
			expect(result?.amountRefunded).toBe(1680);
			expect(subPayment?.amountRefunded).toBe(subPayment?.amount);
			expect(subPayment?.refundStatus).toBe("succeeded");
			expect(order?.status).toBe("cancelled");
			expect(order?.paymentState).toBe("refunded");
		});

		it("does not re-refund a line that was already 86'd and refunded", async () => {
			vi.useFakeTimers();
			try {
				const t = convexTest(schema, modules);
				const seed = await seedPaidOrder(t);
				const { subPaymentId } = await acceptSubstitution(t, seed, {
					orderItemId: seed.drinkItemId,
					proposedMenuItemId: seed.molcajeteId,
					stripePaymentIntentId: "pi_sub_twice",
				});

				mockStripeClient.refunds.create
					// The 86 of the substituted line: delta charge, then its original
					// share of the order payment.
					.mockResolvedValueOnce({ id: "re_86_delta", status: "succeeded", amount: 112 })
					.mockResolvedValueOnce({ id: "re_86_original", status: "succeeded", amount: 672 })
					// The later whole-order cancel: only what the order payment has left.
					.mockResolvedValueOnce({ id: "re_rest", status: "succeeded", amount: 896 });

				await seed.staff.mutation(api.orders.cancelOrderItem, {
					orderItemId: seed.drinkItemId,
				});
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());

				const [result, error] = await seed.staff.action(api.stripe.cancelOrderAndRefund, {
					orderId: seed.orderId,
				});
				expect(error).toBeNull();

				const calls = refundCalls();
				expect(calls).toHaveLength(3);
				// The delta charge is touched exactly once, by the 86 — the sweep
				// skips it because the line carries `refundedAt`.
				expect(calls.filter((call) => call.payment_intent === "pi_sub_whole")).toHaveLength(0);
				expect(calls.filter((call) => call.payment_intent === "pi_sub_twice")).toHaveLength(1);
				// The whole-order refund empties what is left of the order payment
				// (tacos 800 + its 96 fee), not the full 1568.
				expect(calls[2]).toMatchObject({
					payment_intent: "pi_sub_order",
					idempotencyKey: `refund:${seed.paymentId}:${seed.orderId}`,
				});

				const { orderPayment, subPayment } = await t.run(async (ctx) => ({
					orderPayment: await ctx.db.get(seed.paymentId),
					subPayment: await ctx.db.get(subPaymentId),
				}));
				// 112 + 672 + 896 === 1568 + 112: still exactly whole, no double pay.
				expect(112 + 672 + result!.amountRefunded).toBe(orderPayment!.amount + subPayment!.amount);
				expect(subPayment?.amountRefunded).toBe(112);
				expect(subPayment!.amountRefunded!).toBeLessThanOrEqual(subPayment!.amount);
			} finally {
				vi.useRealTimers();
			}
		});

		it("sweeps every accepted proposal when one line was substituted twice", async () => {
			const t = convexTest(schema, modules);
			const seed = await seedPaidOrder(t);
			const parrilladaId = await insertMenuItem(t, seed.restaurantId, {
				name: "Parrillada",
				basePrice: 900,
			});

			// 600 → Molcajete 700 (delta 100, fee 12) → Parrillada 900 (delta 200,
			// fee 24). Three charges in total, one order payment and two deltas.
			const first = await acceptSubstitution(t, seed, {
				orderItemId: seed.drinkItemId,
				proposedMenuItemId: seed.molcajeteId,
				stripePaymentIntentId: "pi_chain_1",
			});
			const second = await acceptSubstitution(t, seed, {
				orderItemId: seed.drinkItemId,
				proposedMenuItemId: parrilladaId,
				stripePaymentIntentId: "pi_chain_2",
			});

			// Echo the requested amount so the assertions do not depend on the
			// order the two delta charges happen to be swept in.
			mockStripeClient.refunds.create.mockImplementation((params: { amount?: number }) =>
				Promise.resolve({
					id: `re_${params.amount ?? "remaining"}`,
					status: "succeeded",
					amount: params.amount ?? 1568,
				})
			);

			const [result, error] = await seed.staff.action(api.stripe.cancelOrderAndRefund, {
				orderId: seed.orderId,
			});
			expect(error).toBeNull();

			const calls = refundCalls();
			expect(calls).toHaveLength(3);
			expect(calls.find((call) => call.payment_intent === "pi_chain_1")).toMatchObject({
				amount: 112,
				idempotencyKey: `refund:${first.subPaymentId}:${seed.orderId}`,
			});
			expect(calls.find((call) => call.payment_intent === "pi_chain_2")).toMatchObject({
				amount: 224,
				idempotencyKey: `refund:${second.subPaymentId}:${seed.orderId}`,
			});
			expect(new Set(calls.map((call) => call.idempotencyKey)).size).toBe(3);

			const { firstPayment, secondPayment, orderPayment } = await t.run(async (ctx) => ({
				firstPayment: await ctx.db.get(first.subPaymentId),
				secondPayment: await ctx.db.get(second.subPaymentId),
				orderPayment: await ctx.db.get(seed.paymentId),
			}));
			// Whole across all three intents: 1568 + 112 + 224.
			expect(result?.amountRefunded).toBe(
				orderPayment!.amount + firstPayment!.amount + secondPayment!.amount
			);
			expect(result?.amountRefunded).toBe(1904);
			expect(firstPayment?.amountRefunded).toBe(firstPayment?.amount);
			expect(secondPayment?.amountRefunded).toBe(secondPayment?.amount);
		});

		it("skips a supplemental payment that is not succeeded substitution money", async () => {
			// Vintage guard, defense in depth: only a succeeded kind-"substitution"
			// row is swept. Anything else (a retired delta intent, legacy money, a
			// mis-pointed id) is left to the order-payment math alone.
			const t = convexTest(schema, modules);
			const seed = await seedPaidOrder(t);
			const { subPaymentId } = await acceptSubstitution(t, seed, {
				orderItemId: seed.drinkItemId,
				proposedMenuItemId: seed.molcajeteId,
				stripePaymentIntentId: "pi_sub_vintage",
			});
			await t.run(async (ctx) => {
				await ctx.db.patch(subPaymentId, { kind: undefined, subtotalAmount: undefined });
			});

			mockStripeClient.refunds.create.mockResolvedValueOnce({
				id: "re_order_only",
				status: "succeeded",
				amount: 1568,
			});

			const [result, error] = await seed.staff.action(api.stripe.cancelOrderAndRefund, {
				orderId: seed.orderId,
			});
			expect(error).toBeNull();
			expect(result?.amountRefunded).toBe(1568);

			const calls = refundCalls();
			expect(calls).toHaveLength(1);
			expect(calls[0].payment_intent).toBe("pi_sub_order");
			const subPayment = await t.run(async (ctx) => ctx.db.get(subPaymentId));
			expect(subPayment?.amountRefunded).toBeUndefined();
		});

		it("records the delta that came back when the order-payment refund fails", async () => {
			const t = convexTest(schema, modules);
			const seed = await seedPaidOrder(t);
			const { subPaymentId } = await acceptSubstitution(t, seed, {
				orderItemId: seed.drinkItemId,
				proposedMenuItemId: seed.molcajeteId,
				stripePaymentIntentId: "pi_sub_partial",
			});

			mockStripeClient.refunds.create
				.mockResolvedValueOnce({ id: "re_partial_delta", status: "succeeded", amount: 112 })
				.mockRejectedValueOnce(new Error("charge_already_refunded"));

			const [result, error] = await seed.staff.action(api.stripe.cancelOrderAndRefund, {
				orderId: seed.orderId,
			});
			expect(result).toBeNull();
			expect(error!.message).toBe("ERROR_REFUND_FAILED");

			const { order, subPayment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(seed.orderId),
				subPayment: await ctx.db.get(subPaymentId),
			}));
			// Money is still owed, so staff must see it…
			expect(order?.status).toBe("cancelled");
			expect(order?.paymentState).toBe("refund_failed");
			// …but the delta that DID come back is recorded, so the follow-up does
			// not return it a second time.
			expect(subPayment?.amountRefunded).toBe(112);
		});

		it("still refunds the order payment when a delta refund fails", async () => {
			// Unlike the per-line path there is no retry here — a cancelled order
			// cannot be cancelled again — so one failed leg must not strand the
			// legs that would have succeeded.
			const t = convexTest(schema, modules);
			const seed = await seedPaidOrder(t);
			const { subPaymentId } = await acceptSubstitution(t, seed, {
				orderItemId: seed.drinkItemId,
				proposedMenuItemId: seed.molcajeteId,
				stripePaymentIntentId: "pi_sub_delta_fails",
			});

			mockStripeClient.refunds.create
				.mockRejectedValueOnce(new Error("delta_refund_failed"))
				.mockResolvedValueOnce({ id: "re_order_after", status: "succeeded", amount: 1568 });

			const [result, error] = await seed.staff.action(api.stripe.cancelOrderAndRefund, {
				orderId: seed.orderId,
			});
			expect(result).toBeNull();
			expect(error!.message).toBe("ERROR_REFUND_FAILED");

			const calls = refundCalls();
			expect(calls).toHaveLength(2);
			expect(calls[1].payment_intent).toBe("pi_sub_order");

			const { order, subPayment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(seed.orderId),
				subPayment: await ctx.db.get(subPaymentId),
			}));
			expect(order?.paymentState).toBe("refund_failed");
			expect(subPayment?.refundStatus).toBe("failed");
			expect(subPayment?.amountRefunded).toBeUndefined();
		});
	});
});
