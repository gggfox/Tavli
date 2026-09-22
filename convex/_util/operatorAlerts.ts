/**
 * Raising an operator alert (TAVLI-109).
 *
 * Every money path in Tavli eventually reaches a situation the code can detect
 * but cannot fix: a charge that matches no order, a payout Stripe refused, a
 * payment stuck in `processing` for an hour. Until now those ended at
 * `console.error`, which nobody reads. `raiseOperatorAlert` is where they go
 * instead: one row in `operatorAlerts`, visible on `/admin/alerts`, and — when
 * the severity is `severe` — an email to every platform admin.
 *
 * Two properties matter more than anything else here, because the call sites
 * are webhook handlers and cron sweeps:
 *
 * 1. **Idempotent.** A caller that passes `dedupeKey` gets one row per open
 *    problem, not one per delivery. Stripe replays; a sweep re-runs every five
 *    minutes. Fifty deliveries must not produce fifty rows and fifty emails.
 *    The key is scoped to OPEN alerts only, so once an operator acknowledges
 *    the row, the next occurrence is a genuinely new alert.
 * 2. **Never blocked by email.** The severe-alert email is scheduled with
 *    `runAfter(0)`, so Resend being down (or slow, or rate-limiting) can never
 *    fail the mutation that raised the alert — which is usually the same
 *    transaction that recorded the payment state the alert is about.
 *
 * The message is an i18n key plus params, never a sentence: the alerts page
 * renders it through i18next, and the email renders the same keys from
 * `convex/emails/operatorAlertCopy.ts`. A backend that stored prose would be a
 * backend that can only apologise in English.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { resolveInviteLocale, type InviteEmailLocale } from "../emails/locale";
import {
	OPERATOR_ALERT_DEFAULT_SEVERITY,
	OPERATOR_ALERT_EMAIL_ROLES,
	OPERATOR_ALERT_EXPLANATION_KEY,
	OPERATOR_ALERT_SEVERITY,
	OPERATOR_ALERT_STATUS,
	TABLE,
	type OperatorAlertKind,
	type OperatorAlertSeverity,
} from "../constants";

export type OperatorAlertMessageParams = Record<string, string | number>;

export type RaiseOperatorAlertArgs = {
	kind: OperatorAlertKind;
	/** Defaults to the kind's `OPERATOR_ALERT_DEFAULT_SEVERITY`. */
	severity?: OperatorAlertSeverity;
	restaurantId?: Id<"restaurants">;
	orderId?: Id<"orders">;
	paymentId?: Id<"payments">;
	/** `pi_…`, `ch_…`, `po_…` — whatever Stripe object the operator will look up. */
	stripeObjectId?: string;
	/** Defaults to the kind's `OPERATOR_ALERT_EXPLANATION_KEY`. */
	messageKey?: string;
	messageParams?: OperatorAlertMessageParams;
	/**
	 * A stable name for *the problem*, not for this occurrence of it — e.g.
	 * `` `payment_stuck:${paymentId}` ``, `` `dispute_lost:${stripeDisputeId}` ``.
	 *
	 * **Any caller that can fire more than once for the same problem MUST pass
	 * one.** That is every sweep (a cron re-running every five minutes sees the
	 * same stuck payment each time), every webhook handler (Stripe redelivers,
	 * for days, until it gets a 2xx it believes), and every retried action.
	 *
	 * This is not a tidiness preference, it is the only thing bounding the
	 * table. `operatorAlerts.list` reads the OPEN group **unbounded** on purpose
	 * — an open alert is work somebody still owes, and truncating would hide the
	 * oldest, most-ignored one. So a keyless sweep raising one row per run walks
	 * that query straight into Convex's 32k-document read cap within days, and
	 * the page stops loading *for every alert*, including the one that matters.
	 * A key costs nothing and caps the problem at one open row.
	 *
	 * Omit it only when each occurrence genuinely is its own alert — a
	 * user-triggered event that cannot repeat for the same object.
	 */
	dedupeKey?: string;
	/**
	 * Make `dedupeKey` collapse ACKNOWLEDGED rows too, so the problem is
	 * reported **once, ever** (TAVLI-106).
	 *
	 * The default deliberately scopes the key to OPEN alerts: acknowledging is
	 * how an operator says "dealt with", and a genuine recurrence afterwards is
	 * news. That is right for an event-driven caller, where a second alert means
	 * a second event.
	 *
	 * It is wrong for a detector on a timer that reports an UNCHANGED FACT. The
	 * stuck-payment sweep re-reads the same wedged row every five minutes; with
	 * the default, the moment an admin acknowledges the alert the next run
	 * raises a fresh one — and if it is severe, mails every platform admin
	 * again. The operator is punished for clearing their inbox, 288 times a day,
	 * and the only way to make it stop is to fix a payment that may need Stripe
	 * support to resolve.
	 *
	 * So: pass this when re-detection carries no new information, and the row
	 * the operator acknowledged still describes the situation exactly. The cost
	 * is that a *genuinely* recurring problem under the same key is silent after
	 * the first acknowledgement — which is why the key must then name a thing
	 * that can only be wrong once (one payment, one payout), never a class.
	 */
	dedupeAcrossAcknowledged?: boolean;
};

