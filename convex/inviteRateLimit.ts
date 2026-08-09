/**
 * Invitation send budget.
 *
 * Until bulk onboarding existed there was NO limit on invitations at all: one
 * mutation call, one Resend email, unbounded. A CSV upload turns that into a
 * mail-bomb primitive, so every path that creates an invitation now consumes
 * from two independent budgets:
 *
 *   - per **inviter** — generous (a legitimate 500-row onboarding must fit),
 *     bounding a runaway script or a hijacked admin session;
 *   - per **target email** — tight, so no single person can be spammed no
 *     matter how many admins or uploads are pointed at them.
 *
 * Both are consumed BEFORE the invitation row is inserted, so a rejected hit
 * never schedules an email.
 */

import type { MutationCtx } from "./_generated/server";
import { consumeRateLimit } from "./_util/rateLimit";
import { INVITE_SEND_RATE_LIMIT, INVITE_TARGET_EMAIL_RATE_LIMIT } from "./constants";

/** Stable codes the frontend maps to i18n keys. Never returned as prose. */
export const INVITE_RATE_LIMIT_ERROR = {
	/** The inviter's hourly budget is exhausted. */
	INVITER: "ERROR_INVITE_RATE_LIMITED",
	/** This recipient has already been invited too many times today. */
	TARGET_EMAIL: "ERROR_INVITE_EMAIL_RATE_LIMITED",
} as const;

export type InviteRateLimitCode =
	(typeof INVITE_RATE_LIMIT_ERROR)[keyof typeof INVITE_RATE_LIMIT_ERROR];

/** Namespaced so invite counters can never collide with another feature's key. */
export function inviterRateLimitKey(actorId: string): string {
	return `invite_send:${actorId}`;
}

export function inviteTargetRateLimitKey(normalizedEmail: string): string {
	return `invite_target:${normalizedEmail}`;
}

/**
 * Consume one invitation from both budgets. Returns `null` when the send may
 * proceed, or the stable code of whichever budget rejected it.
 *
 * The inviter budget is charged first on purpose: if the (much tighter) target
 * budget then rejects, the caller has burned 1 of 600 hourly sends rather than
 * 1 of 5 daily sends to that address — the cheaper of the two to waste.
 */
export async function consumeInvitationBudget(
	ctx: MutationCtx,
	args: { actorId: string; normalizedEmail: string; now?: number }
): Promise<InviteRateLimitCode | null> {
	const inviter = await consumeRateLimit(
		ctx,
		inviterRateLimitKey(args.actorId),
		INVITE_SEND_RATE_LIMIT,
		args.now
	);
	if (!inviter.allowed) return INVITE_RATE_LIMIT_ERROR.INVITER;

	const target = await consumeRateLimit(
		ctx,
		inviteTargetRateLimitKey(args.normalizedEmail),
		INVITE_TARGET_EMAIL_RATE_LIMIT,
		args.now
	);
	if (!target.allowed) return INVITE_RATE_LIMIT_ERROR.TARGET_EMAIL;

	return null;
}
