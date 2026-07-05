/**
 * Outbound WhatsApp send via the Twilio REST API.
 *
 * Uses a plain `fetch` (like the Resend email path in `inviteActions.ts`) so it
 * runs in the default Convex runtime — no `"use node"` needed. The `twilio`
 * package is reserved for inbound signature verification only (see
 * `twilioValidation.ts`), keeping the Node dependency off this hot path.
 */
import { buildIntegrationErrorLog } from "../_shared/integrationLogging";
import { toWhatsappAddress } from "./phone";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

export type SendWhatsappMessageArgs = {
	/** Customer address in E.164 (with or without the `whatsapp:` prefix). */
	to: string;
	body: string;
	/** Optional publicly-fetchable media URL (e.g. a dish photo). */
	mediaUrl?: string;
};

/**
 * Sends a WhatsApp message and returns the Twilio message SID, or `undefined`
 * if configuration is missing or the send failed. Never throws — failures are
 * logged (redacted) and surfaced as a missing SID so the caller can decide.
 */
export async function sendWhatsappMessage(
	args: SendWhatsappMessageArgs
): Promise<string | undefined> {
	const accountSid = process.env.TWILIO_ACCOUNT_SID;
	const authToken = process.env.TWILIO_AUTH_TOKEN;
	const from = process.env.TWILIO_WHATSAPP_NUMBER;

	if (!accountSid || !authToken || !from) {
		console.warn(
			"[whatsapp.outbound] TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_NUMBER missing; skipping send."
		);
		return undefined;
	}

	const form = new URLSearchParams({
		To: toWhatsappAddress(args.to),
		From: toWhatsappAddress(from),
		Body: args.body,
	});
	if (args.mediaUrl) form.set("MediaUrl", args.mediaUrl);

	const res = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`, {
		method: "POST",
		headers: {
			Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: form.toString(),
	});

	if (!res.ok) {
		let message = `Twilio send failed (${res.status})`;
		try {
			const parsed = (await res.json()) as { message?: string; code?: number };
			if (parsed.message) message = parsed.message.slice(0, 200);
		} catch {
			// Do not log raw response bodies.
		}
		console.error(
			"[whatsapp.outbound]",
			buildIntegrationErrorLog(new Error(message), {
				integration: "twilio-send",
				operation: "sendWhatsappMessage",
				httpStatus: res.status,
			})
		);
		return undefined;
	}

	const payload = (await res.json()) as { sid?: string };
	return payload.sid;
}
