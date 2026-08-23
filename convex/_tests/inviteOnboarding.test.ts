/**
 * Admin cross-org onboarding: single invite, CSV preview, bulk commit.
 *
 * The through-line of these tests is that NOTHING trusts the client. The
 * preview is advisory; every row is re-classified at commit time against live
 * data, and the destructive case (`cross_org`, which would re-point an existing
 * user's organization on accept) stays blocked until it is acknowledged.
 */

import { Blob as NodeBlob } from "node:buffer";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	AUDIT_EVENT,
	INVITATION_STATUS,
	INVITE_BULK_COMMIT_MAX_ROWS,
	INVITE_SEND_RATE_LIMIT,
	INVITE_TARGET_EMAIL_RATE_LIMIT,
	RESTAURANT_MEMBER_ROLE,
	TABLE,
	USER_ROLES,
} from "../constants";
import { ERROR_INVITE_BULK_TOO_MANY_ROWS } from "../inviteOnboarding";
import { INVITE_CSV_ERROR, INVITE_ROW_STATUS } from "../inviteOnboardingHelpers";
import { INVITE_RATE_LIMIT_ERROR } from "../inviteRateLimit";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

type T = ReturnType<typeof convexTest>;

async function seedOrg(
	t: T,
	args: { name: string; restaurants: string[] }
): Promise<{ orgId: Id<"organizations">; restaurantIds: Id<"restaurants">[] }> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const orgId = await ctx.db.insert(TABLE.ORGANIZATIONS, {
			name: args.name,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantIds: Id<"restaurants">[] = [];
		for (const name of args.restaurants) {
			const restaurantId = await ctx.db.insert(TABLE.RESTAURANTS, {
				ownerId: "seed-owner",
				organizationId: orgId,
				name,
				slug: `${args.name}-${name}`.toLowerCase().replace(/\s+/g, "-"),
				currency: "MXN",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			});
			await insertMenuForRestaurant(ctx, { restaurantId, name, userId: "seed-owner" });
			restaurantIds.push(restaurantId);
		}
		return { orgId, restaurantIds };
	});
}

async function seedUserRole(
	t: T,
	args: {
		userId: string;
		roles: string[];
		organizationId?: Id<"organizations">;
		email?: string;
	}
): Promise<void> {
	await t.run(async (ctx) => {
		const now = Date.now();
		await ctx.db.insert(TABLE.USER_ROLES, {
			userId: args.userId,
			roles: args.roles as Array<"admin" | "owner" | "manager" | "customer" | "employee">,
			...(args.organizationId !== undefined && { organizationId: args.organizationId }),
			...(args.email !== undefined && { email: args.email }),
			createdAt: now,
			updatedAt: now,
		});
	});
}

async function seedAdmin(t: T): Promise<void> {
	await seedUserRole(t, { userId: "admin1", roles: [USER_ROLES.ADMIN] });
}

function asAdmin(t: T) {
	return t.withIdentity({ subject: "admin1" });
}

/**
 * First field-level message off a returned error object. The mutations return a
 * union of error shapes and only `UserInputValidationErrorObject` carries
 * `fields`, so narrowing at every call site would drown the assertions.
 */
function fieldError(error: unknown): string | undefined {
	return (error as { fields?: { field: string; message: string }[] } | null | undefined)
		?.fields?.[0]?.message;
}

async function countInvitations(t: T): Promise<number> {
	return await t.run(async (ctx) => (await ctx.db.query(TABLE.INVITATIONS).collect()).length);
}

async function drainScheduler(t: T): Promise<void> {
	await t.finishAllScheduledFunctions(() => {
		vi.runAllTimers();
	});
}

