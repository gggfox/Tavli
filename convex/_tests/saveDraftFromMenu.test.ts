import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ERROR_NAMES } from "../_shared/errors";
import { MAX_DRAFT_ORDER_LINES, MAX_ORDER_ITEM_QUANTITY } from "../constants";
import { DRAFT_ORDER_ERRORS } from "../orderHelpers";
import { PAYMENT_SUPERSEDE_ERRORS } from "../paymentSupersedeHelpers";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

type TestConvex = ReturnType<typeof convexTest<(typeof schema)["tables"]>>;

/**
 * `orders.saveDraftFromMenu` — the one call the diner menu makes to turn its
 * picks into the draft the checkout charges (ADR 008). The bugs it replaces:
 * the old per-line loop appended to an existing draft (a diner who went to
 * checkout, backed out and picked again paid for both rounds), ignored a
 * re-picked table, never checked availability, and could fail half-way.
 */

async function seedRestaurant(t: TestConvex, slug: string) {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const organizationId = await ctx.db.insert("organizations", {
			name: `Org ${slug}`,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner1",
			organizationId,
			name: `Restaurant ${slug}`,
			slug,
			currency: "USD",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const menuId = await insertMenuForRestaurant(ctx, {
			restaurantId,
			name: slug,
			userId: "owner1",
		});
		const categoryId = await ctx.db.insert("menuCategories", {
			menuId,
			restaurantId,
			name: "Mains",
			displayOrder: 0,
			createdAt: now,
			updatedAt: now,
		});
		const dish = (name: string, basePrice: number, isAvailable = true) =>
			ctx.db.insert("menuItems", {
				categoryId,
				restaurantId,
				name,
				basePrice,
				isAvailable,
				displayOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
		const tacosId = await dish("Tacos", 1000);
		const soupId = await dish("Soup", 600);
		const pulledId = await dish("Pozole", 900, false);
		// Imported without a price: stored as 0, hidden from diners.
		const unpricedId = await dish("Shrimp", 0);

		const optionGroupId = await ctx.db.insert("optionGroups", {
			restaurantId,
			name: "Salsa",
			selectionType: "single",
			isRequired: false,
			minSelections: 0,
			maxSelections: 1,
			displayOrder: 0,
			createdAt: now,
			updatedAt: now,
		});
		const optionId = await ctx.db.insert("options", {
			optionGroupId,
			restaurantId,
			name: "Verde",
			priceModifier: 150,
			isAvailable: true,
			displayOrder: 0,
			createdAt: now,
		});

		const tableOneId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 1,
			isActive: true,
			createdAt: now,
		});
		const tableTwoId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 2,
			isActive: true,
			createdAt: now,
		});

		return {
			restaurantId,
			tacosId,
			soupId,
			pulledId,
			unpricedId,
			optionGroupId,
			optionId,
			tableOneId,
			tableTwoId,
		};
	});
}

async function seed(dinerId = "diner1") {
	const t = convexTest(schema, modules);
	const restaurant = await seedRestaurant(t, "casa");
	// A walk-in session: the table is unknown until the first order pins it.
	const sessionId = await t.run(async (ctx) =>
		ctx.db.insert("sessions", {
			restaurantId: restaurant.restaurantId,
			userId: dinerId,
			status: "active",
			startedAt: Date.now(),
		})
	);
	return { t, ...restaurant, sessionId, authed: t.withIdentity({ subject: dinerId }) };
}

async function readDraft(t: TestConvex, orderId: Id<"orders">) {
	return await t.run(async (ctx) => ({
		order: (await ctx.db.get(orderId))!,
		items: await ctx.db
			.query("orderItems")
			.withIndex("by_order", (q) => q.eq("orderId", orderId))
			.collect(),
	}));
}

/** The success value of a result tuple, failing the test on an error. */
function expectOk<T>(
	result: readonly [T, null] | readonly [null, { message: string }]
): NonNullable<T> {
	const [value, error] = result;
	expect(error).toBeNull();
	return value as NonNullable<T>;
}

