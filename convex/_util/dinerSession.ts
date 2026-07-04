import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { TABLE } from "../constants";
import { fromErrorObject, NotFoundError } from "../_shared/errors";
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

/**
 * Ensures the session exists, is active, and belongs to the authenticated user.
 * Returns generic not-found for wrong-owner lookups to avoid ID enumeration.
 */
export async function requireOwnedActiveSession(
	ctx: DinerSessionCtx,
	sessionId: Id<typeof TABLE.SESSIONS>
): Promise<Doc<typeof TABLE.SESSIONS>> {
	const userId = await requireAuthenticatedDiner(ctx);
	const session = await ctx.db.get(sessionId);
	if (!session || session.status !== "active" || session.userId !== userId) {
		throw new NotFoundError("Active session not found");
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
	await requireOwnedActiveSession(ctx, order.sessionId);
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
} as const;