describe("inviteOnboarding — authorization", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("rejects every new endpoint for non-admins and the unauthenticated", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantIds } = await seedOrg(t, { name: "Acme", restaurants: ["Centro"] });

		await seedUserRole(t, { userId: "owner1", roles: [USER_ROLES.OWNER], organizationId: orgId });
		await seedUserRole(t, {
			userId: "manager1",
			roles: [USER_ROLES.MANAGER],
			organizationId: orgId,
		});
		await seedUserRole(t, {
			userId: "employee1",
			roles: [USER_ROLES.EMPLOYEE],
			organizationId: orgId,
		});

		const callers = [
			t.withIdentity({ subject: "owner1" }),
			t.withIdentity({ subject: "manager1" }),
			t.withIdentity({ subject: "employee1" }),
		];

		for (const caller of callers) {
			const [url, urlErr] = await caller.mutation(api.inviteOnboarding.generateInviteUploadUrl, {});
			expect(url).toBeNull();
			expect(urlErr?.name).toBe("NOT_AUTHORIZED");

			const [single, singleErr] = await caller.mutation(
				api.inviteOnboarding.createAdminInvitation,
				{
					organizationId: orgId,
					email: "target@example.com",
					role: RESTAURANT_MEMBER_ROLE.MANAGER,
					restaurantIds,
				}
			);
			expect(single).toBeNull();
			expect(singleErr?.name).toBe("NOT_AUTHORIZED");

			const [bulk, bulkErr] = await caller.mutation(api.inviteOnboarding.commitBulkInvitations, {
				rows: [
					{
						rowNumber: 1,
						email: "target@example.com",
						role: RESTAURANT_MEMBER_ROLE.MANAGER,
						organizationId: orgId,
						restaurantIds,
					},
				],
			});
			expect(bulk).toBeNull();
			expect(bulkErr?.name).toBe("NOT_AUTHORIZED");
		}

		// Unauthenticated is rejected before any role lookup happens.
		const [, anonErr] = await t.mutation(api.inviteOnboarding.generateInviteUploadUrl, {});
		expect(anonErr?.name).toBe("NOT_AUTHENTICATED");

		expect(await countInvitations(t)).toBe(0);
	});

	it("gates the CSV preview query on admin even when reached internally", async () => {
		const t = convexTest(schema, modules);
		const { orgId } = await seedOrg(t, { name: "Acme", restaurants: ["Centro"] });
		await seedUserRole(t, { userId: "owner1", roles: [USER_ROLES.OWNER], organizationId: orgId });

		const [preview, err] = await t.query(internal.inviteOnboarding.previewInviteRowsInternal, {
			userId: "owner1",
			rows: [
				{
					rowNumber: 1,
					email: "a@example.com",
					role: USER_ROLES.OWNER,
					organization: "Acme",
					restaurants: [],
				},
			],
		});
		expect(preview).toBeNull();
		expect(err?.name).toBe("NOT_AUTHORIZED");
	});

	it("lets an admin mint an upload URL", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const [url, err] = await asAdmin(t).mutation(api.inviteOnboarding.generateInviteUploadUrl, {});
		expect(err).toBeNull();
		expect(typeof url).toBe("string");
	});
});

