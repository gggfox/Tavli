/**
 * In-app notifications for restaurant managers (TAVLI-111).
 *
 * What is pinned here is what a manager (or the owner whose bank account it is)
 * would notice being wrong: the fan-out reaches everyone who may read the
 * payments page and nobody else — including the two people who never get a
 * membership row at all, the restaurant's own owner and the organization's owner,
 * and excluding the employee account, the server, the manager of the restaurant
 * down the road, and Tavli's own platform admins. A manager hired afterwards does
 * not inherit last week's bad news, a redelivered Stripe event does not double
 * anybody's bell, the badge counts only what is actually unread, and one
 * recipient cannot read or clear another's inbox.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	NOTIFICATION_BODY_KEY,
	NOTIFICATION_KIND,
	RESTAURANT_MEMBER_ROLE,
	TABLE,
	USER_ROLES,
	type RestaurantMemberRole,
	type UserRole,
} from "../constants";
import { listRestaurantManagerEmails, notifyRestaurantManagers } from "../_util/notifications";
import { NOTIFICATIONS_LIST_LIMIT } from "../notifications";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

type T = ReturnType<typeof convexTest>;

const NOW = Date.now();

/** Clerk subjects used throughout; named for the role they hold. */
const MANAGER_A = "user_manager_a";
const MANAGER_B = "user_manager_b";
const SERVER = "user_server";
const OTHER_MANAGER = "user_manager_other_restaurant";
const ORG_OWNER = "user_org_owner";
const PLATFORM_ADMIN = "user_platform_admin";

type SeededRestaurant = {
	restaurantId: Id<"restaurants">;
	organizationId: Id<"organizations">;
	/** `restaurants.ownerId` — the person who ran Stripe onboarding for it. */
	ownerId: string;
};