afterEach(() => {
	vi.useRealTimers();
});

describe("orders.saveDraftFromMenu", () => {
	it("creates a draft with the picks, priced from the menu, and pins the session's table", async () => {
		const { t, authed, sessionId, tacosId, soupId, optionGroupId, optionId, tableOneId } =
			await seed();

		const orderId = expectOk(
			await authed.mutation(api.orders.saveDraftFromMenu, {
				sessionId,
				tableId: tableOneId,
				items: [
					{
						menuItemId: tacosId,
						quantity: 2,
						selectedOptions: [
							{
								optionGroupId,
								optionGroupName: "tampered",
								optionId,
								optionName: "tampered",
								priceModifier: 0,
							},
						],
					},
					{ menuItemId: soupId, quantity: 1, selectedOptions: [] },
				],
				specialInstructions: "No onion",
			})
		);

		const { order, items } = await readDraft(t, orderId);
		expect(order.status).toBe("draft");
		expect(order.tableId).toBe(tableOneId);
		expect(order.specialInstructions).toBe("No onion");
		// (1000 + 150) × 2 + 600 — the option price comes from the database, not
		// from what the client claimed.
		expect(order.totalAmount).toBe(2900);
		expect(items).toHaveLength(2);
		const tacos = items.find((i) => i.menuItemId === tacosId)!;
		expect(tacos.selectedOptions[0].priceModifier).toBe(150);
		expect(tacos.selectedOptions[0].optionName).toBe("Verde");

		const session = await t.run(async (ctx) => ctx.db.get(sessionId));
		expect(session!.tableId).toBe(tableOneId);
	});

	it("replaces the draft's lines instead of appending to them", async () => {
		const { t, authed, sessionId, tacosId, soupId, tableOneId } = await seed();

		const first = expectOk(
			await authed.mutation(api.orders.saveDraftFromMenu, {
				sessionId,
				tableId: tableOneId,
				items: [{ menuItemId: tacosId, quantity: 1, selectedOptions: [] }],
				specialInstructions: "Spicy",
			})
		);
		// Back from checkout: the menu resends the whole order, now with soup.
		const second = expectOk(
			await authed.mutation(api.orders.saveDraftFromMenu, {
				sessionId,
				tableId: tableOneId,
				items: [
					{ menuItemId: tacosId, quantity: 1, selectedOptions: [] },
					{ menuItemId: soupId, quantity: 2, selectedOptions: [] },
				],
			})
		);

		expect(second).toBe(first);
		const { order, items } = await readDraft(t, second);
		expect(items).toHaveLength(2);
		expect(items.find((i) => i.menuItemId === tacosId)!.quantity).toBe(1);
		expect(order.totalAmount).toBe(1000 + 1200);
		// Cleared notes are cleared, not left over from the first save.
		expect(order.specialInstructions).toBeUndefined();

		const drafts = await t.run(async (ctx) =>
			(await ctx.db.query("orders").collect()).filter((o) => o.status === "draft")
		);
		expect(drafts).toHaveLength(1);
	});

	it("moves the draft to a re-picked table, and the session with it while nothing else was ordered", async () => {
		const { t, authed, sessionId, tacosId, tableOneId, tableTwoId } = await seed();
		const items = [{ menuItemId: tacosId, quantity: 1, selectedOptions: [] }];

		await authed.mutation(api.orders.saveDraftFromMenu, {
			sessionId,
			tableId: tableOneId,
			items,
		});
		const orderId = expectOk(
			await authed.mutation(api.orders.saveDraftFromMenu, {
				sessionId,
				tableId: tableTwoId,
				items,
			})
		);

		const { order } = await readDraft(t, orderId);
		expect(order.tableId).toBe(tableTwoId);
		const session = await t.run(async (ctx) => ctx.db.get(sessionId));
		expect(session!.tableId).toBe(tableTwoId);
	});

	it("leaves the session's table alone once an earlier round was ordered there", async () => {
		const { t, authed, sessionId, restaurantId, tacosId, tableOneId, tableTwoId } = await seed();
		await t.run(async (ctx) => {
			await ctx.db.patch(sessionId, { tableId: tableOneId });
			await ctx.db.insert("orders", {
				sessionId,
				restaurantId,
				tableId: tableOneId,
				status: "submitted",
				totalAmount: 1000,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		const orderId = expectOk(
			await authed.mutation(api.orders.saveDraftFromMenu, {
				sessionId,
				tableId: tableTwoId,
				items: [{ menuItemId: tacosId, quantity: 1, selectedOptions: [] }],
			})
		);

		expect((await readDraft(t, orderId)).order.tableId).toBe(tableTwoId);
		const session = await t.run(async (ctx) => ctx.db.get(sessionId));
		expect(session!.tableId).toBe(tableOneId);
	});

	it("refuses a dish staff switched off, pointing at its line, and writes nothing", async () => {
		const { t, authed, sessionId, tacosId, pulledId, tableOneId } = await seed();

		const [value, error] = await authed.mutation(api.orders.saveDraftFromMenu, {
			sessionId,
			tableId: tableOneId,
			items: [
				{ menuItemId: tacosId, quantity: 1, selectedOptions: [] },
				{ menuItemId: pulledId, quantity: 1, selectedOptions: [] },
			],
		});

		expect(value).toBeNull();
		expect(error!.name).toBe(ERROR_NAMES.VALIDATION_ERROR);
		expect(error!.message).toBe(`items.1: ${DRAFT_ORDER_ERRORS.MENU_ITEM_UNAVAILABLE}`);
		// Validation runs before the first write, so the refusal leaves nothing
		// behind — the old loop could stop half-way with half an order saved.
		const orders = await t.run(async (ctx) => ctx.db.query("orders").collect());
		expect(orders).toHaveLength(0);
		const session = await t.run(async (ctx) => ctx.db.get(sessionId));
		expect(session!.tableId).toBeUndefined();
	});

	it("refuses a dish with no price yet, as it would a switched-off one", async () => {
		const { t, authed, sessionId, tacosId, unpricedId, tableOneId } = await seed();

		const [value, error] = await authed.mutation(api.orders.saveDraftFromMenu, {
			sessionId,
			tableId: tableOneId,
			items: [
				{ menuItemId: tacosId, quantity: 1, selectedOptions: [] },
				{ menuItemId: unpricedId, quantity: 2, selectedOptions: [] },
			],
		});

		expect(value).toBeNull();
		expect(error!.message).toBe(`items.1: ${DRAFT_ORDER_ERRORS.MENU_ITEM_UNAVAILABLE}`);
		const orders = await t.run(async (ctx) => ctx.db.query("orders").collect());
		expect(orders).toHaveLength(0);
	});

	it("keeps an existing draft intact when the resubmission is refused", async () => {
		const { t, authed, sessionId, tacosId, pulledId, tableOneId } = await seed();
		const orderId = expectOk(
			await authed.mutation(api.orders.saveDraftFromMenu, {
				sessionId,
				tableId: tableOneId,
				items: [{ menuItemId: tacosId, quantity: 3, selectedOptions: [] }],
			})
		);

		const [, error] = await authed.mutation(api.orders.saveDraftFromMenu, {
			sessionId,
			tableId: tableOneId,
			items: [{ menuItemId: pulledId, quantity: 1, selectedOptions: [] }],
		});

		expect(error!.message).toContain(DRAFT_ORDER_ERRORS.MENU_ITEM_UNAVAILABLE);
		const { order, items } = await readDraft(t, orderId);
		expect(items).toHaveLength(1);
		expect(items[0].quantity).toBe(3);
		expect(order.totalAmount).toBe(3000);
	});

	it("refuses a dish from another restaurant as not found", async () => {
		const { t, authed, sessionId, tableOneId } = await seed();
		const other = await seedRestaurant(t, "otro");

		const [, error] = await authed.mutation(api.orders.saveDraftFromMenu, {
			sessionId,
			tableId: tableOneId,
			items: [{ menuItemId: other.tacosId, quantity: 1, selectedOptions: [] }],
		});

		expect(error!.message).toBe(`items.0: ${DRAFT_ORDER_ERRORS.MENU_ITEM_NOT_FOUND}`);
	});

	it("refuses another restaurant's table", async () => {
		const { t, authed, sessionId, tacosId } = await seed();
		const other = await seedRestaurant(t, "otro");

		const [, error] = await authed.mutation(api.orders.saveDraftFromMenu, {
			sessionId,
			tableId: other.tableOneId,
			items: [{ menuItemId: tacosId, quantity: 1, selectedOptions: [] }],
		});

		expect(error!.name).toBe(ERROR_NAMES.NOT_FOUND);
		expect(error!.message).toBe(DRAFT_ORDER_ERRORS.TABLE_NOT_FOUND);
	});

	it.each([0, -1, 1.5, Number.NaN, MAX_ORDER_ITEM_QUANTITY + 1])(
		"refuses quantity %s",
		async (quantity) => {
			const { authed, sessionId, tacosId, tableOneId } = await seed();

			const [, error] = await authed.mutation(api.orders.saveDraftFromMenu, {
				sessionId,
				tableId: tableOneId,
				items: [{ menuItemId: tacosId, quantity, selectedOptions: [] }],
			});

			expect(error!.message).toBe(`items.0: ${DRAFT_ORDER_ERRORS.QUANTITY_INVALID}`);
		}
	);

	it("accepts the quantity cap itself", async () => {
		const { authed, sessionId, tacosId, tableOneId } = await seed();

		const [, error] = await authed.mutation(api.orders.saveDraftFromMenu, {
			sessionId,
			tableId: tableOneId,
			items: [{ menuItemId: tacosId, quantity: MAX_ORDER_ITEM_QUANTITY, selectedOptions: [] }],
		});

		expect(error).toBeNull();
	});

	it("refuses an empty order and one with too many lines", async () => {
		const { authed, sessionId, tacosId, tableOneId } = await seed();

		const [, empty] = await authed.mutation(api.orders.saveDraftFromMenu, {
			sessionId,
			tableId: tableOneId,
			items: [],
		});
		expect(empty!.message).toBe(`items: ${DRAFT_ORDER_ERRORS.EMPTY}`);

		const [, tooMany] = await authed.mutation(api.orders.saveDraftFromMenu, {
			sessionId,
			tableId: tableOneId,
			items: Array.from({ length: MAX_DRAFT_ORDER_LINES + 1 }, () => ({
				menuItemId: tacosId,
				quantity: 1,
				selectedOptions: [],
			})),
		});
		expect(tooMany!.message).toBe(`items: ${DRAFT_ORDER_ERRORS.TOO_MANY_LINES}`);
	});

	it("refuses once the visit has ended, and for a diner who is not on it", async () => {
		const { t, authed, sessionId, tacosId, tableOneId } = await seed();
		const args = {
			sessionId,
			tableId: tableOneId,
			items: [{ menuItemId: tacosId, quantity: 1, selectedOptions: [] }],
		};

		const [, stranger] = await t
			.withIdentity({ subject: "someone-else" })
			.mutation(api.orders.saveDraftFromMenu, args);
		expect(stranger!.message).toBe(DRAFT_ORDER_ERRORS.SESSION_ENDED);

		await t.run(async (ctx) => ctx.db.patch(sessionId, { status: "closed", closedAt: Date.now() }));
		const [, closed] = await authed.mutation(api.orders.saveDraftFromMenu, args);
		expect(closed!.message).toBe(DRAFT_ORDER_ERRORS.SESSION_ENDED);

		const [, anonymous] = await t.mutation(api.orders.saveDraftFromMenu, args);
		expect(anonymous!.name).toBe(ERROR_NAMES.NOT_AUTHENTICATED);
	});

	describe("with a payment attempt already open on the draft", () => {
		async function seedDraftWithPayment(payment: {
			status: "pending" | "processing";
			stripePaymentIntentId?: string;
		}) {
			const seeded = await seed();
			const orderId = expectOk(
				await seeded.authed.mutation(api.orders.saveDraftFromMenu, {
					sessionId: seeded.sessionId,
					tableId: seeded.tableOneId,
					items: [{ menuItemId: seeded.tacosId, quantity: 1, selectedOptions: [] }],
				})
			);
			const paymentId = await seeded.t.run(async (ctx) => {
				const order = (await ctx.db.get(orderId))!;
				const id = await ctx.db.insert("payments", {
					restaurantId: seeded.restaurantId,
					orderId,
					kind: "order",
					amount: 1120,
					subtotalAmount: 1000,
					feeAmount: 120,
					currency: "usd",
					status: payment.status,
					refundStatus: "none",
					attemptNumber: 1,
					orderUpdatedAtSnapshot: order.updatedAt,
					...(payment.stripePaymentIntentId && {
						stripePaymentIntentId: payment.stripePaymentIntentId,
					}),
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.patch(orderId, {
					activePaymentId: id,
					paymentState: "processing",
					...(payment.stripePaymentIntentId && {
						stripePaymentIntentId: payment.stripePaymentIntentId,
					}),
				});
				return id;
			});
			return { ...seeded, orderId, paymentId };
		}

		it("supersedes the attempt and schedules its intent to be stood down at Stripe", async () => {
			vi.useFakeTimers();
			const { t, authed, sessionId, tacosId, tableOneId, orderId, paymentId } =
				await seedDraftWithPayment({ status: "processing", stripePaymentIntentId: "pi_old" });

			const saved = expectOk(
				await authed.mutation(api.orders.saveDraftFromMenu, {
					sessionId,
					tableId: tableOneId,
					items: [{ menuItemId: tacosId, quantity: 2, selectedOptions: [] }],
				})
			);

			expect(saved).toBe(orderId);
			const { order } = await readDraft(t, orderId);
			expect(order.totalAmount).toBe(2000);
			expect(order.paymentState).toBe("unpaid");
			const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
			expect(payment!.status).toBe("superseded");
			const jobs = await t.run(async (ctx) =>
				(await ctx.db.system.query("_scheduled_functions").collect()).filter((job) =>
					job.name.includes("standDownSupersededIntent")
				)
			);
			expect(jobs).toHaveLength(1);
			expect(jobs[0].args[0]).toEqual({ paymentId });
		});

		it("leaves the draft and its attempt alone when nothing changed", async () => {
			vi.useFakeTimers();
			const { t, authed, sessionId, tacosId, tableOneId, orderId, paymentId } =
				await seedDraftWithPayment({ status: "processing", stripePaymentIntentId: "pi_old" });
			const before = await readDraft(t, orderId);

			const saved = expectOk(
				await authed.mutation(api.orders.saveDraftFromMenu, {
					sessionId,
					tableId: tableOneId,
					items: [{ menuItemId: tacosId, quantity: 1, selectedOptions: [] }],
				})
			);

			expect(saved).toBe(orderId);
			const after = await readDraft(t, orderId);
			expect(after.order.updatedAt).toBe(before.order.updatedAt);
			expect(after.items.map((i) => i._id)).toEqual(before.items.map((i) => i._id));
			const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
			expect(payment!.status).toBe("processing");
		});

		it("refuses while the attempt's create call is still running", async () => {
			const { t, authed, sessionId, tacosId, tableOneId, orderId, paymentId } =
				await seedDraftWithPayment({ status: "pending" });

			const [, error] = await authed.mutation(api.orders.saveDraftFromMenu, {
				sessionId,
				tableId: tableOneId,
				items: [{ menuItemId: tacosId, quantity: 2, selectedOptions: [] }],
			});

			expect(error!.name).toBe(ERROR_NAMES.CONFLICT);
			expect(error!.message).toBe(PAYMENT_SUPERSEDE_ERRORS.IN_PROGRESS);
			const { items } = await readDraft(t, orderId);
			expect(items[0].quantity).toBe(1);
			const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
			expect(payment!.status).toBe("pending");
		});
	});
});