describe("createAdminInvitation", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("invites an owner into an organization the admin does not belong to", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const { orgId } = await seedOrg(t, { name: "Acme", restaurants: ["Centro"] });

		const [result, err] = await asAdmin(t).mutation(api.inviteOnboarding.createAdminInvitation, {
			organizationId: orgId,
			email: "  New.Owner@Example.COM ",
			role: USER_ROLES.OWNER,
			restaurantIds: [],
			firstName: "Ana",
		});

		expect(err).toBeNull();
		expect(result?.status).toBe(INVITE_ROW_STATUS.OK);

		const invitation = await t.run(async (ctx) =>
			ctx.db.get(result?.invitationId as Id<"invitations">)
		);
		expect(invitation?.email).toBe("new.owner@example.com");
		expect(invitation?.organizationId).toBe(orgId);
		expect(invitation?.restaurantIds).toEqual([]);
		expect(invitation?.status).toBe(INVITATION_STATUS.PENDING);
		expect(invitation?.firstName).toBe("Ana");
		await drainScheduler(t);
	});

	it("refuses a manager with no restaurants and one from another organization", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const { orgId } = await seedOrg(t, { name: "Acme", restaurants: ["Centro"] });
		const other = await seedOrg(t, { name: "Rival", restaurants: ["Norte"] });

		const [none, noneErr] = await asAdmin(t).mutation(api.inviteOnboarding.createAdminInvitation, {
			organizationId: orgId,
			email: "mgr@example.com",
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
			restaurantIds: [],
		});
		expect(none).toBeNull();
		expect(fieldError(noneErr)).toBe("ERROR_INVITE_INVALID_RESTAURANTS_REQUIRED");

		const [foreign, foreignErr] = await asAdmin(t).mutation(
			api.inviteOnboarding.createAdminInvitation,
			{
				organizationId: orgId,
				email: "mgr@example.com",
				role: RESTAURANT_MEMBER_ROLE.MANAGER,
				restaurantIds: other.restaurantIds,
			}
		);
		expect(foreign).toBeNull();
		expect(fieldError(foreignErr)).toBe("ERROR_INVITE_INVALID_RESTAURANT_OTHER_ORG");

		expect(await countInvitations(t)).toBe(0);
	});

	it("blocks a cross-org invite until the move is acknowledged", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const acme = await seedOrg(t, { name: "Acme", restaurants: ["Centro"] });
		const rival = await seedOrg(t, { name: "Rival", restaurants: ["Norte"] });

		// This person already belongs to Rival; accepting an Acme invite would
		// silently re-point their `userRoles.organizationId`.
		await seedUserRole(t, {
			userId: "clerk_existing",
			roles: [USER_ROLES.MANAGER],
			organizationId: rival.orgId,
			email: "moving@example.com",
		});

		const [blocked, blockedErr] = await asAdmin(t).mutation(
			api.inviteOnboarding.createAdminInvitation,
			{
				organizationId: acme.orgId,
				email: "Moving@Example.com",
				role: RESTAURANT_MEMBER_ROLE.MANAGER,
				restaurantIds: acme.restaurantIds,
			}
		);
		expect(blocked).toBeNull();
		expect(fieldError(blockedErr)).toBe("ERROR_INVITE_CROSS_ORG");
		expect(await countInvitations(t)).toBe(0);

		const [allowed, allowedErr] = await asAdmin(t).mutation(
			api.inviteOnboarding.createAdminInvitation,
			{
				organizationId: acme.orgId,
				email: "Moving@Example.com",
				role: RESTAURANT_MEMBER_ROLE.MANAGER,
				restaurantIds: acme.restaurantIds,
				acknowledgeOrgMove: true,
			}
		);
		expect(allowedErr).toBeNull();
		expect(allowed?.status).toBe(INVITE_ROW_STATUS.CROSS_ORG);
		expect(await countInvitations(t)).toBe(1);
		await drainScheduler(t);
	});

	it("treats an existing role in the SAME org as already_member and still sends", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const acme = await seedOrg(t, { name: "Acme", restaurants: ["Centro"] });
		await seedUserRole(t, {
			userId: "clerk_existing",
			roles: [USER_ROLES.EMPLOYEE],
			organizationId: acme.orgId,
			email: "already@example.com",
		});

		const [result, err] = await asAdmin(t).mutation(api.inviteOnboarding.createAdminInvitation, {
			organizationId: acme.orgId,
			email: "already@example.com",
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
			restaurantIds: acme.restaurantIds,
		});
		expect(err).toBeNull();
		expect(result?.status).toBe(INVITE_ROW_STATUS.ALREADY_MEMBER);
		await drainScheduler(t);
	});

	it("refuses a duplicate pending invite, then replaces it on request", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const acme = await seedOrg(t, { name: "Acme", restaurants: ["Centro"] });

		const [first] = await asAdmin(t).mutation(api.inviteOnboarding.createAdminInvitation, {
			organizationId: acme.orgId,
			email: "dup@example.com",
			role: USER_ROLES.OWNER,
			restaurantIds: [],
		});

		const [blocked, blockedErr] = await asAdmin(t).mutation(
			api.inviteOnboarding.createAdminInvitation,
			{
				organizationId: acme.orgId,
				email: "dup@example.com",
				role: USER_ROLES.OWNER,
				restaurantIds: [],
			}
		);
		expect(blocked).toBeNull();
		expect(fieldError(blockedErr)).toBe("ERROR_INVITE_DUPLICATE_PENDING");
		expect(await countInvitations(t)).toBe(1);

		const [replaced, replacedErr] = await asAdmin(t).mutation(
			api.inviteOnboarding.createAdminInvitation,
			{
				organizationId: acme.orgId,
				email: "dup@example.com",
				role: USER_ROLES.OWNER,
				restaurantIds: [],
				replaceExistingPending: true,
			}
		);
		expect(replacedErr).toBeNull();
		expect(replaced?.replacedPendingCount).toBe(1);

		// Exactly one live token per (email, org): the superseded one is revoked.
		const rows = await t.run(async (ctx) => ctx.db.query(TABLE.INVITATIONS).collect());
		expect(rows).toHaveLength(2);
		const old = rows.find((r) => r._id === first?.invitationId);
		expect(old?.status).toBe(INVITATION_STATUS.REVOKED);
		expect(rows.filter((r) => r.status === INVITATION_STATUS.PENDING)).toHaveLength(1);
		await drainScheduler(t);
	});

	it("does not treat an expired or revoked prior invitation as a duplicate", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const acme = await seedOrg(t, { name: "Acme", restaurants: ["Centro"] });

		await t.run(async (ctx) => {
			const now = Date.now();
			for (const [token, status, expiresAt] of [
				["expired-token", INVITATION_STATUS.PENDING, now - 1000],
				["revoked-token", INVITATION_STATUS.REVOKED, now + 100000],
			] as const) {
				await ctx.db.insert(TABLE.INVITATIONS, {
					token,
					email: "stale@example.com",
					organizationId: acme.orgId,
					role: USER_ROLES.OWNER,
					restaurantIds: [],
					invitedBy: "admin1",
					status,
					expiresAt,
					createdAt: now,
					updatedAt: now,
				});
			}
		});

		const [result, err] = await asAdmin(t).mutation(api.inviteOnboarding.createAdminInvitation, {
			organizationId: acme.orgId,
			email: "stale@example.com",
			role: USER_ROLES.OWNER,
			restaurantIds: [],
		});
		expect(err).toBeNull();
		expect(result?.status).toBe(INVITE_ROW_STATUS.OK);
		await drainScheduler(t);
	});
});

