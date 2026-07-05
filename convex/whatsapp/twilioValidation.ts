"use node";

/**
 * Inbound Twilio signature verification.
 *
 * The `twilio` SDK depends on Node's `crypto`, so it can only be imported from a
 * `"use node"` module — which cannot host the HTTP router. The `/whatsapp/inbound`
 * route therefore awaits this lightweight action to verify `X-Twilio-Signature`
 * before it schedules any processing, giving us a synchronous 403 on forged
 * requests while keeping the (slow) LLM turn off the request path.
 *
 * Twilio computes the signature over the exact public webhook URL plus the POST
 * params. Behind a proxy, `request.url` may not match what Twilio signed, so we
 * prefer an explicitly-configured `TWILIO_WEBHOOK_URL` when present.
 */
import twilio from "twilio";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";

export const validateTwilioRequest = internalAction({
	args: {
		url: v.string(),
		params: v.record(v.string(), v.string()),
		signature: v.string(),
	},
	handler: async (_ctx, args) => {
		const authToken = process.env.TWILIO_AUTH_TOKEN;
		if (!authToken) {
			console.warn("[whatsapp.validate] TWILIO_AUTH_TOKEN missing; rejecting inbound request.");
			return false;
		}
		const url = process.env.TWILIO_WEBHOOK_URL ?? args.url;
		return twilio.validateRequest(authToken, args.signature, url, args.params);
	},
});
