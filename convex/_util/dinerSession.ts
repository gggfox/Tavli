import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { TABLE } from "../constants";
import { fromErrorObject, NotAuthorizedError, NotFoundError } from "../_shared/errors";
import { getCurrentUserId } from "./auth";

type DinerSessionCtx = {
	db: DatabaseReader;
	auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
};

/** Clerk-authenticated diner placing orders at their table session. */
export async function requireAuthenticatedDiner(ctx: DinerSessionCtx): Promise<string> {
	const [userId, authError] = await getCurrentUserId(ctx);
	if (authError) {
		throw fromErrorObject(authError);
	}
	return userId;
}

/** True when the user opened the tab or joined it via join code. */
export function isSessionMember(session: Doc<typeof TABLE.SESSIONS>, userId: string): boolean {
	return session.userId === userId || (session.memberUserIds ?? []).includes(userId);
}

/**
 * Ensures the session exists, is active, and the authenticated user is a tab
 * member (opener or joined via join code). Returns generic not-found for
 * wrong-owner lookups to avoid ID enumeration.
 */
export async function requireOwnedActiveSession(
	ctx: DinerSessionCtx,
	sessionId: Id<typeof TABLE.SESSIONS>
): Promise<Doc<typeof TABLE.SESSIONS>> {
	const userId = await requireAuthenticatedDiner(ctx);
	const session = await ctx.db.get(sessionId);
	if (!session || session.status !== "active" || !isSessionMember(session, userId)) {
		throw new NotFoundError("Active session not found");
	}
	return session;
}

/**
 * Same as `requireOwnedActiveSession` but additionally rejects while a tab
 * payment is in flight. Ordering mutations use this so the tab balance can't
 * change under an open PaymentIntent.
 */
export async function requireUnlockedOwnedSession(
	ctx: DinerSessionCtx,
	sessionId: Id<typeof TABLE.SESSIONS>
): Promise<Doc<typeof TABLE.SESSIONS>> {
	const session = await requireOwnedActiveSession(ctx, sessionId);
	if (session.lockedForPaymentAt !== undefined) {
		throw fromErrorObject(new NotAuthorizedError(DINER_SESSION_ERRORS.TAB_LOCKED).toObject());
	}
	return session;
}

export async function requireOwnedOrder(
	ctx: DinerSessionCtx,
	orderId: Id<typeof TABLE.ORDERS>,
	options?: { draftOnly?: boolean }
): Promise<Doc<typeof TABLE.ORDERS>> {
	const order = await ctx.db.get(orderId);
	if (!order) {
		throw new NotFoundError("Order not found");
	}
	if (options?.draftOnly && order.status !== "draft") {
		throw new NotFoundError("Draft order not found");
	}
	// Draft edits feed the tab balance, so they are blocked while a tab
	// payment is in flight. Read-only callers (no draftOnly) stay allowed.
	if (options?.draftOnly) {
		await requireUnlockedOwnedSession(ctx, order.sessionId);
	} else {
		await requireOwnedActiveSession(ctx, order.sessionId);
	}
	return order;
}

/** Safe subset of payment metadata exposed to diners during checkout. */
export type DinerVisiblePayment = {
	status: Doc<typeof TABLE.PAYMENTS>["status"];
	failureCode?: string;
	failureMessage?: string;
};

export function toDinerVisiblePayment(
	payment: Doc<typeof TABLE.PAYMENTS> | null
): DinerVisiblePayment | null {
	if (!payment) return null;
	return {
		status: payment.status,
		...(payment.failureCode !== undefined && { failureCode: payment.failureCode }),
		...(payment.failureMessage !== undefined && { failureMessage: payment.failureMessage }),
	};
}

export const DINER_SESSION_ERRORS = {
	ACCESS_DENIED: "ERROR_SESSION_ACCESS_DENIED",
	/** Tab payment in flight — ordering is blocked until it settles or fails. */
	TAB_LOCKED: "ERROR_TAB_LOCKED",
	/** Join code did not match an open tab at this restaurant. */
	INVALID_JOIN_CODE: "ERROR_INVALID_JOIN_CODE",
	/** Tab has no payable balance to charge. */
	TAB_EMPTY: "ERROR_TAB_EMPTY",
} as const;