describe("CSV preview", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	async function storeCsv(t: T, csv: string): Promise<Id<"_storage">> {
		return await t.run(async (ctx) => ctx.storage.store(new NodeBlob([csv]) as Blob));
	}

	it("classifies every row of an uploaded file without creating anything", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const acme = await seedOrg(t, { name: "Acme", restaurants: ["Centro", "Sur"] });
		const rival = await seedOrg(t, { name: "Rival", restaurants: ["Norte"] });

		await seedUserRole(t, {
			userId: "clerk_rival",
			roles: [USER_ROLES.MANAGER],
			organizationId: rival.orgId,
			email: "moving@example.com",
		});
		await seedUserRole(t, {
			userId: "clerk_acme",
			roles: [USER_ROLES.EMPLOYEE],
			organizationId: acme.orgId,
			email: "already@example.com",
		});
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert(TABLE.INVITATIONS, {
				token: "pending-token",
				email: "pending@example.com",
				organizationId: acme.orgId,
				role: USER_ROLES.OWNER,
				restaurantIds: [],
				invitedBy: "admin1",
				status: INVITATION_STATUS.PENDING,
				expiresAt: now + 100000,
				createdAt: now,
				updatedAt: now,
			});
		});

		const csv = [
			"Email,Role,Organization,Restaurants",
			"good@example.com,manager,Acme,Centro; Sur",
			"moving@example.com,manager,Acme,Centro",
			"already@example.com,owner,Acme,",
			"pending@example.com,owner,Acme,",
			"good@example.com,employee,Acme,Sur",
			"broken-email,owner,Acme,",
			"role@example.com,chef,Acme,",
			"org@example.com,owner,Nonexistent,",
			"rest@example.com,manager,Acme,Ghost Location",
			"norest@example.com,manager,Acme,",
		].join("\r\n");

		const storageId = await storeCsv(t, csv);
		const [preview, err] = await asAdmin(t).action(api.inviteOnboardingActions.previewInviteCsv, {
			storageId,
		});

		expect(err).toBeNull();
		const statuses = preview?.rows.map((r) => r.status);
		expect(statuses).toEqual([
			INVITE_ROW_STATUS.OK,
			INVITE_ROW_STATUS.CROSS_ORG,
			INVITE_ROW_STATUS.ALREADY_MEMBER,
			INVITE_ROW_STATUS.DUPLICATE_PENDING,
			INVITE_ROW_STATUS.DUPLICATE_IN_FILE,
			INVITE_ROW_STATUS.INVALID_EMAIL,
			INVITE_ROW_STATUS.INVALID_ROLE,
			INVITE_ROW_STATUS.INVALID_ORGANIZATION,
			INVITE_ROW_STATUS.INVALID_RESTAURANT_UNKNOWN,
			INVITE_ROW_STATUS.INVALID_RESTAURANTS_REQUIRED,
		]);

		// Names resolved to ids, and the org name echoed back for the preview table.
		expect(preview?.rows[0].restaurantIds).toEqual([
			String(acme.restaurantIds[0]),
			String(acme.restaurantIds[1]),
		]);
		expect(preview?.rows[0].organizationName).toBe("Acme");
		expect(preview?.rows[0].restaurantNames).toEqual(["Centro", "Sur"]);
		expect(preview?.rows[1].override).toBe("acknowledgeOrgMove");
		expect(preview?.rows[5].errorCode).toBe("ERROR_INVITE_INVALID_EMAIL");

		expect(preview?.counts).toMatchObject({
			total: 10,
			ok: 1,
			alreadyMember: 1,
			crossOrg: 1,
			duplicatePending: 1,
			duplicateInFile: 1,
			invalid: 5,
		});

		expect(await countInvitations(t)).toBe(1); // only the seeded pending one
		expect(rival.restaurantIds).toHaveLength(1);
	});

	/**
	 * Id resolution is exercised through the classification query rather than a
	 * CSV: `convex-test`'s fake document ids embed a `;` (`<id>;<table>`), which
	 * the restaurants column treats as its list separator. Real Convex ids are
	 * alphanumeric, so this is a harness artifact — but it means the CSV path can
	 * only be tested with names.
	 */
	it("resolves ids, flags another tenant's restaurant, and refuses an ambiguous name", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const acme = await seedOrg(t, { name: "Acme", restaurants: ["Centro", "Twin", "Twin"] });
		const rival = await seedOrg(t, { name: "Rival", restaurants: ["Norte"] });

		const [preview, err] = await t.query(internal.inviteOnboarding.previewInviteRowsInternal, {
			userId: "admin1",
			rows: [
				{
					rowNumber: 1,
					email: "byid@example.com",
					role: RESTAURANT_MEMBER_ROLE.MANAGER,
					organization: String(acme.orgId),
					restaurants: [String(acme.restaurantIds[0])],
				},
				{
					rowNumber: 2,
					email: "foreign@example.com",
					role: RESTAURANT_MEMBER_ROLE.MANAGER,
					organization: "Acme",
					restaurants: [String(rival.restaurantIds[0])],
				},
				{
					rowNumber: 3,
					email: "ambiguous@example.com",
					role: RESTAURANT_MEMBER_ROLE.MANAGER,
					organization: "Acme",
					restaurants: ["Twin"],
				},
			],
		});

		expect(err).toBeNull();
		expect(preview?.rows.map((r) => r.status)).toEqual([
			INVITE_ROW_STATUS.OK,
			INVITE_ROW_STATUS.INVALID_RESTAURANT_OTHER_ORG,
			INVITE_ROW_STATUS.INVALID_RESTAURANT_AMBIGUOUS,
		]);
		expect(preview?.rows[0].organizationId).toBe(String(acme.orgId));
		expect(preview?.rows[0].restaurantIds).toEqual([String(acme.restaurantIds[0])]);
	});

	it("calls two organizations sharing a name ambiguous rather than guessing", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		await seedOrg(t, { name: "Twin", restaurants: [] });
		await seedOrg(t, { name: "Twin", restaurants: [] });

		const [preview] = await asAdmin(t).action(api.inviteOnboardingActions.previewInviteCsv, {
			storageId: await storeCsv(t, "email,role,organization\na@example.com,owner,Twin"),
		});
		expect(preview?.rows[0].status).toBe(INVITE_ROW_STATUS.INVALID_ORGANIZATION_AMBIGUOUS);
	});

	it("surfaces file-level parse failures as stable codes", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		await seedOrg(t, { name: "Acme", restaurants: [] });

		const [rows, err] = await asAdmin(t).action(api.inviteOnboardingActions.previewInviteCsv, {
			storageId: await storeCsv(t, "email,role,organization,salary\na@b.com,owner,Acme,10"),
		});
		expect(rows).toBeNull();
		expect(fieldError(err)).toContain(INVITE_CSV_ERROR.UNKNOWN_COLUMN);
	});

	it("rejects a file over the byte cap without parsing it", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		// One long line: cheap to build, and over the 512 KB cap.
		const oversized = `email,role,organization\n${"x".repeat(600 * 1024)},owner,Acme`;

		const [rows, err] = await asAdmin(t).action(api.inviteOnboardingActions.previewInviteCsv, {
			storageId: await storeCsv(t, oversized),
		});
		expect(rows).toBeNull();
		expect(fieldError(err)).toContain(INVITE_CSV_ERROR.TOO_LARGE);
	});

	it("refuses a non-admin before reading the uploaded blob", async () => {
		const t = convexTest(schema, modules);
		const { orgId } = await seedOrg(t, { name: "Acme", restaurants: [] });
		await seedUserRole(t, { userId: "owner1", roles: [USER_ROLES.OWNER], organizationId: orgId });

		const storageId = await storeCsv(t, "email,role,organization\na@b.com,owner,Acme");
		const [rows, err] = await t
			.withIdentity({ subject: "owner1" })
			.action(api.inviteOnboardingActions.previewInviteCsv, { storageId });

		expect(rows).toBeNull();
		expect(err?.name).toBe("NOT_AUTHORIZED");
		// The file is still there — a rejected caller does not get it deleted either.
		expect(await t.run(async (ctx) => ctx.storage.getUrl(storageId))).not.toBeNull();
	});

	it("deletes the uploaded blob once it has been parsed", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		await seedOrg(t, { name: "Acme", restaurants: [] });

		const storageId = await storeCsv(t, "email,role,organization\na@b.com,owner,Acme");
		await asAdmin(t).action(api.inviteOnboardingActions.previewInviteCsv, { storageId });

		expect(await t.run(async (ctx) => ctx.storage.getUrl(storageId))).toBeNull();
	});
});

