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
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

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

export default http;
