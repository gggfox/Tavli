// =============================================================================
// HTTP Router — Stripe Webhook Endpoints
// =============================================================================
//
// This module registers HTTP routes that Stripe calls when events occur.
// There are two separate endpoints because they handle different event formats:
//
// 1. POST /stripe/webhook
//    Standard webhook for payment events (payment_intent.succeeded,
//    payment_intent.payment_failed, charge.refunded, charge.dispute.created,
//    charge.dispute.closed, account.updated). These are "fat" events containing
//    the full event payload. Refund/dispute events land here (not the connect
//    endpoint) because destination charges settle on the platform account.
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
import { httpAction } from "./_generated/server";
import { ERROR_NAMES } from "./_shared/errors";
import { buildIntegrationErrorLog } from "./_shared/integrationLogging";
import { RESERVATION_SOURCE } from "./constants";
import { clampInboundBody } from "./whatsapp/format";

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
			console.error(
				"[http.stripe/webhook]",
				buildIntegrationErrorLog(error, {
					integration: "stripe-webhook",
					operation: "POST /stripe/webhook",
				})
			);
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
			console.error(
				"[http.stripe/connect-webhook]",
				buildIntegrationErrorLog(error, {
					integration: "stripe-connect-webhook",
					operation: "POST /stripe/connect-webhook",
				})
			);
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
// Each route runs the same four steps: check the token, parse and type-validate
// the body, resolve the restaurant id through `normalizeRestaurantId`, then
// delegate to the same internal mutations the UI uses. Everything past the token
// check is attacker-controlled, so failures come back as 4xx with a stable code
// and thrown errors are logged and answered with an opaque 500 -- never echoed.
// Idempotency is supported on create via the `Idempotency-Key` header.
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

