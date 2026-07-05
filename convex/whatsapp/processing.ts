/**
 * Inbound WhatsApp processing pipeline (Milestone 1: echo).
 *
 * Scheduled by the `/whatsapp/inbound` HTTP route after the signature has been
 * verified, so it runs off the request path (Twilio's ~15s webhook timeout does
 * not bound it — later milestones add an LLM turn here). Runs in the default
 * Convex runtime: outbound send is a plain `fetch`, so no `"use node"` needed.
 *
 * Flow: dedupe on MessageSid → route the "To" number to a channel → record the
 * inbound message → send a reply → record the outbound message. Errors are
 * logged (never silently swallowed) per AC #6.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { buildIntegrationErrorLog } from "../_shared/integrationLogging";
import { normalizePhone } from "./phone";
import { sendWhatsappMessage } from "./outbound";

export const handleInboundMessage = internalAction({
	args: {
		messageSid: v.string(),
		from: v.string(),
		to: v.string(),
		body: v.string(),
	},
	handler: async (ctx, args) => {
		try {
			// Fast-path dedupe: Twilio retries deliver the same MessageSid.
			const existing = await ctx.runQuery(internal.whatsapp.data.getMessageBySid, {
				messageSid: args.messageSid,
			});
			if (existing) return;

			// Route: the "To" number identifies the restaurant's channel.
			const channel = await ctx.runQuery(internal.whatsapp.data.getActiveChannelByPhone, {
				phoneNumber: normalizePhone(args.to),
			});
			// Unknown or inactive number: not one of our channels — drop silently.
			if (!channel) return;

			const customerPhone = normalizePhone(args.from);
			const { conversationId, isDuplicate } = await ctx.runMutation(
				internal.whatsapp.data.ingestInbound,
				{
					channelId: channel._id,
					restaurantId: channel.restaurantId,
					customerPhone,
					body: args.body,
					messageSid: args.messageSid,
				}
			);
			if (isDuplicate) return;

			// M1 echo — proves the inbound → reply transport end-to-end. Replaced
			// by the LLM turn in M2.
			const reply = `✅ Received: "${args.body}". Our assistant is warming up and will be able to help you soon.`;

			const sid = await sendWhatsappMessage({ to: customerPhone, body: reply });

			await ctx.runMutation(internal.whatsapp.data.recordOutbound, {
				conversationId,
				restaurantId: channel.restaurantId,
				body: reply,
				messageSid: sid,
			});
		} catch (error) {
			console.error(
				"[whatsapp.processing]",
				buildIntegrationErrorLog(error, {
					integration: "twilio-webhook",
					operation: "handleInboundMessage",
				})
			);
		}
	},
});