describe("commitBulkInvitations", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("creates confirmed rows and reports each outcome", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const acme = await seedOrg(t, { name: "Acme", restaurants: ["Centro"] });
		const rival = await seedOrg(t, { name: "Rival", restaurants: ["Norte"] });
		await seedUserRole(t, {
			userId: "clerk_rival",
			roles: [USER_ROLES.MANAGER],
			organizationId: rival.orgId,
			email: "moving@example.com",
		});

		const [result, err] = await asAdmin(t).mutation(api.inviteOnboarding.commitBulkInvitations, {
			rows: [
				{
					rowNumber: 1,
					email: "good@example.com",
					role: RESTAURANT_MEMBER_ROLE.MANAGER,
					organizationId: acme.orgId,
					restaurantIds: acme.restaurantIds,
				},
				{
					rowNumber: 2,
					email: "moving@example.com",
					role: RESTAURANT_MEMBER_ROLE.MANAGER,
					organizationId: acme.orgId,
					restaurantIds: acme.restaurantIds,
				},
				{
					rowNumber: 3,
					email: "acknowledged@example.com",
					role: USER_ROLES.OWNER,
					organizationId: acme.orgId,
					restaurantIds: [],
					acknowledgeOrgMove: true,
				},
			],
		});

		expect(err).toBeNull();
		expect(result?.counts).toMatchObject({ requested: 3, created: 2, skipped: 1, failed: 0 });
		expect(result?.results[1]).toMatchObject({
			rowNumber: 2,
			outcome: "skipped",
			status: INVITE_ROW_STATUS.CROSS_ORG,
			code: "ERROR_INVITE_CROSS_ORG",
			invitationId: null,
		});
		expect(await countInvitations(t)).toBe(2);
		await drainScheduler(t);
	});

	it("re-validates against live data, not the preview verdict", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const acme = await seedOrg(t, { name: "Acme", restaurants: ["Centro", "Sur"] });
		const rival = await seedOrg(t, { name: "Rival", restaurants: ["Norte"] });

		// Everything below was `ok` at preview time and is no longer true:
		//  - the organization was deleted;
		//  - the restaurant was moved to another tenant;
		//  - a competing invitation appeared.
		const doomedOrg = await seedOrg(t, { name: "Doomed", restaurants: [] });
		await t.run(async (ctx) => {
			await ctx.db.delete(doomedOrg.orgId);
			await ctx.db.patch(acme.restaurantIds[1], { organizationId: rival.orgId });
			const now = Date.now();
			await ctx.db.insert(TABLE.INVITATIONS, {
				token: "race-token",
				email: "raced@example.com",
				organizationId: acme.orgId,
				role: USER_ROLES.OWNER,
				restaurantIds: [],
				invitedBy: "someone-else",
				status: INVITATION_STATUS.PENDING,
				expiresAt: now + 100000,
				createdAt: now,
				updatedAt: now,
			});
		});

		const [result, err] = await asAdmin(t).mutation(api.inviteOnboarding.commitBulkInvitations, {
			rows: [
				{
					rowNumber: 1,
					email: "orphan@example.com",
					role: USER_ROLES.OWNER,
					organizationId: doomedOrg.orgId,
					restaurantIds: [],
				},
				{
					rowNumber: 2,
					email: "moved@example.com",
					role: RESTAURANT_MEMBER_ROLE.MANAGER,
					organizationId: acme.orgId,
					restaurantIds: [acme.restaurantIds[1]],
				},
				{
					rowNumber: 3,
					email: "raced@example.com",
					role: USER_ROLES.OWNER,
					organizationId: acme.orgId,
					restaurantIds: [],
				},
			],
		});

		expect(err).toBeNull();
		expect(result?.results.map((r) => r.status)).toEqual([
			INVITE_ROW_STATUS.INVALID_ORGANIZATION,
			INVITE_ROW_STATUS.INVALID_RESTAURANT_OTHER_ORG,
			INVITE_ROW_STATUS.DUPLICATE_PENDING,
		]);
		expect(result?.counts).toMatchObject({ created: 0, failed: 2, skipped: 1 });
		expect(await countInvitations(t)).toBe(1); // still just the racing one
	});

	it("catches a duplicate created earlier in the same chunk", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const acme = await seedOrg(t, { name: "Acme", restaurants: [] });

		const row = {
			email: "twice@example.com",
			role: USER_ROLES.OWNER,
			organizationId: acme.orgId,
			restaurantIds: [] as Id<"restaurants">[],
		};

		const [result] = await asAdmin(t).mutation(api.inviteOnboarding.commitBulkInvitations, {
			rows: [
				{ rowNumber: 1, ...row },
				{ rowNumber: 2, ...row },
			],
		});

		expect(result?.results[0].outcome).toBe("created");
		expect(result?.results[1]).toMatchObject({
			outcome: "failed",
			status: INVITE_ROW_STATUS.DUPLICATE_IN_FILE,
		});
		expect(await countInvitations(t)).toBe(1);
		await drainScheduler(t);
	});

	it("caps the chunk size with a stable code", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const acme = await seedOrg(t, { name: "Acme", restaurants: [] });

		const rows = Array.from({ length: INVITE_BULK_COMMIT_MAX_ROWS + 1 }, (_, i) => ({
			rowNumber: i + 1,
			email: `u${i}@example.com`,
			role: USER_ROLES.OWNER,
			organizationId: acme.orgId,
			restaurantIds: [],
		}));

		const [result, err] = await asAdmin(t).mutation(api.inviteOnboarding.commitBulkInvitations, {
			rows,
		});
		expect(result).toBeNull();
		expect(fieldError(err)).toBe(ERROR_INVITE_BULK_TOO_MANY_ROWS);
		expect(await countInvitations(t)).toBe(0);
	});

	it("audits the run with counts only — never the recipient list", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const acme = await seedOrg(t, { name: "Acme", restaurants: [] });

		const [result] = await asAdmin(t).mutation(api.inviteOnboarding.commitBulkInvitations, {
			rows: [
				{
					rowNumber: 1,
					email: "bulk@example.com",
					role: USER_ROLES.OWNER,
					organizationId: acme.orgId,
					restaurantIds: [],
				},
			],
			bulkImportId: "run-1",
		});

		const events = await t.run(async (ctx) => ctx.db.query(TABLE.ALL_EVENTS).collect());
		const bulk = events.find((e) => e.eventType === AUDIT_EVENT.INVITATION_BULK_IMPORTED);
		expect(bulk?.aggregateId).toBe("bulk:run-1");
		expect(bulk?.userId).toBe("admin1");
		expect(bulk?.payload).toMatchObject({
			bulkImportId: "run-1",
			requested: 1,
			created: 1,
			organizationIds: [String(acme.orgId)],
		});
		expect(JSON.stringify(bulk?.payload)).not.toContain("bulk@example.com");

		// The per-invitation event still records the recipient, as it always did.
		const created = events.find((e) => e.eventType === AUDIT_EVENT.INVITATION_CREATED);
		expect(created?.payload).toMatchObject({ email: "bulk@example.com" });
		expect(result?.counts.created).toBe(1);
		await drainScheduler(t);
	});
});