function notFoundResponse(message: string): Response {
	return new Response(JSON.stringify({ error: message }), {
		status: 404,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Opaque 500. Bot routes must never echo a thrown error: Convex validator
 * failures carry the full argument shape, which is internal detail.
 */
function serverErrorResponse(): Response {
	return new Response(JSON.stringify({ error: ERROR_NAMES.INTERNAL_SERVER_ERROR }), {
		status: 500,
		headers: { "Content-Type": "application/json" },
	});
}

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const MIN_RESERVATIONS_BOT_TOKEN_LENGTH = 32;

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function isAuthorizedBotRequest(request: Request): Promise<boolean> {
	const expected = process.env.RESERVATIONS_BOT_TOKEN;
	if (!expected || expected.length < MIN_RESERVATIONS_BOT_TOKEN_LENGTH) return false;
	const header = request.headers.get("authorization");
	if (!header) return false;
	const [scheme, token] = header.split(" ");
	if (scheme !== "Bearer" || !token) return false;
	const [providedHash, expectedHash] = await Promise.all([sha256Hex(token), sha256Hex(expected)]);
	if (providedHash.length !== expectedHash.length) return false;
	let mismatch = 0;
	for (let i = 0; i < providedHash.length; i++) {
		mismatch |= providedHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
	}
	return mismatch === 0;
}

// -----------------------------------------------------------------------------
// Input validation
// -----------------------------------------------------------------------------
//
// Everything past the token check is attacker-controlled. Presence checks are
// not enough: `partySize: "5"` is truthy, and a `restaurantId` of `"nope"` cast
// with `as Id<...>` reaches the arg validator and throws a 500 whose message
// spells out the internal argument shape. Validate types here, resolve ids via
// `reservations.normalizeRestaurantId`, and keep failures as clean 4xx.

const BOT_INTEGRATION = "reservations-bot";

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Epoch-ms timestamp: finite, and an integer so `Date` math stays exact. */
function isTimestamp(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

type BookingFields = { restaurantId: string; partySize: number; startsAt: number };

function parseBookingFields(body: unknown): ParseResult<BookingFields> {
	if (!isJsonObject(body)) return { ok: false, message: "Body must be a JSON object" };
	if (!isNonEmptyString(body.restaurantId)) {
		return { ok: false, message: "restaurantId must be a non-empty string" };
	}
	if (!isPositiveInteger(body.partySize)) {
		return { ok: false, message: "partySize must be a positive integer" };
	}
	if (!isTimestamp(body.startsAt)) {
		return { ok: false, message: "startsAt must be an epoch-ms integer" };
	}
	return {
		ok: true,
		value: { restaurantId: body.restaurantId, partySize: body.partySize, startsAt: body.startsAt },
	};
}

type CreateFields = BookingFields & {
	contact: { name: string; phone: string; email?: string };
	notes?: string;
};

function parseCreateBody(body: unknown): ParseResult<CreateFields> {
	const booking = parseBookingFields(body);
	if (!booking.ok) return booking;
	// `parseBookingFields` already proved this is a JSON object.
	const raw = body as Record<string, unknown>;

	if (!isJsonObject(raw.contact)) return { ok: false, message: "contact must be a JSON object" };
	const { name, phone, email } = raw.contact;
	if (!isNonEmptyString(name)) {
		return { ok: false, message: "contact.name must be a non-empty string" };
	}
	if (!isNonEmptyString(phone)) {
		return { ok: false, message: "contact.phone must be a non-empty string" };
	}
	if (email !== undefined && typeof email !== "string") {
		return { ok: false, message: "contact.email must be a string when present" };
	}
	if (raw.notes !== undefined && typeof raw.notes !== "string") {
		return { ok: false, message: "notes must be a string when present" };
	}

	return {
		ok: true,
		value: {
			...booking.value,
			contact: { name, phone, email: email === undefined ? undefined : email },
			notes: raw.notes as string | undefined,
		},
	};
}

async function readJsonBody(request: Request): Promise<ParseResult<unknown>> {
	try {
		return { ok: true, value: await request.json() };
	} catch {
		return { ok: false, message: "Invalid JSON body" };
	}
}

function logBotError(operation: string, error: unknown): void {
	console.error(
		`[http.${operation}]`,
		buildIntegrationErrorLog(error, { integration: BOT_INTEGRATION, operation })
	);
}

http.route({
	path: "/api/v1/reservations/availability",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!(await isAuthorizedBotRequest(request))) return unauthorizedResponse();

		const body = await readJsonBody(request);
		if (!body.ok) return badRequestResponse(body.message);
		const parsed = parseBookingFields(body.value);
		if (!parsed.ok) return badRequestResponse(parsed.message);

		try {
			const restaurantId = await ctx.runQuery(internal.reservations.normalizeRestaurantId, {
				candidateId: parsed.value.restaurantId,
			});
			if (!restaurantId) return notFoundResponse(ERROR_NAMES.NOT_FOUND);

			const result = await ctx.runQuery(api.reservations.getAvailability, {
				restaurantId,
				partySize: parsed.value.partySize,
				startsAt: parsed.value.startsAt,
			});
			return jsonResponse(result);
		} catch (error) {
			logBotError("POST /api/v1/reservations/availability", error);
			return serverErrorResponse();
		}
	}),
});

http.route({
	path: "/api/v1/reservations",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!(await isAuthorizedBotRequest(request))) return unauthorizedResponse();

		const body = await readJsonBody(request);
		if (!body.ok) return badRequestResponse(body.message);
		const parsed = parseCreateBody(body.value);
		if (!parsed.ok) return badRequestResponse(parsed.message);

		const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
		try {
			const restaurantId = await ctx.runQuery(internal.reservations.normalizeRestaurantId, {
				candidateId: parsed.value.restaurantId,
			});
			if (!restaurantId) return notFoundResponse(ERROR_NAMES.NOT_FOUND);

			const [reservationId, error] = await ctx.runMutation(internal.reservations.internalCreate, {
				restaurantId,
				partySize: parsed.value.partySize,
				startsAt: parsed.value.startsAt,
				contact: parsed.value.contact,
				source: RESERVATION_SOURCE.WHATSAPP,
				notes: parsed.value.notes,
				idempotencyKey,
			});
			if (error) {
				const status =
					error.name === ERROR_NAMES.NOT_FOUND
						? 404
						: error.name === ERROR_NAMES.RATE_LIMITED
							? 429
							: 409;
				// Rebuild rather than echo: these objects can carry extra fields
				// (e.g. validation `fields`), and the bot contract is the code.
				return jsonResponse({ error: { name: error.name, message: error.message } }, status);
			}
			return jsonResponse({ reservationId }, 201);
		} catch (error) {
			logBotError("POST /api/v1/reservations", error);
			return serverErrorResponse();
		}
	}),
});

