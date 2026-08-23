/**
 * The WhatsApp spend allowlist: phones exempt from the assistant's per-phone
 * daily message caps (TAVLI-91).
 *
 * The list exists so the people who have to *use* the assistant — the operator's
 * own handset, a phone doing supervised QA — are not silenced by the caps that
 * protect Tavli from strangers. It exempts those two caps and nothing else: the
 * hourly write budget and the one-write-per-turn budget still apply, because
 * they guard reservation data rather than spend, and a bug that only shows up
 * once they bite has to stay reachable from the number being tested with.
 *
 * **Platform admin only** — `getCurrentUserId` then `requireAdminRole`, the same
 * gate as `featureFlags.ts`. Deliberately not restaurant owners: an entry here
 * waives a control on Tavli's own bill, and an owner exempting their regulars
 * would be spending someone else's money.
 *
 * Every change is audit-logged with `restaurantId: null`. The allowlist is
 * org-level — it belongs to no restaurant — and "who let this number through,
 * and when" is the only question worth asking after a surprise invoice.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
	ConflictError,
	ConflictErrorObject,
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { appendAuditEvent } from "./_util/audit";
import { getCurrentUserId, requireAdminRole } from "./_util/auth";
import { normalizeContactPhone } from "./_util/phone";
import { AUDIT_SYSTEM_USER_ID, TABLE, WHATSAPP_SPEND_ALLOWLIST_SEED } from "./constants";

type AllowlistDoc = Doc<typeof TABLE.WHATSAPP_SPEND_ALLOWLIST>;
type AllowlistId = Id<typeof TABLE.WHATSAPP_SPEND_ALLOWLIST>;
type AdminAuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

/** Longest label we store. A note, not an essay. */
const MAX_LABEL_LENGTH = 80;

/** Audit event types written for a row here. The seed reads them back. */
const ADDED_EVENT = "whatsappSpendAllowlist.added";
const REMOVED_EVENT = "whatsappSpendAllowlist.removed";

const { phone: OPERATOR_PHONE, label: OPERATOR_LABEL } = WHATSAPP_SPEND_ALLOWLIST_SEED;

/**
 * Admin gate shared by every function here. Returns the acting user's id.
 */
async function requireAdmin(ctx: QueryCtx | MutationCtx): AsyncReturn<string, AdminAuthErrors> {
	const [userId, authError] = await getCurrentUserId(ctx);
	if (authError) return [null, authError];
	const [, roleError] = await requireAdminRole(ctx, userId);
	if (roleError) return [null, roleError];
	return [userId, null];
}

/**
 * Canonical E.164, or a validation error.
 *
 * `normalizeContactPhone` returns input it cannot place *unchanged* rather than
 * guessing — the right call for a reservation contact, where a mangled number is
 * worse than an unmatched one. Here it is not: an unplaceable string stored as a
 * phone is a row that looks like an exemption and exempts nobody, because it can
 * never equal what Twilio delivers. So reject it instead.
 */
function canonicalizePhone(raw: string): [string, null] | [null, UserInputValidationErrorObject] {
	const canonical = normalizeContactPhone(raw, undefined);
	if (!/^\+\d{8,15}$/.test(canonical)) {
		return [
			null,
			new UserInputValidationError({
				fields: [
					{
						field: "phone",
						message: "Must be a phone number in international form, e.g. +52 811 490 6208",
					},
				],
			}).toObject(),
		];
	}
	return [canonical, null];
}

// ============================================================================
// Queries
// ============================================================================

type ListErrors = AdminAuthErrors;

/**
 * The whole allowlist, newest first. Admin-only: the list is a map of exactly
 * which numbers bypass the spend caps.
 */
export const list = query({
	args: {},
	handler: async function (ctx): AsyncReturn<AllowlistDoc[], ListErrors> {
		const [, authError] = await requireAdmin(ctx);
		if (authError) return [null, authError];

		// Creation-time order rather than `createdAt`: two rows added in the same
		// millisecond would otherwise tie and shuffle between reads.
		const rows = await ctx.db.query(TABLE.WHATSAPP_SPEND_ALLOWLIST).order("desc").collect();
		return [rows, null];
	},
});

// ============================================================================
// Mutations
// ============================================================================

type AddErrors = AdminAuthErrors | UserInputValidationErrorObject | ConflictErrorObject;

/** Exempt a phone from the assistant's daily message caps. */
export const add = mutation({
	args: { phone: v.string(), label: v.string() },
	handler: async function (ctx, args): AsyncReturn<AllowlistId, AddErrors> {
		const [userId, authError] = await requireAdmin(ctx);
		if (authError) return [null, authError];

		const [phone, phoneError] = canonicalizePhone(args.phone);
		if (phoneError) return [null, phoneError];

		// A number nobody can identify is a number nobody dares remove.
		const label = args.label.trim().slice(0, MAX_LABEL_LENGTH);
		if (!label) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "label", message: "Say whose phone this is" }],
				}).toObject(),
			];
		}

		const existing = await ctx.db
			.query(TABLE.WHATSAPP_SPEND_ALLOWLIST)
			.withIndex("by_phone", (q) => q.eq("phone", phone))
			.first();
		if (existing) {
			return [null, new ConflictError("ERROR_PHONE_ALREADY_ALLOWLISTED").toObject()];
		}

		const allowlistId = await ctx.db.insert(TABLE.WHATSAPP_SPEND_ALLOWLIST, {
			phone,
			label,
			createdAt: Date.now(),
			createdBy: userId,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.WHATSAPP_SPEND_ALLOWLIST,
			aggregateId: allowlistId,
			eventType: ADDED_EVENT,
			// Org-level: this exempts a phone from a platform-wide spend control,
			// not from anything one restaurant owns.
			restaurantId: null,
			payload: { phone, label },
			userId,
		});

		return [allowlistId, null];
	},
});

