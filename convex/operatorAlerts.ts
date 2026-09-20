/**
 * Operator alerts — Tavli's own inbox (TAVLI-109).
 *
 * This module is the public face of the `operatorAlerts` table: the internal
 * mutation actions use to raise an alert, the internal query the severe-alert
 * email reads its context from, and the two platform-admin functions behind
 * `/admin/alerts`.
 *
 * The raising logic itself lives in `_util/operatorAlerts.ts` so a mutation
 * already inside a transaction (a webhook handler, a sweep) can call it
 * directly instead of paying for a `runMutation` round trip.
 *
 * **Platform admin only** for the read and the acknowledge — `getCurrentUserId`
 * then `requireAdminRole`, the same gate as `featureFlags.ts` and
 * `whatsappSpendAllowlist.ts`. These alerts are about Tavli's own money paths
 * across every restaurant; a restaurant owner has no business reading another
 * restaurant's stuck payments. Manager-facing notifications are a separate
 * surface and never come from here.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx,
} from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { fetchUserRoleRecord, getCurrentUserId, requireAdminRole } from "./_util/auth";
import { raiseOperatorAlert } from "./_util/operatorAlerts";
import { buildInviterDisplayName } from "./emails/contextHelpers";
import {
	OPERATOR_ALERT_KINDS,
	OPERATOR_ALERT_SEVERITIES,
	OPERATOR_ALERT_STATUS,
	TABLE,
} from "./constants";

type OperatorAlertDoc = Doc<typeof TABLE.OPERATOR_ALERTS>;
type OperatorAlertId = Id<typeof TABLE.OPERATOR_ALERTS>;
type AdminAuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

/** Validators for the stored enums, so an action cannot invent a kind. */
const kindValidator = v.union(...OPERATOR_ALERT_KINDS.map((kind) => v.literal(kind)));
const severityValidator = v.union(
	...OPERATOR_ALERT_SEVERITIES.map((severity) => v.literal(severity))
);

/** Admin gate shared by every client-facing function here. */
async function requireAdmin(ctx: QueryCtx | MutationCtx): AsyncReturn<string, AdminAuthErrors> {
	const [userId, authError] = await getCurrentUserId(ctx);
	if (authError) return [null, authError];
	const [, roleError] = await requireAdminRole(ctx, userId);
	if (roleError) return [null, roleError];
	return [userId, null];
}

// ============================================================================
// Raising (internal)
// ============================================================================

/**
 * `raiseOperatorAlert` for callers that are not mutations.
 *
 * An action — a Stripe webhook handler, a payout sweep — has no `db`, so it
 * reaches the helper through `ctx.runMutation(internal.operatorAlerts.raiseOperatorAlertInternal, …)`.
 * Internal, never public: raising an alert is something Tavli's own code does,
 * and a client-callable version would be a way to spam every platform admin.
 */