/** One severe-alert recipient: a platform admin and the language they read in. */
export type OperatorAlertEmailRecipient = {
	email: string;
	locale: InviteEmailLocale;
};

const EMAIL_ROLES = new Set<string>(OPERATOR_ALERT_EMAIL_ROLES);

/**
 * Every platform admin with an email address, de-duplicated.
 *
 * `OPERATOR_ALERT_EMAIL_ROLES` is `admin` alone, matching the gate on
 * `/admin/alerts`. Org-level `owner` is the CLIENT role — a restaurant group's
 * proprietor — and must never receive Tavli's internal operator mail.
 *
 * Full scan of `userRoles`, matching `admin.ts` and `restaurantPurge.ts`: the
 * table holds one row per person who has ever held a role, the `roles` array
 * cannot be indexed on membership, and the severe path runs rarely. If
 * `userRoles` ever grows to diner scale this becomes a denormalized flag, not
 * a bigger scan.
 *
 * A row without an email is skipped rather than failing the raise — a platform
 * admin whose Clerk profile has no email cannot be reached by definition, and
 * the alert still lands on `/admin/alerts`.
 */
export async function collectOperatorAlertRecipients(
	ctx: MutationCtx
): Promise<OperatorAlertEmailRecipient[]> {
	const roleRows: Doc<"userRoles">[] = await ctx.db.query(TABLE.USER_ROLES).collect();

	const byEmail = new Map<string, OperatorAlertEmailRecipient>();
	for (const row of roleRows) {
		if (!(row.roles ?? []).some((role) => EMAIL_ROLES.has(role))) continue;
		const email = row.email?.trim();
		if (!email) continue;
		// A person can hold several `userRoles` rows (one per organization).
		// They are still one inbox, and one email is what they should get.
		if (byEmail.has(email.toLowerCase())) continue;

		const settings = await ctx.db
			.query(TABLE.USER_SETTINGS)
			.withIndex("by_user", (q) => q.eq("userId", row.userId))
			.first();
		byEmail.set(email.toLowerCase(), {
			email,
			locale: resolveInviteLocale(settings?.language),
		});
	}

	return [...byEmail.values()];
}

/**
 * Record an operator alert, and email the platform admins when it is severe.
 *
 * Returns the id of the alert — the existing one when `dedupeKey` matched an
 * open row, so a caller can always link to "the alert for this problem".
 *
 * Takes a `MutationCtx` rather than being a Convex function so a mutation that
 * is already mid-transaction can raise an alert without a round trip. Actions
 * reach it through `operatorAlerts.raiseOperatorAlertInternal`.
 */
export async function raiseOperatorAlert(
	ctx: MutationCtx,
	args: RaiseOperatorAlertArgs
): Promise<Id<"operatorAlerts">> {
	if (args.dedupeKey) {
		// Both probes ride `by_dedupe_status` (dedupeKey, status). The wider one
		// simply stops at the key, which is a prefix of the same index — still one
		// bounded lookup, never a scan.
		const dedupeKey = args.dedupeKey;
		const existing = args.dedupeAcrossAcknowledged
			? await ctx.db
					.query(TABLE.OPERATOR_ALERTS)
					.withIndex("by_dedupe_status", (q) => q.eq("dedupeKey", dedupeKey))
					.first()
			: await ctx.db
					.query(TABLE.OPERATOR_ALERTS)
					.withIndex("by_dedupe_status", (q) =>
						q.eq("dedupeKey", dedupeKey).eq("status", OPERATOR_ALERT_STATUS.OPEN)
					)
					.first();
		// Deliberately nothing else: no touched timestamp, no counter, no second
		// email. The operator already has this on their screen.
		if (existing) return existing._id;
	}

	const severity = args.severity ?? OPERATOR_ALERT_DEFAULT_SEVERITY[args.kind];
	const alertId = await ctx.db.insert(TABLE.OPERATOR_ALERTS, {
		kind: args.kind,
		severity,
		restaurantId: args.restaurantId,
		orderId: args.orderId,
		paymentId: args.paymentId,
		stripeObjectId: args.stripeObjectId,
		messageKey: args.messageKey ?? OPERATOR_ALERT_EXPLANATION_KEY[args.kind],
		messageParams: args.messageParams,
		dedupeKey: args.dedupeKey,
		status: OPERATOR_ALERT_STATUS.OPEN,
		createdAt: Date.now(),
	});

	if (severity === OPERATOR_ALERT_SEVERITY.SEVERE) {
		// One job per recipient rather than one job for the list: a single bad
		// address (or one Resend rejection) then costs one undelivered email
		// instead of silencing everyone after it.
		for (const recipient of await collectOperatorAlertRecipients(ctx)) {
			await ctx.scheduler.runAfter(0, internal.operatorAlertActions.sendOperatorAlertEmail, {
				alertId,
				email: recipient.email,
				locale: recipient.locale,
			});
		}
	}

	return alertId;
}
