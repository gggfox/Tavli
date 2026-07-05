"use node";

/**
 * Inbound WhatsApp processing pipeline (Milestone 2: menu Q&A).
 *
 * Scheduled by the `/whatsapp/inbound` HTTP route after the signature is
 * verified, so it runs off the request path — Twilio's ~15s webhook timeout does
 * not bound the LLM turn. Node action because the AI SDK provider (`llm.ts`)
 * runs under `"use node"`.
 *
 * Flow: dedupe on MessageSid → route "To" → channel → record inbound → run the
 * LLM turn (read-only menu tools) → send the reply (with an optional dish photo)
 * → record outbound. Any failure sends a fixed localized apology — never a silent
 * failure (AC #6).
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { buildIntegrationErrorLog } from "../_shared/integrationLogging";
import { WHATSAPP_CONTEXT_MESSAGE_LIMIT } from "../constants";
import { getBotCopy, resolveLocale } from "./copy";
import { runBotTurn } from "./llm";
import { sendWhatsappMessage } from "./outbound";
import { normalizePhone } from "./phone";

export const handleInboundMessage = internalAction({
	args: {
		messageSid: v.string(),
		from: v.string(),
		to: v.string(),
		body: v.string(),
	},
	handler: async (ctx, args) => {
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
		const {
			conversationId,
			locale: conversationLocale,
			isDuplicate,
		} = await ctx.runMutation(internal.whatsapp.data.ingestInbound, {
			channelId: channel._id,
			restaurantId: channel.restaurantId,
			customerPhone,
			body: args.body,
			messageSid: args.messageSid,
		});
		if (isDuplicate) return;

		const restaurant = await ctx.runQuery(internal.whatsapp.data.getRestaurantContext, {
			restaurantId: channel.restaurantId,
		});
		const locale = resolveLocale(
			conversationLocale,
			channel.defaultLocale,
			restaurant?.defaultLanguage
		);

		try {
			const history = await ctx.runQuery(internal.whatsapp.data.getConversationContext, {
				conversationId,
				limit: WHATSAPP_CONTEXT_MESSAGE_LIMIT,
			});

			const result = await runBotTurn(ctx, {
				restaurantId: channel.restaurantId,
				restaurantName: restaurant?.name ?? "the restaurant",
				locale,
				history,
			});

			const text = result.text || getBotCopy(locale).genericError;
			const sid = await sendWhatsappMessage({
				to: customerPhone,
				body: text,
				mediaUrl: result.mediaUrl,
			});
			await ctx.runMutation(internal.whatsapp.data.recordOutbound, {
				conversationId,
				restaurantId: channel.restaurantId,
				body: text,
				mediaUrl: result.mediaUrl,
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
			// Never fail silently — send a fixed localized apology (AC #6).
			const fallback = getBotCopy(locale).genericError;
			const sid = await sendWhatsappMessage({ to: customerPhone, body: fallback });
			await ctx.runMutation(internal.whatsapp.data.recordOutbound, {
				conversationId,
				restaurantId: channel.restaurantId,
				body: fallback,
				messageSid: sid,
			});
		}
	},
});