export const raiseOperatorAlertInternal = internalMutation({
	args: {
		kind: kindValidator,
		severity: v.optional(severityValidator),
		restaurantId: v.optional(v.id(TABLE.RESTAURANTS)),
		orderId: v.optional(v.id(TABLE.ORDERS)),
		paymentId: v.optional(v.id(TABLE.PAYMENTS)),
		stripeObjectId: v.optional(v.string()),
		messageKey: v.optional(v.string()),
		messageParams: v.optional(v.record(v.string(), v.union(v.string(), v.number()))),
		dedupeKey: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<OperatorAlertId> => raiseOperatorAlert(ctx, args),
});

/**
 * Everything the severe-alert email needs, resolved inside the database.
 *
 * The restaurant name is looked up here rather than passed through the
 * scheduler so the email reflects the restaurant as it is when the mail is
 * rendered — and so a renamed or purged restaurant cannot leave a stale name
 * frozen in a scheduled argument.
 */
export const getOperatorAlertEmailContext = internalQuery({
	args: { alertId: v.id(TABLE.OPERATOR_ALERTS) },
	handler: async (ctx, args) => {
		const alert = await ctx.db.get(args.alertId);
		if (!alert) return null;

		const restaurant = alert.restaurantId ? await ctx.db.get(alert.restaurantId) : null;
		return {
			kind: alert.kind,
			severity: alert.severity,
			messageKey: alert.messageKey,
			messageParams: alert.messageParams ?? null,
			restaurantName: restaurant?.name ?? null,
			stripeObjectId: alert.stripeObjectId ?? null,
		};
	},
});

// ============================================================================
// The admin page
// ============================================================================

type ListErrors = AdminAuthErrors;

/**
 * An alert as the page reads it: the row, the restaurant's name, and a human
 * name for whoever acknowledged it — so the table can label its links and
 * filter by restaurant without a second query, and without showing an operator
 * a raw Clerk subject.
 */
export type OperatorAlertListRow = OperatorAlertDoc & {
	restaurantName: string | null;
	/** Display name or email of `acknowledgedBy`; null when unresolvable. */
	acknowledgedByName: string | null;
};

/**
 * How many acknowledged alerts the page carries.
 *
 * Open alerts are deliberately unbounded — every one of them is work somebody
 * still has to do, and silently dropping the oldest would hide exactly the
 * alert that has been ignored longest. Acknowledged ones are history: they grow
 * without limit over the product's life, and past a couple of screens nobody
 * scrolls. Newest-first, so the cut falls on the oldest cleared alerts.
 */
export const ACKNOWLEDGED_ALERTS_LIMIT = 200;

/**
 * Every alert, open ones first and newest first within each group.
 *
 * Ordering is done here rather than in the table so the page has one obvious
 * reading order regardless of which column an operator last sorted by: an open
 * severe alert from a minute ago is the thing to look at, and it should never
 * be below something somebody already acknowledged.
 *
 * Two indexed reads rather than a full scan — `by_status_created` prefixes on
 * status, so each group comes back already sorted. Restaurant names and
 * acknowledger names are resolved through per-call caches, so a hundred alerts
 * about one restaurant cleared by one admin cost two lookups, not two hundred.
 */
export const list = query({
	args: {},
	handler: async function (ctx): AsyncReturn<OperatorAlertListRow[], ListErrors> {
		const [, authError] = await requireAdmin(ctx);
		if (authError) return [null, authError];

		const open = await ctx.db
			.query(TABLE.OPERATOR_ALERTS)
			.withIndex("by_status_created", (q) => q.eq("status", OPERATOR_ALERT_STATUS.OPEN))
			.order("desc")
			.collect();
		const acknowledged = await ctx.db
			.query(TABLE.OPERATOR_ALERTS)
			.withIndex("by_status_created", (q) => q.eq("status", OPERATOR_ALERT_STATUS.ACKNOWLEDGED))
			.order("desc")
			.take(ACKNOWLEDGED_ALERTS_LIMIT);

		const restaurantNames = new Map<string, string | null>();
		const actorNames = new Map<string, string | null>();
		const rows: OperatorAlertListRow[] = [];
		for (const alert of [...open, ...acknowledged]) {
			let restaurantName: string | null = null;
			if (alert.restaurantId) {
				const key = String(alert.restaurantId);
				if (!restaurantNames.has(key)) {
					const restaurant = await ctx.db.get(alert.restaurantId);
					restaurantNames.set(key, restaurant?.name ?? null);
				}
				restaurantName = restaurantNames.get(key) ?? null;
			}

			let acknowledgedByName: string | null = null;
			if (alert.acknowledgedBy) {
				const key = alert.acknowledgedBy;
				if (!actorNames.has(key)) {
					// `userRoles` is where an org-level identity's name and email
					// live; `buildInviterDisplayName` already encodes "structured
					// name, else email" and is what invite emails use.
					const roleRow = await fetchUserRoleRecord(ctx, key);
					actorNames.set(key, roleRow ? buildInviterDisplayName(roleRow) : null);
				}
				acknowledgedByName = actorNames.get(key) ?? null;
			}

			rows.push({ ...alert, restaurantName, acknowledgedByName });
		}

		return [rows, null];
	},
});

type AcknowledgeErrors = AdminAuthErrors | NotFoundErrorObject;

/**
 * "Seen it." Records who and when, and takes the row out of the open group —
 * which also re-arms its `dedupeKey`, so the same problem happening again
 * raises a fresh alert instead of being swallowed by this one.
 *
 * Acknowledging twice is a no-op rather than an error: two admins clicking the
 * same row is a race, not a mistake, and the first actor is the one who saw it
 * first.
 */
export const acknowledge = mutation({
	args: { alertId: v.id(TABLE.OPERATOR_ALERTS) },
	handler: async function (ctx, args): AsyncReturn<OperatorAlertId, AcknowledgeErrors> {
		const [userId, authError] = await requireAdmin(ctx);
		if (authError) return [null, authError];

		const alert = await ctx.db.get(args.alertId);
		if (!alert) return [null, new NotFoundError("ERROR_OPERATOR_ALERT_NOT_FOUND").toObject()];
		if (alert.status === OPERATOR_ALERT_STATUS.ACKNOWLEDGED) return [alert._id, null];

		await ctx.db.patch(alert._id, {
			status: OPERATOR_ALERT_STATUS.ACKNOWLEDGED,
			acknowledgedBy: userId,
			acknowledgedAt: Date.now(),
		});

		return [alert._id, null];
	},
});
