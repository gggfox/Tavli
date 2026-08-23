"use node";

/**
 * Inbound WhatsApp processing pipeline (Milestone 2: menu Q&A).
 *
 * Scheduled by the `/whatsapp/inbound` HTTP route after the signature is
 * verified, so it runs off the request path — Twilio's ~15s webhook timeout does
 * not bound the LLM turn. Node action because the AI SDK provider (`llm.ts`)
 * runs under `"use node"`.
 *
 * Flow: dedupe on MessageSid → route "To" → channel → record inbound → redeem a
 * confirmation code if the body carries one → otherwise run the LLM turn → send
 * the reply (model prose plus server-composed fact lines) → record outbound. Any
 * failure sends a fixed localized apology — never a silent failure (AC #6).
 *
 * The confirmation-code check deliberately sits BEFORE the LLM: authorizing a
 * cancellation must not depend on the model reading intent correctly.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { buildIntegrationErrorLog } from "../_shared/integrationLogging";
import { WHATSAPP_CONFIRMATION_CODE_DIGITS, WHATSAPP_CONTEXT_MESSAGE_LIMIT } from "../constants";
import { getBotCopy, resolveLocale } from "./copy";
import { formatLocalDateTime } from "./datetime";
import { clampOutboundBody } from "./format";
import { runBotTurn } from "./llm";
import { sendWhatsappMessage } from "./outbound";
import { normalizePhone, toCanonicalE164 } from "./phone";

/**
 * Pull a confirmation code out of a raw inbound body.
 *
 * Accepts a bare code, or one with surrounding words, so "CANCEL 481920",
 * "481920" and "el código es 481920" all work — customers do not follow
 * instructions precisely. Requires the exact digit count so a party size ("4")
 * or a phone number is never mistaken for a code.
 */
export function extractConfirmationCode(body: string): string | null {
	const matches = body.match(
		new RegExp(`(?<!\\d)\\d{${WHATSAPP_CONFIRMATION_CODE_DIGITS}}(?!\\d)`, "g")
	);
	// Exactly one candidate, or we cannot tell which was meant.
	return matches?.length === 1 ? matches[0] : null;
}

/**
 * Send a reply and record it, clamped, with delivery failure marked.
 *
 * Every outbound path goes through here so the clamp and the `deliveryFailedAt`
 * bookkeeping can't be forgotten on a new branch — the reason the assistant used
 * to insist it had already sent a menu it never delivered.
 */
async function sendAndRecord(
	ctx: ActionCtx,
	args: {
		conversationId: Id<"whatsappConversations">;
		restaurantId: Id<"restaurants">;
		to: string;
		body: string;
		mediaUrl?: string;
	}
): Promise<void> {
	const body = clampOutboundBody(args.body);
	const sid = await sendWhatsappMessage({ to: args.to, body, mediaUrl: args.mediaUrl });
	await ctx.runMutation(internal.whatsapp.data.recordOutbound, {
		conversationId: args.conversationId,
		restaurantId: args.restaurantId,
		body,
		mediaUrl: args.mediaUrl,
		messageSid: sid,
		// `sendWhatsappMessage` never throws; a missing SID is how it reports failure.
		deliveryFailedAt: sid ? undefined : Date.now(),
	});
}

export const handleInboundMessage = internalAction({
	args: {
		messageSid: v.string(),
		from: v.string(),
		to: v.string(),
		body: v.string(),
		profileName: v.optional(v.string()),
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

		// Two different things, deliberately kept apart. `replyAddress` is the
		// transport address Twilio used and is the only thing safe to send to;
		// `customerPhone` is the canonical E.164 identity everything else keys on
		// (see `toCanonicalE164` — WhatsApp's Mexican mobiles carry a legacy 1 that
		// would otherwise fork one human into two customers).
		const replyAddress = normalizePhone(args.from);
		const customerPhone = toCanonicalE164(args.from);
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
			profileName: args.profileName,
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

		// Confirmation codes are matched HERE, before the model is involved at all.
		// The authorization decision for a destructive action is therefore a string
		// comparison against a server-generated, single-use, expiring value — not a
		// language-understanding problem. Injected text (forwarded messages, a
		// poisoned menu description, an instruction stored in history) can steer one
		// turn's tool calls, but none of it can produce this second inbound message.
		const code = extractConfirmationCode(args.body);
		if (code) {
			const outcome = await ctx.runMutation(
				internal.whatsapp.reservations.internalConsumeCancelCode,
				{ conversationId, phone: customerPhone, code }
			);
			if (outcome.cancelled || outcome.reason !== "ERROR_CODE_NOT_FOUND") {
				const copy = getBotCopy(locale);
				const body = outcome.cancelled
					? copy.cancelConfirmed(
							formatLocalDateTime(outcome.startsAt, restaurant?.timezone ?? undefined, locale)
						)
					: copy.cancelCodeInvalid;
				await sendAndRecord(ctx, {
					conversationId,
					restaurantId: channel.restaurantId,
					to: replyAddress,
					body,
				});
				return;
			}
			// Not one of our codes — fall through and let the model answer normally,
			// since a bare number is just as likely to be a party size.
		}

		try {
			const history = await ctx.runQuery(internal.whatsapp.data.getConversationContext, {
				conversationId,
				limit: WHATSAPP_CONTEXT_MESSAGE_LIMIT,
			});
			const bookingContext = await ctx.runQuery(
				internal.whatsapp.reservations.internalGetBookingContextForBot,
				{ restaurantId: channel.restaurantId }
			);

			const result = await runBotTurn(ctx, {
				// Built here, from the Twilio-verified webhook fields, and frozen. The
				// assistant's identity must not be derivable from anything the model or
				// the customer's text can influence.
				actor: Object.freeze({
					restaurantId: channel.restaurantId,
					customerPhone,
					conversationId,
					messageSid: args.messageSid,
				}),
				restaurantName: restaurant?.name ?? "the restaurant",
				locale,
				timezone: restaurant?.timezone ?? undefined,
				bookingContext,
				history,
			});

			// Server-composed facts go last, after the model's prose. A reply that
			// says "your booking is cancelled" when it is not is worse than the
			// mutation itself, because the customer acts on the wrong belief.
			const composed = [result.text, ...result.notices].filter(Boolean).join("\n\n");
			await sendAndRecord(ctx, {
				conversationId,
				restaurantId: channel.restaurantId,
				to: replyAddress,
				body: composed || getBotCopy(locale).genericError,
				mediaUrl: result.mediaUrl,
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
			await sendAndRecord(ctx, {
				conversationId,
				restaurantId: channel.restaurantId,
				to: replyAddress,
				body: getBotCopy(locale).genericError,
			});
		}
	},
});