/** Owner subject is per-restaurant, so one restaurant's owner is not another's. */
async function seedRestaurant(t: T, slug: string): Promise<SeededRestaurant> {
	const ownerId = `user_owner_of_${slug}`;
	return t.run(async (ctx) => {
		const organizationId = await ctx.db.insert(TABLE.ORGANIZATIONS, {
			name: `${slug} org`,
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const restaurantId = await ctx.db.insert(TABLE.RESTAURANTS, {
			ownerId,
			organizationId,
			name: slug,
			slug,
			currency: "MXN",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		return { restaurantId, organizationId, ownerId };
	});
}

async function seedMember(
	t: T,
	args: {
		restaurantId: Id<"restaurants">;
		organizationId: Id<"organizations">;
		userId?: string;
		employeeAccountId?: Id<"employeeAccounts">;
		role?: RestaurantMemberRole;
		isActive?: boolean;
	}
) {
	await t.run(async (ctx) => {
		await ctx.db.insert(TABLE.RESTAURANT_MEMBERS, {
			userId: args.userId,
			employeeAccountId: args.employeeAccountId,
			restaurantId: args.restaurantId,
			organizationId: args.organizationId,
			role: args.role ?? RESTAURANT_MEMBER_ROLE.MANAGER,
			isActive: args.isActive ?? true,
			createdAt: NOW,
			updatedAt: NOW,
		});
	});
}

/** An `EmployeeAccount`-backed membership: a manager with no Clerk identity. */
async function seedEmployeeAccountManager(t: T, args: SeededRestaurant) {
	const employeeAccountId = await t.run(async (ctx) =>
		ctx.db.insert(TABLE.EMPLOYEE_ACCOUNTS, {
			restaurantId: args.restaurantId,
			organizationId: args.organizationId,
			firstName: "Pina",
			paternalLastname: "Sin",
			maternalLastname: "Clerk",
			pinHash: "hashed",
			pinSetAt: NOW,
			pinResetCount: 0,
			failedPinAttempts: 0,
			createdAt: NOW,
			updatedAt: NOW,
		})
	);
	await seedMember(t, { ...args, employeeAccountId });
	return employeeAccountId;
}

async function seedUserRole(
	t: T,
	args: {
		userId: string;
		roles?: UserRole[];
		organizationId?: Id<"organizations">;
		email?: string;
		language?: "en" | "es";
	}
) {
	await t.run(async (ctx) => {
		await ctx.db.insert(TABLE.USER_ROLES, {
			userId: args.userId,
			email: args.email,
			roles: args.roles ?? [USER_ROLES.MANAGER],
			organizationId: args.organizationId,
			createdAt: NOW,
			updatedAt: NOW,
		});
		if (args.language) {
			await ctx.db.insert(TABLE.USER_SETTINGS, {
				userId: args.userId,
				language: args.language,
			});
		}
	});
}

async function allNotifications(t: T) {
	return t.run(async (ctx) => ctx.db.query(TABLE.NOTIFICATIONS).collect());
}

/**
 * The seed the ticket asks for: two managers with Clerk identities, one
 * employee-account-backed member, one non-manager member, and a manager of a
 * different restaurant — plus the restaurant's own owner, who has no membership
 * row and is a recipient anyway.
 */
async function seedMixedStaff(t: T) {
	const cocina = await seedRestaurant(t, "la-cocina");
	const otra = await seedRestaurant(t, "la-otra");

	await seedMember(t, { ...cocina, userId: MANAGER_A });
	await seedMember(t, { ...cocina, userId: MANAGER_B });
	await seedEmployeeAccountManager(t, cocina);
	await seedMember(t, { ...cocina, userId: SERVER, role: RESTAURANT_MEMBER_ROLE.EMPLOYEE });
	await seedMember(t, { ...otra, userId: OTHER_MANAGER });

	return { cocina, otra };
}

describe("notifyRestaurantManagers", () => {
	it("writes one row per manager-or-above of the restaurant, and nobody else", async () => {
		const t = convexTest(schema, modules);
		const { cocina } = await seedMixedStaff(t);

		const count = await t.run(async (ctx) =>
			notifyRestaurantManagers(ctx, {
				restaurantId: cocina.restaurantId,
				kind: NOTIFICATION_KIND.PAYOUT_FAILED,
				messageParams: { amount: 125000 },
				href: "/admin/payments",
			})
		);

		expect(count).toBe(3);
		const rows = await allNotifications(t);
		expect(rows.map((row) => row.userId).sort()).toEqual(
			[cocina.ownerId, MANAGER_A, MANAGER_B].sort()
		);
		expect(rows[0]).toMatchObject({
			restaurantId: cocina.restaurantId,
			kind: NOTIFICATION_KIND.PAYOUT_FAILED,
			messageKey: NOTIFICATION_BODY_KEY[NOTIFICATION_KIND.PAYOUT_FAILED],
			messageParams: { amount: 125000 },
			href: "/admin/payments",
		});
		// Unread is the absence of `readAt`, not a flag.
		expect(rows.every((row) => row.readAt === undefined)).toBe(true);
	});

	it("reaches the two owners who never get a membership row, and no platform admin", async () => {
		const t = convexTest(schema, modules);
		const cocina = await seedRestaurant(t, "la-cocina");
		// The organization's proprietor: a `userRoles` row, no membership anywhere.
		await seedUserRole(t, {
			userId: ORG_OWNER,
			roles: [USER_ROLES.OWNER],
			organizationId: cocina.organizationId,
		});
		// Tavli's own operator, in the same organization's role table. Hears about
		// this through the operator alert, never through a restaurant's bell.
		await seedUserRole(t, {
			userId: PLATFORM_ADMIN,
			roles: [USER_ROLES.ADMIN],
			organizationId: cocina.organizationId,
		});
		// An owner of a different organization must not be pulled in.
		const otra = await seedRestaurant(t, "la-otra");
		await seedUserRole(t, {
			userId: "user_owner_of_other_org",
			roles: [USER_ROLES.OWNER],
			organizationId: otra.organizationId,
		});

		const count = await t.run(async (ctx) =>
			notifyRestaurantManagers(ctx, {
				restaurantId: cocina.restaurantId,
				kind: NOTIFICATION_KIND.PAYOUT_FAILED,
			})
		);

		expect(count).toBe(2);
		const rows = await allNotifications(t);
		// `restaurants.ownerId` first: it is the account that ran Stripe onboarding.
		expect(rows.map((row) => row.userId)).toEqual([cocina.ownerId, ORG_OWNER]);
	});

	it("counts one person once, however many ways they qualify", async () => {
		const t = convexTest(schema, modules);
		const cocina = await seedRestaurant(t, "la-cocina");
		// The same person is the restaurant's owner, an org owner, and a manager.
		await seedUserRole(t, {
			userId: cocina.ownerId,
			roles: [USER_ROLES.OWNER],
			organizationId: cocina.organizationId,
		});
		await seedMember(t, { ...cocina, userId: cocina.ownerId });

		const count = await t.run(async (ctx) =>
			notifyRestaurantManagers(ctx, {
				restaurantId: cocina.restaurantId,
				kind: NOTIFICATION_KIND.DISPUTE_OPENED,
			})
		);

		expect(count).toBe(1);
		expect((await allNotifications(t)).map((row) => row.userId)).toEqual([cocina.ownerId]);
	});

	it("gives an employee account nothing — it has no Clerk identity to read with", async () => {
		const t = convexTest(schema, modules);
		const cocina = await seedRestaurant(t, "solo-pin");
		await seedEmployeeAccountManager(t, cocina);

		await t.run(async (ctx) =>
			notifyRestaurantManagers(ctx, {
				restaurantId: cocina.restaurantId,
				kind: NOTIFICATION_KIND.DISPUTE_OPENED,
			})
		);

		// Only the owner. The PIN-backed manager is not reachable by definition.
		const rows = await allNotifications(t);
		expect(rows.map((row) => row.userId)).toEqual([cocina.ownerId]);
	});

	it("skips a manager who has been removed from the restaurant", async () => {
		const t = convexTest(schema, modules);
		const cocina = await seedRestaurant(t, "la-cocina");
		await seedMember(t, { ...cocina, userId: MANAGER_A });
		await seedMember(t, { ...cocina, userId: MANAGER_B, isActive: false });

		await t.run(async (ctx) =>
			notifyRestaurantManagers(ctx, {
				restaurantId: cocina.restaurantId,
				kind: NOTIFICATION_KIND.DISPUTE_LOST,
			})
		);

		const rows = await allNotifications(t);
		expect(rows.map((row) => row.userId)).toEqual([cocina.ownerId, MANAGER_A]);
	});

	it("does not hand a manager hired afterwards the earlier notification", async () => {
		const t = convexTest(schema, modules);
		const cocina = await seedRestaurant(t, "la-cocina");
		await seedMember(t, { ...cocina, userId: MANAGER_A });

		await t.run(async (ctx) =>
			notifyRestaurantManagers(ctx, {
				restaurantId: cocina.restaurantId,
				kind: NOTIFICATION_KIND.PAYOUT_FAILED,
			})
		);

		// Hired after the payout failed.
		await seedMember(t, { ...cocina, userId: MANAGER_B });

		const rows = await allNotifications(t);
		expect(rows.map((row) => row.userId)).toEqual([cocina.ownerId, MANAGER_A]);

		const asNewManager = t.withIdentity({ subject: MANAGER_B });
		const [list] = await asNewManager.query(api.notifications.listMine, {});
		expect(list).toEqual([]);
	});

	it("takes an explicit messageKey over the kind's default", async () => {
		const t = convexTest(schema, modules);
		const cocina = await seedRestaurant(t, "la-cocina");

		await t.run(async (ctx) =>
			notifyRestaurantManagers(ctx, {
				restaurantId: cocina.restaurantId,
				kind: NOTIFICATION_KIND.PAYOUTS_RESUMED,
				messageKey: "notifications.kind.payoutsResumed.title",
			})
		);

		const rows = await allNotifications(t);
		expect(rows[0].messageKey).toBe("notifications.kind.payoutsResumed.title");
	});

	it("is reachable from an action through the internal mutation", async () => {
		const t = convexTest(schema, modules);
		const { cocina } = await seedMixedStaff(t);

		const count = await t.mutation(internal.notifications.notifyRestaurantManagersInternal, {
			restaurantId: cocina.restaurantId,
			kind: NOTIFICATION_KIND.DISPUTE_WON,
		});

		expect(count).toBe(3);
	});
});

describe("dedupeKey", () => {
	const PAYOUT_KEY = "payout_failed:po_123";

	async function notifyOnce(t: T, restaurantId: Id<"restaurants">) {
		return t.mutation(internal.notifications.notifyRestaurantManagersInternal, {
			restaurantId,
			kind: NOTIFICATION_KIND.PAYOUT_FAILED,
			dedupeKey: PAYOUT_KEY,
		});
	}

	it("leaves one row per person however often Stripe redelivers the event", async () => {
		const t = convexTest(schema, modules);
		const cocina = await seedRestaurant(t, "la-cocina");
		await seedMember(t, { ...cocina, userId: MANAGER_A });

		expect(await notifyOnce(t, cocina.restaurantId)).toBe(2);
		// Redelivery, and the retry of the redelivery.
		expect(await notifyOnce(t, cocina.restaurantId)).toBe(0);
		expect(await notifyOnce(t, cocina.restaurantId)).toBe(0);

		const rows = await allNotifications(t);
		expect(rows).toHaveLength(2);
		expect(rows.every((row) => row.dedupeKey === PAYOUT_KEY)).toBe(true);
	});

	it("still reaches a manager added between two deliveries", async () => {
		const t = convexTest(schema, modules);
		const cocina = await seedRestaurant(t, "la-cocina");

		expect(await notifyOnce(t, cocina.restaurantId)).toBe(1);
		await seedMember(t, { ...cocina, userId: MANAGER_A });

		// The owner already has it unread; the new manager does not.
		expect(await notifyOnce(t, cocina.restaurantId)).toBe(1);
		expect((await allNotifications(t)).map((row) => row.userId)).toEqual([
			cocina.ownerId,
			MANAGER_A,
		]);
	});

	it("lets the same problem through again once the recipient has read it", async () => {
		const t = convexTest(schema, modules);
		const cocina = await seedRestaurant(t, "la-cocina");
		await notifyOnce(t, cocina.restaurantId);

		const asOwner = t.withIdentity({ subject: cocina.ownerId });
		await asOwner.mutation(api.notifications.markAllRead, {});

		// A genuine recurrence, not a redelivery: they cleared the last one.
		expect(await notifyOnce(t, cocina.restaurantId)).toBe(1);
		expect(await allNotifications(t)).toHaveLength(2);
	});

	it("does not deduplicate across different problems", async () => {
		const t = convexTest(schema, modules);
		const cocina = await seedRestaurant(t, "la-cocina");

		await notifyOnce(t, cocina.restaurantId);
		const other = await t.mutation(internal.notifications.notifyRestaurantManagersInternal, {
			restaurantId: cocina.restaurantId,
			kind: NOTIFICATION_KIND.PAYOUT_FAILED,
			dedupeKey: "payout_failed:po_999",
		});

		expect(other).toBe(1);
		expect(await allNotifications(t)).toHaveLength(2);
	});

	it("without a key, every call is its own notification", async () => {
		const t = convexTest(schema, modules);
		const cocina = await seedRestaurant(t, "la-cocina");

		for (let i = 0; i < 3; i++) {
			await t.mutation(internal.notifications.notifyRestaurantManagersInternal, {
				restaurantId: cocina.restaurantId,
				kind: NOTIFICATION_KIND.DISPUTE_OPENED,
			});
		}

		expect(await allNotifications(t)).toHaveLength(3);
	});
});

describe("listRestaurantManagerEmails", () => {
	it("returns the same recipients as the fan-out, with address and language", async () => {
		const t = convexTest(schema, modules);
		const { cocina } = await seedMixedStaff(t);
		await seedUserRole(t, { userId: cocina.ownerId, email: "owner@cocina.mx" });
		await seedUserRole(t, { userId: MANAGER_A, email: "a@cocina.mx", language: "es" });
		await seedUserRole(t, { userId: MANAGER_B, email: "b@cocina.mx" });
		await seedUserRole(t, { userId: SERVER, email: "server@cocina.mx" });

		const recipients = await t.run(async (ctx) =>
			listRestaurantManagerEmails(ctx, cocina.restaurantId)
		);

		expect(recipients).toEqual([
			{ userId: cocina.ownerId, email: "owner@cocina.mx", locale: "en" },
			{ userId: MANAGER_A, email: "a@cocina.mx", locale: "es" },
			// No userSettings row, so the default locale.
			{ userId: MANAGER_B, email: "b@cocina.mx", locale: "en" },
		]);
	});

	it("drops a recipient with no email rather than failing the caller", async () => {
		const t = convexTest(schema, modules);
		const cocina = await seedRestaurant(t, "la-cocina");
		await seedMember(t, { ...cocina, userId: MANAGER_A });
		await seedMember(t, { ...cocina, userId: MANAGER_B });
		await seedUserRole(t, { userId: MANAGER_A, email: "a@cocina.mx" });
		// The owner and MANAGER_B have no userRoles row at all.

		const recipients = await t.run(async (ctx) =>
			listRestaurantManagerEmails(ctx, cocina.restaurantId)
		);

		expect(recipients.map((r) => r.userId)).toEqual([MANAGER_A]);
	});
});

describe("the bell's own queries", () => {
	async function seedTwoNotifications(t: T) {
		const cocina = await seedRestaurant(t, "la-cocina");
		await seedMember(t, { ...cocina, userId: MANAGER_A });
		await t.run(async (ctx) => {
			await ctx.db.insert(TABLE.NOTIFICATIONS, {
				userId: MANAGER_A,
				restaurantId: cocina.restaurantId,
				kind: NOTIFICATION_KIND.DISPUTE_OPENED,
				messageKey: NOTIFICATION_BODY_KEY[NOTIFICATION_KIND.DISPUTE_OPENED],
				createdAt: NOW - 1000,
			});
			await ctx.db.insert(TABLE.NOTIFICATIONS, {
				userId: MANAGER_A,
				restaurantId: cocina.restaurantId,
				kind: NOTIFICATION_KIND.DISPUTE_LOST,
				messageKey: NOTIFICATION_BODY_KEY[NOTIFICATION_KIND.DISPUTE_LOST],
				href: "/admin/payments",
				createdAt: NOW,
			});
		});
		return cocina;
	}

	it("lists the signed-in user's notifications newest first, with the restaurant's name", async () => {
		const t = convexTest(schema, modules);
		await seedTwoNotifications(t);

		const asManager = t.withIdentity({ subject: MANAGER_A });
		const [rows, error] = await asManager.query(api.notifications.listMine, {});

		expect(error).toBeNull();
		expect(rows?.map((row) => row.kind)).toEqual([
			NOTIFICATION_KIND.DISPUTE_LOST,
			NOTIFICATION_KIND.DISPUTE_OPENED,
		]);
		expect(rows?.[0].restaurantName).toBe("la-cocina");
		expect(rows?.[0].href).toBe("/admin/payments");
	});

	it("caps the list, so a long history cannot grow the bell without bound", async () => {
		const t = convexTest(schema, modules);
		const cocina = await seedRestaurant(t, "la-cocina");
		await t.run(async (ctx) => {
			for (let i = 0; i < NOTIFICATIONS_LIST_LIMIT + 5; i++) {
				await ctx.db.insert(TABLE.NOTIFICATIONS, {
					userId: MANAGER_A,
					restaurantId: cocina.restaurantId,
					kind: NOTIFICATION_KIND.PAYOUT_FAILED,
					messageKey: NOTIFICATION_BODY_KEY[NOTIFICATION_KIND.PAYOUT_FAILED],
					createdAt: NOW + i,
				});
			}
		});

		const asManager = t.withIdentity({ subject: MANAGER_A });
		const [rows] = await asManager.query(api.notifications.listMine, {});

		expect(rows).toHaveLength(NOTIFICATIONS_LIST_LIMIT);
		// Newest-first means the cut falls on the oldest, not the newest.
		expect(rows?.[0].createdAt).toBe(NOW + NOTIFICATIONS_LIST_LIMIT + 4);
	});

	it("counts the unread ones, and stops counting one that has been read", async () => {
		const t = convexTest(schema, modules);
		await seedTwoNotifications(t);
		const asManager = t.withIdentity({ subject: MANAGER_A });

		expect(await asManager.query(api.notifications.unreadCount, {})).toEqual([2, null]);

		const [rows] = await asManager.query(api.notifications.listMine, {});
		const [markedId, markError] = await asManager.mutation(api.notifications.markRead, {
			notificationId: rows![0]._id,
		});

		expect(markError).toBeNull();
		expect(markedId).toBe(rows![0]._id);
		expect(await asManager.query(api.notifications.unreadCount, {})).toEqual([1, null]);
	});

	it("keeps the first readAt when the same item is marked read twice", async () => {
		const t = convexTest(schema, modules);
		await seedTwoNotifications(t);
		const asManager = t.withIdentity({ subject: MANAGER_A });
		const [rows] = await asManager.query(api.notifications.listMine, {});

		await asManager.mutation(api.notifications.markRead, { notificationId: rows![0]._id });
		const firstReadAt = await t.run(async (ctx) => (await ctx.db.get(rows![0]._id))?.readAt);
		await asManager.mutation(api.notifications.markRead, { notificationId: rows![0]._id });

		const secondReadAt = await t.run(async (ctx) => (await ctx.db.get(rows![0]._id))?.readAt);
		expect(secondReadAt).toBe(firstReadAt);
	});

	it("clears the badge with markAllRead, and says how many it cleared", async () => {
		const t = convexTest(schema, modules);
		await seedTwoNotifications(t);
		const asManager = t.withIdentity({ subject: MANAGER_A });

		expect(await asManager.mutation(api.notifications.markAllRead, {})).toEqual([2, null]);
		expect(await asManager.query(api.notifications.unreadCount, {})).toEqual([0, null]);
		// Nothing left to clear: a second call is a no-op, not a second sweep.
		expect(await asManager.mutation(api.notifications.markAllRead, {})).toEqual([0, null]);
	});

	it("never shows or clears another user's notifications", async () => {
		const t = convexTest(schema, modules);
		await seedTwoNotifications(t);
		const asManager = t.withIdentity({ subject: MANAGER_A });
		const asColleague = t.withIdentity({ subject: MANAGER_B });
		const [rows] = await asManager.query(api.notifications.listMine, {});

		// Not merely filtered out of the list — invisible, and uncountable.
		expect(await asColleague.query(api.notifications.listMine, {})).toEqual([[], null]);
		expect(await asColleague.query(api.notifications.unreadCount, {})).toEqual([0, null]);

		// A known-good id from somebody else's inbox reads as not found, not as
		// forbidden: an inbox must not be enumerable.
		const [marked, error] = await asColleague.mutation(api.notifications.markRead, {
			notificationId: rows![0]._id,
		});
		expect(marked).toBeNull();
		expect(error?.message).toBe("ERROR_NOTIFICATION_NOT_FOUND");

		// And the sweep does not reach across either.
		expect(await asColleague.mutation(api.notifications.markAllRead, {})).toEqual([0, null]);
		expect(await asManager.query(api.notifications.unreadCount, {})).toEqual([2, null]);
	});

	it("refuses every function to a caller with no identity", async () => {
		const t = convexTest(schema, modules);
		await seedTwoNotifications(t);

		const [list, listError] = await t.query(api.notifications.listMine, {});
		expect(list).toBeNull();
		expect(listError?.name).toBe("NOT_AUTHENTICATED");

		const [count, countError] = await t.query(api.notifications.unreadCount, {});
		expect(count).toBeNull();
		expect(countError?.name).toBe("NOT_AUTHENTICATED");

		const [swept, sweepError] = await t.mutation(api.notifications.markAllRead, {});
		expect(swept).toBeNull();
		expect(sweepError?.name).toBe("NOT_AUTHENTICATED");
	});
});