describe("invitation rate limits", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("stops one address being mailed past the per-target cap", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const acme = await seedOrg(t, { name: "Acme", restaurants: [] });

		// Each send replaces the previous pending invite, so the only thing that
		// can stop the loop is the budget.
		let lastError: { name: string; message: string } | null = null;
		for (let i = 0; i < INVITE_TARGET_EMAIL_RATE_LIMIT.max + 1; i++) {
			const [, err] = await asAdmin(t).mutation(api.inviteOnboarding.createAdminInvitation, {
				organizationId: acme.orgId,
				email: "spammed@example.com",
				role: USER_ROLES.OWNER,
				restaurantIds: [],
				replaceExistingPending: true,
			});
			lastError = err ?? null;
		}

		expect(lastError?.name).toBe("RATE_LIMITED");
		expect(lastError?.message).toBe(INVITE_RATE_LIMIT_ERROR.TARGET_EMAIL);
		await drainScheduler(t);
	});

	it("reports a rate-limited bulk row as failed and keeps going", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const acme = await seedOrg(t, { name: "Acme", restaurants: [] });

		// Exhaust the target budget for one address only.
		await t.run(async (ctx) => {
			await ctx.db.insert(TABLE.RATE_LIMITS, {
				key: "invite_target:blocked@example.com",
				windowStart: Date.now(),
				count: INVITE_TARGET_EMAIL_RATE_LIMIT.max,
				updatedAt: Date.now(),
			});
		});

		const [result] = await asAdmin(t).mutation(api.inviteOnboarding.commitBulkInvitations, {
			rows: [
				{
					rowNumber: 1,
					email: "blocked@example.com",
					role: USER_ROLES.OWNER,
					organizationId: acme.orgId,
					restaurantIds: [],
				},
				{
					rowNumber: 2,
					email: "fine@example.com",
					role: USER_ROLES.OWNER,
					organizationId: acme.orgId,
					restaurantIds: [],
				},
			],
		});

		expect(result?.results[0]).toMatchObject({
			outcome: "failed",
			code: INVITE_RATE_LIMIT_ERROR.TARGET_EMAIL,
		});
		expect(result?.results[1].outcome).toBe("created");
		expect(await countInvitations(t)).toBe(1);
		await drainScheduler(t);
	});

	it("caps a single inviter across different recipients", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const acme = await seedOrg(t, { name: "Acme", restaurants: [] });

		await t.run(async (ctx) => {
			await ctx.db.insert(TABLE.RATE_LIMITS, {
				key: "invite_send:admin1",
				windowStart: Date.now(),
				count: INVITE_SEND_RATE_LIMIT.max,
				updatedAt: Date.now(),
			});
		});

		const [id, err] = await asAdmin(t).mutation(api.inviteOnboarding.createAdminInvitation, {
			organizationId: acme.orgId,
			email: "anyone@example.com",
			role: USER_ROLES.OWNER,
			restaurantIds: [],
		});
		expect(id).toBeNull();
		expect(err?.name).toBe("RATE_LIMITED");
		expect(err?.message).toBe(INVITE_RATE_LIMIT_ERROR.INVITER);
	});

	it("applies to the team tab's org-scoped createInvitation too", async () => {
		const t = convexTest(schema, modules);
		const acme = await seedOrg(t, { name: "Acme", restaurants: ["Centro"] });
		await seedUserRole(t, {
			userId: "owner1",
			roles: [USER_ROLES.OWNER],
			organizationId: acme.orgId,
		});

		await t.run(async (ctx) => {
			await ctx.db.insert(TABLE.RATE_LIMITS, {
				key: "invite_send:owner1",
				windowStart: Date.now(),
				count: INVITE_SEND_RATE_LIMIT.max,
				updatedAt: Date.now(),
			});
		});

		const [id, err] = await t
			.withIdentity({ subject: "owner1" })
			.mutation(api.invites.createInvitation, {
				organizationId: acme.orgId,
				email: "mgr@example.com",
				role: RESTAURANT_MEMBER_ROLE.MANAGER,
				restaurantIds: acme.restaurantIds,
			});
		expect(id).toBeNull();
		expect(err?.name).toBe("RATE_LIMITED");
	});
});

describe("invitation audit lifecycle", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("emits a revoked event, which the lifecycle previously skipped", async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const acme = await seedOrg(t, { name: "Acme", restaurants: [] });

		const [created] = await asAdmin(t).mutation(api.inviteOnboarding.createAdminInvitation, {
			organizationId: acme.orgId,
			email: "revoke-me@example.com",
			role: USER_ROLES.OWNER,
			restaurantIds: [],
		});

		const [ok, err] = await asAdmin(t).mutation(api.invites.revokeInvitation, {
			invitationId: created?.invitationId as Id<"invitations">,
		});
		expect(err).toBeNull();
		expect(ok).toBe(true);

		const events = await t.run(async (ctx) => ctx.db.query(TABLE.ALL_EVENTS).collect());
		const revoked = events.find((e) => e.eventType === AUDIT_EVENT.INVITATION_REVOKED);
		expect(revoked?.payload).toMatchObject({ email: "revoke-me@example.com" });
		await drainScheduler(t);
	});
});
