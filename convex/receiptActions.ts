"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import {
	ConflictError,
	fromErrorObject,
	NotAuthenticatedError,
	NotAuthorizedError,
	NotFoundError,
	RateLimitedError,
	UserInputValidationError,
} from "./_shared/errors";
import { parseResendErrorSummary, redactExternalId } from "./_shared/integrationLogging";
import { DINER_SESSION_ERRORS } from "./_util/dinerSession";
import { renderReceiptEmail } from "./emails/renderReceiptEmail";
import { RECEIPT_CONTEXT_BLOCKED } from "./receipts";
import { TABLE } from "./constants";

/**
 * Extract the bare address from a from-value that may already carry a display
 * name (`Tavli <no-reply@tavliai.com>` → `no-reply@tavliai.com`).
 */
function bareAddress(from: string): string {
	const match = /<([^<>]+)>/.exec(from);
	return (match ? match[1] : from).trim();
}

/**
 * Restaurant name as an email display name: header-safe (no CR/LF that could
 * inject headers, no quote/angle characters that could break out of the
 * display-name slot).
 */
function sanitizeDisplayName(name: string): string {
	return name
		.replace(/[\r\n"<>]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Sends the restaurant-branded receipt for a paid order to the CALLER's own
 * verified email (ADR 008 / TAVLI-71 Phase 3C). Pull-only — the diner clicks
 * the button; nothing auto-sends from webhooks.
 *
 * The recipient is always the authenticated identity's email — never an
 * argument — so this surface can't be used to spam third parties under a
 * restaurant's name. A per-order rate limit caps re-sends on top of that.
 */
export const sendReceiptEmail = action({
	args: {
		orderId: v.id(TABLE.ORDERS),
		locale: v.union(v.literal("en"), v.literal("es")),
	},
	handler: async (ctx, args): Promise<{ sentTo: string }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw fromErrorObject(new NotAuthenticatedError().toObject());
		}
		const userId = identity.subject;

		// Same identity-email reading as `invites.acceptInvitation`: Clerk JWTs
		// expose email/email_verified with claim-name variance across templates.
		const idRecord = identity as unknown as {
			email?: string;
			emailAddress?: string;
			emailVerified?: boolean;
			email_verified?: boolean;
		};
		const email =
			typeof idRecord.email === "string"
				? idRecord.email
				: typeof idRecord.emailAddress === "string"
					? idRecord.emailAddress
					: null;
		const emailVerified = idRecord.emailVerified ?? idRecord.email_verified;
		if (!email || emailVerified !== true) {
			throw fromErrorObject(
				new UserInputValidationError({
					fields: [{ field: "email", message: "ERROR_RECEIPT_NO_VERIFIED_EMAIL" }],
				}).toObject()
			);
		}

		const context = await ctx.runQuery(internal.receipts.getReceiptEmailContextInternal, {
			orderId: args.orderId,
			userId,
		});
		if (!context.ok) {
			switch (context.code) {
				case RECEIPT_CONTEXT_BLOCKED.NOT_MEMBER:
					throw fromErrorObject(
						new NotAuthorizedError(DINER_SESSION_ERRORS.ACCESS_DENIED).toObject()
					);
				case RECEIPT_CONTEXT_BLOCKED.NOT_PAID:
					throw fromErrorObject(new ConflictError("ERROR_RECEIPT_ORDER_NOT_PAID").toObject());
				default:
					throw fromErrorObject(new NotFoundError("Order not found").toObject());
			}
		}

		// Budget check BEFORE any send: a rejected hit must never email.
		const allowed = await ctx.runMutation(internal.receipts.consumeReceiptEmailRateLimit, {
			orderId: args.orderId,
		});
		if (!allowed) {
			throw fromErrorObject(new RateLimitedError("ERROR_RECEIPT_RATE_LIMITED").toObject());
		}

		const apiKey = process.env.RESEND_API_KEY;
		const fromEnv = process.env.RESEND_FROM_ADDRESS ?? process.env.RESEND_FROM;
		if (!apiKey || !fromEnv) {
			// Unlike invites (fire-and-forget), this is a user-initiated action:
			// swallowing the failure would show a false "sent" confirmation.
			console.warn("[receiptActions] RESEND_API_KEY or RESEND_FROM_ADDRESS missing.");
			throw fromErrorObject(new ConflictError("ERROR_RECEIPT_SEND_FAILED").toObject());
		}

		const { subject, html, text } = await renderReceiptEmail({
			locale: args.locale,
			restaurantName: context.restaurantName,
			taxInfo: context.taxInfo,
			orderNumber: context.orderNumber,
			orderDateMs: context.orderDateMs,
			timezone: context.timezone,
			items: context.items,
			subtotalCents: context.subtotalCents,
			feeCents: context.feeCents,
			totalCents: context.totalCents,
			tipCents: context.tipCents,
			paymentHint: context.paymentHint,
			contact: {
				email: context.supportEmail,
				phone: context.contactPhone,
				whatsAppUrl: context.contactWhatsAppUrl,
			},
		});

		// Branded as the restaurant, sent from Tavli's verified domain. Replies
		// route to the restaurant's own support inbox when configured.
		const displayName = sanitizeDisplayName(context.restaurantName);
		const from = displayName ? `${displayName} via Tavli <${bareAddress(fromEnv)}>` : fromEnv;

		const res = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from,
				to: [email],
				subject,
				html,
				text,
				...(context.supportEmail ? { reply_to: context.supportEmail } : {}),
			}),
		});

		if (!res.ok) {
			const responseText = await res.text();
			console.error("[receiptActions] Resend error:", {
				integration: "resend",
				operation: "sendReceiptEmail",
				orderId: redactExternalId(args.orderId),
				...parseResendErrorSummary(res.status, responseText),
			});
			throw fromErrorObject(new ConflictError("ERROR_RECEIPT_SEND_FAILED").toObject());
		}

		await ctx.runMutation(internal.receipts.recordReceiptEmailSent, {
			orderId: args.orderId,
			restaurantId: context.restaurantId,
			sessionId: context.sessionId,
			recipient: email,
			locale: args.locale,
			userId,
		});

		return { sentTo: email };
	},
});