type RemoveErrors = AdminAuthErrors | NotFoundErrorObject;

/** Put a phone back under the daily caps. */
export const remove = mutation({
	args: { allowlistId: v.id(TABLE.WHATSAPP_SPEND_ALLOWLIST) },
	handler: async function (ctx, args): AsyncReturn<null, RemoveErrors> {
		const [userId, authError] = await requireAdmin(ctx);
		if (authError) return [null, authError];

		const row = await ctx.db.get(args.allowlistId);
		if (!row) return [null, new NotFoundError("ERROR_ALLOWLIST_ENTRY_NOT_FOUND").toObject()];

		await ctx.db.delete(row._id);

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.WHATSAPP_SPEND_ALLOWLIST,
			aggregateId: row._id,
			eventType: REMOVED_EVENT,
			restaurantId: null,
			// The row itself is gone; the event is the only remaining record of
			// which number was exempt and under what label.
			payload: { phone: row.phone, label: row.label },
			userId,
		});

		return [null, null];
	},
});

// ============================================================================
// The operator's own handset
// ============================================================================

/**
 * Insert the seed row unless someone has already decided about it.
 *
 * Two things have to be true at once, and only one of them is obvious:
 *
 * 1. **Every deployment starts with the operator exempt, with no human action.**
 *    A seed that has to be clicked is not seeded: until somebody signs in as a
 *    platform admin and presses a button, the operator's own handset is silenced
 *    after 25 inbound messages with a single notice and then nothing — which
 *    reads as "the assistant is broken", not as "the cap fired". Nothing in the
 *    deploy path prompts anyone to press it, so the seed has to place itself.
 * 2. **Removing the entry sticks.** An admin who takes the operator off the list
 *    meant it; a seed that re-appears on its own is a spend control nobody can
 *    turn off.
 *
 * The marker that separates "never seeded" from "seeded and then removed" is the
 * audit trail this module already writes for exactly this purpose. A
 * `whatsappSpendAllowlist.removed` event naming the operator's phone is a
 * recorded human decision, and `allEvents` is append-only, so the decision
 * outlives the row it was about. No extra table, no `seededAt` column that a
 * later purge could clear.
 *
 * Idempotent and cheap: the removal scan runs only while the row is absent, and
 * the whole function only runs for one phone number.
 */
export async function ensureOperatorSeeded(ctx: MutationCtx): Promise<boolean> {
	const existing = await ctx.db
		.query(TABLE.WHATSAPP_SPEND_ALLOWLIST)
		.withIndex("by_phone", (q) => q.eq("phone", OPERATOR_PHONE))
		.first();
	if (existing) return false;

	// Bounded by the number of allowlist removals ever performed, which is a
	// handful — not by traffic.
	const removals = await ctx.db
		.query(TABLE.ALL_EVENTS)
		.withIndex("by_event_type", (q) => q.eq("eventType", REMOVED_EVENT))
		.collect();
	const wasRemoved = removals.some(
		(event) => (event.payload as { phone?: unknown } | null)?.phone === OPERATOR_PHONE
	);
	if (wasRemoved) return false;

	await insertOperatorRow(ctx, AUDIT_SYSTEM_USER_ID);
	return true;
}

/** Shared insert + audit event for the seed row. */
async function insertOperatorRow(ctx: MutationCtx, userId: string): Promise<void> {
	const allowlistId = await ctx.db.insert(TABLE.WHATSAPP_SPEND_ALLOWLIST, {
		phone: OPERATOR_PHONE,
		label: OPERATOR_LABEL,
		createdAt: Date.now(),
		createdBy: userId,
	});
	await appendAuditEvent(ctx, {
		aggregateType: TABLE.WHATSAPP_SPEND_ALLOWLIST,
		aggregateId: allowlistId,
		eventType: ADDED_EVENT,
		restaurantId: null,
		payload: { phone: OPERATOR_PHONE, label: OPERATOR_LABEL, seeded: true },
		userId,
	});
}

/**
 * Put the operator's number back, by hand.
 *
 * {@link ensureOperatorSeeded} already places it on first contact, so this is
 * for an admin who wants the row on the screen before any message has arrived,
 * or who removed it and changed their mind. Explicit, so unlike the automatic
 * path it is *not* blocked by an earlier removal — pressing the button is itself
 * the human decision the removal marker exists to respect.
 */
export const seedOperatorNumber = mutation({
	args: {},
	handler: async (ctx) => {
		const [userId, authError] = await requireAdmin(ctx);
		if (authError) return { ok: false as const, error: authError };

		const existing = await ctx.db
			.query(TABLE.WHATSAPP_SPEND_ALLOWLIST)
			.withIndex("by_phone", (q) => q.eq("phone", OPERATOR_PHONE))
			.first();
		if (existing) return { ok: true as const, created: 0 };

		await insertOperatorRow(ctx, userId);
		return { ok: true as const, created: 1 };
	},
});