// Cancellation is keyed on the customer's phone number, never on a reservation
// id in the path. An id-in-path route would hand callers a capability they can
// forge or enumerate — and the create route already leaks ids to anyone who
// guesses an `Idempotency-Key`. Resolving server-side from `(restaurantId,
// phone)` means there is nothing to forge. The previous `/cancel/<id>` prefix
// route is gone; it only ever returned 501.
http.route({
	path: "/api/v1/reservations/cancel",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!(await isAuthorizedBotRequest(request))) return unauthorizedResponse();

		const body = await readJsonBody(request);
		if (!body.ok) return badRequestResponse(body.message);
		const payload = body.value as Record<string, unknown>;

		if (typeof payload.restaurantId !== "string" || !payload.restaurantId) {
			return badRequestResponse("restaurantId is required");
		}
		if (typeof payload.phone !== "string" || !payload.phone.trim()) {
			return badRequestResponse("phone is required");
		}
		if (
			payload.startsAt !== undefined &&
			(typeof payload.startsAt !== "number" || !Number.isInteger(payload.startsAt))
		) {
			return badRequestResponse("startsAt must be an integer timestamp");
		}

		try {
			const restaurantId = await ctx.runQuery(internal.reservations.normalizeRestaurantId, {
				candidateId: payload.restaurantId,
			});
			if (!restaurantId) return notFoundResponse(ERROR_NAMES.NOT_FOUND);

			const [reservation, error] = await ctx.runMutation(
				internal.reservations.internalCancelByPhone,
				{
					restaurantId,
					phone: payload.phone,
					startsAt: payload.startsAt as number | undefined,
				}
			);
			if (error) {
				const status = error.name === ERROR_NAMES.NOT_FOUND ? 404 : 409;
				// Rebuild rather than echo, as on the create route.
				return jsonResponse({ error: { name: error.name, message: error.message } }, status);
			}
			// Echo only what the caller needs to confirm the right booking was
			// withdrawn — no contact details, no id.
			return jsonResponse({
				cancelled: true,
				startsAt: reservation.startsAt,
				partySize: reservation.partySize,
			});
		} catch (error) {
			logBotError("POST /api/v1/reservations/cancel", error);
			return serverErrorResponse();
		}
	}),
});

// =============================================================================
// WhatsApp Inbound Webhook (Twilio) — see ADR 007
// =============================================================================
//
// Twilio POSTs inbound WhatsApp messages here as `application/x-www-form-
// urlencoded` (not JSON). We verify `X-Twilio-Signature` via a Node action
// (the `twilio` SDK needs Node's crypto and can't be imported into this default-
// runtime router), reject forged requests with 403, then fast-ack with empty
// TwiML and process the message asynchronously — the reply is sent out-of-band
// via the REST API, keeping us under Twilio's ~15s webhook timeout.
//
// Configure the Twilio sandbox/sender webhook to:
//   https://<deployment>.convex.site/whatsapp/inbound

http.route({
	path: "/whatsapp/inbound",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const signature = request.headers.get("x-twilio-signature");
		if (!signature) {
			return new Response("Missing X-Twilio-Signature header", { status: 400 });
		}

		const rawBody = await request.text();
		const params = Object.fromEntries(new URLSearchParams(rawBody).entries());

		let valid = false;
		try {
			valid = await ctx.runAction(internal.whatsapp.twilioValidation.validateTwilioRequest, {
				url: request.url,
				params,
				signature,
			});
		} catch (error) {
			console.error(
				"[http.whatsapp/inbound]",
				buildIntegrationErrorLog(error, {
					integration: "twilio-webhook",
					operation: "POST /whatsapp/inbound",
				})
			);
			return new Response("Webhook handler failed", { status: 400 });
		}
		if (!valid) {
			return new Response("Invalid signature", { status: 403 });
		}

		// A validly-signed Twilio message always carries these fields.
		if (!params.MessageSid || !params.From || !params.To) {
			return badRequestResponse("MessageSid, From, and To are required");
		}

		// Require the WhatsApp channel prefix. `normalizePhone` strips it, and the
		// bare number downstream is the assistant's only proof of identity — so if
		// this number's SMS webhook ever pointed here too, a spoofed SMS caller ID
		// would normalize to the same string and impersonate a WhatsApp customer.
		// A WhatsApp account is a credential; inbound SMS caller ID is not.
		if (!/^whatsapp:/i.test(params.From)) {
			return badRequestResponse("From must be a whatsapp: address");
		}

		await ctx.scheduler.runAfter(0, internal.whatsapp.processing.handleInboundMessage, {
			messageSid: params.MessageSid,
			from: params.From,
			to: params.To,
			body: clampInboundBody(params.Body ?? ""),
			profileName: params.ProfileName,
		});

		return new Response("<Response></Response>", {
			status: 200,
			headers: { "Content-Type": "text/xml" },
		});
	}),
});

export default http;
