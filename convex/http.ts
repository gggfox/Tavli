// =============================================================================
// HTTP Router — Stripe Webhook Endpoints
// =============================================================================
//
// This module registers HTTP routes that Stripe calls when events occur.
// There are two separate endpoints because they handle different event formats:
//
// 1. POST /stripe/webhook
//    Standard webhook for payment events (checkout.session.completed,
//    payment_intent.succeeded, account.updated). These are "fat" events
//    containing the full event payload.
//
// 2. POST /stripe/connect-webhook
//    V2 thin-event webhook for connected account changes (requirements
//    updated, capability status changes). These are "thin" events
//    containing only a reference; the handler fetches full data from Stripe.
//
// Both endpoints verify the `stripe-signature` header to ensure the request
// came from Stripe. Each uses its own webhook secret.
// =============================================================================

import { httpRouter } from "convex/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { TABLE, RESERVATION_SOURCE } from "./constants";

const http = httpRouter();

// =============================================================================
// Standard Payment Webhook
// =============================================================================

http.route({
	path: "/stripe/webhook",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		// Stripe sends a signature header with every webhook request.
		// We use this to verify the payload hasn't been tampered with.
		const signature = request.headers.get("stripe-signature");
		if (!signature) {
			return new Response("Missing stripe-signature header", { status: 400 });
		}

		// Read the raw body as text — Stripe's signature verification
		// requires the exact bytes that were sent
		const payloadString = await request.text();

		try {
			// Delegate to the internal action that verifies the signature
			// and processes the event (see convex/stripe.ts fulfillPayment)
			await ctx.runAction(internal.stripe.fulfillPayment, {
				payloadString,
				signatureHeader: signature,
			});
			return new Response(JSON.stringify({ received: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		} catch (error) {
			console.error("Webhook processing error:", error);
			return new Response("Webhook handler failed", { status: 400 });
		}
	}),
});

// =============================================================================
// V2 Thin Events Webhook (Connected Account Changes)
// =============================================================================
//
// This endpoint receives "thin" events for V2 connected account changes.
// Thin events are lightweight — they contain only a type and an ID.
// The handler fetches the full event data from Stripe before processing.
//
// To set this up:
//   1. In Stripe Dashboard > Developers > Webhooks > + Add destination
//   2. Events from: "Connected accounts"
//   3. Show advanced options > Payload style: "Thin"
//   4. Select: v2.core.account[requirements].updated
//              v2.core.account[configuration.recipient].capability_status_updated
//
// For local development, use the Stripe CLI:
//   stripe listen --thin-events \
//     'v2.core.account[requirements].updated,v2.core.account[.recipient].capability_status_updated' \
//     --forward-thin-to http://localhost:3210/stripe/connect-webhook

http.route({
	path: "/stripe/connect-webhook",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const signature = request.headers.get("stripe-signature");
		if (!signature) {
			return new Response("Missing stripe-signature header", { status: 400 });
		}

		const payloadString = await request.text();

		try {
			// Delegate to the thin event handler (see convex/stripe.ts handleThinEvent)
			await ctx.runAction(internal.stripe.handleThinEvent, {
				payloadString,
				signatureHeader: signature,
			});
			return new Response(JSON.stringify({ received: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		} catch (error) {
			console.error("Connect webhook processing error:", error);
			return new Response("Webhook handler failed", { status: 400 });
		}
	}),
});

// =============================================================================
// Reservations API (for the WhatsApp bot, future SDK clients, etc.)
// =============================================================================
//
// Three POST routes guarded by `RESERVATIONS_BOT_TOKEN`. The bot sends:
//   Authorization: Bearer <token>
// Routes are kept minimal: parse, validate the token, delegate to the same
// internal mutations the UI uses. Idempotency is supported on create via the
// `Idempotency-Key` header.
//
// Local dev: set RESERVATIONS_BOT_TOKEN with `npx convex env set
// RESERVATIONS_BOT_TOKEN <some-secret>`.

function unauthorizedResponse(): Response {
	return new Response(JSON.stringify({ error: "Unauthorized" }), {
		status: 401,
		headers: { "Content-Type": "application/json" },
	});
}

function badRequestResponse(message: string): Response {
	return new Response(JSON.stringify({ error: message }), {
		status: 400,
		headers: { "Content-Type": "application/json" },
	});
}

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function isAuthorizedBotRequest(request: Request): boolean {
	const expected = process.env.RESERVATIONS_BOT_TOKEN;
	if (!expected) return false;
	const header = request.headers.get("authorization");
	if (!header) return false;
	const [scheme, token] = header.split(" ");
	if (scheme !== "Bearer" || !token) return false;
	// Constant-time-ish compare. The token is a shared secret, not a JWT, so
	// length-equal + char-by-char is sufficient.
	if (token.length !== expected.length) return false;
	let mismatch = 0;
	for (let i = 0; i < token.length; i++) {
		mismatch |= (token.codePointAt(i) ?? 0) ^ (expected.codePointAt(i) ?? 0);
	}
	return mismatch === 0;
}

http.route({
	path: "/api/v1/reservations/availability",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!isAuthorizedBotRequest(request)) return unauthorizedResponse();
		let body: {
			restaurantId?: string;
			partySize?: number;
			startsAt?: number;
		};
		try {
			body = await request.json();
		} catch {
			return badRequestResponse("Invalid JSON body");
		}
		if (!body.restaurantId || !body.partySize || !body.startsAt) {
			return badRequestResponse("restaurantId, partySize, and startsAt are required");
		}
		const result = await ctx.runQuery(api.reservations.getAvailability, {
			restaurantId: body.restaurantId as Id<typeof TABLE.RESTAURANTS>,
			partySize: body.partySize,
			startsAt: body.startsAt,
		});
		return jsonResponse(result);
	}),
});

http.route({
	path: "/api/v1/reservations",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!isAuthorizedBotRequest(request)) return unauthorizedResponse();
		let body: {
			restaurantId?: string;
			partySize?: number;
			startsAt?: number;
			contact?: { name?: string; phone?: string; email?: string };
			notes?: string;
			userId?: string;
		};
		try {
			body = await request.json();
		} catch {
			return badRequestResponse("Invalid JSON body");
		}
		if (
			!body.restaurantId ||
			!body.partySize ||
			!body.startsAt ||
			!body.contact?.name ||
			!body.contact?.phone
		) {
			return badRequestResponse(
				"restaurantId, partySize, startsAt, and contact.{name,phone} are required"
			);
		}
		const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
		const [reservationId, error] = await ctx.runMutation(
			internal.reservations.internalCreate,
			{
				restaurantId: body.restaurantId as Id<typeof TABLE.RESTAURANTS>,
				partySize: body.partySize,
				startsAt: body.startsAt,
				contact: {
					name: body.contact.name,
					phone: body.contact.phone,
					email: body.contact.email,
				},
				source: RESERVATION_SOURCE.WHATSAPP,
				userId: body.userId,
				notes: body.notes,
				idempotencyKey,
			}
		);
		if (error) {
			return jsonResponse({ error }, error.name === "NOT_FOUND" ? 404 : 409);
		}
		return jsonResponse({ reservationId }, 201);
	}),
});

http.route({
	pathPrefix: "/api/v1/reservations/cancel/",
	method: "POST",
	handler: httpAction(async (_ctx, request) => {
		if (!isAuthorizedBotRequest(request)) return unauthorizedResponse();
		// Path is /api/v1/reservations/cancel/<reservationId>
		const url = new URL(request.url);
		const reservationId = url.pathname.split("/").pop();
		if (!reservationId) return badRequestResponse("Missing reservationId");
		let body: { reason?: string } = {};
		try {
			body = await request.json();
		} catch {
			// Empty body is OK -- reason is optional.
		}
		// The bot acts on behalf of the customer, so we don't run the
		// staff-auth path. Instead delegate to a dedicated internal cancel
		// (planned: a future `internalCancel` mutation that bypasses staff
		// auth for bot-originated rows). For now reject with 501 so the bot
		// surfaces a clear "not yet supported" message rather than silently
		// failing.
		return jsonResponse(
			{
				error: "Bot-originated cancellation not yet wired",
				reservationId,
				reason: body.reason,
			},
			501
		);
	}),
});

export default http;
