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
import {
	WHATSAPP_CONFIRMATION_CODE_DIGITS,
	WHATSAPP_CONTEXT_MESSAGE_LIMIT,
	WHATSAPP_MAX_OUTBOUND_BODY_CHARS,
	WHATSAPP_MAX_REPLY_PARTS,
} from "../constants";
import { getBotCopy, resolveLocale } from "./copy";
import { formatLocalDateTime } from "./datetime";
import { splitOutboundBody } from "./format";
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
		/** The model's own prose, without the appended notices. "" = none. */
		modelBody: string;
		mediaUrl?: string;
	}
): Promise<void> {
	// A reply longer than one WhatsApp message becomes several, in order. Any
	// media rides on the first part only — repeating it would send the customer
	// the same dish photo once per chunk.
	const parts = splitOutboundBody(
		args.body,
		WHATSAPP_MAX_OUTBOUND_BODY_CHARS,
		WHATSAPP_MAX_REPLY_PARTS
	);
	for (const [index, body] of parts.entries()) {
		const mediaUrl = index === 0 ? args.mediaUrl : undefined;
		// Only the first part carries the model's prose: the notices are appended
		// after it, so every later part is server-composed by construction.
		const modelBody = index === 0 ? args.modelBody : "";
		const sid = await sendWhatsappMessage({ to: args.to, body, mediaUrl });
		await ctx.runMutation(internal.whatsapp.data.recordOutbound, {
			conversationId: args.conversationId,
			restaurantId: args.restaurantId,
			body,
			modelBody,
			mediaUrl,
			messageSid: sid,
			// `sendWhatsappMessage` never throws; a missing SID is how it reports failure.
			deliveryFailedAt: sid ? undefined : Date.now(),
		});
		// A failed part means the rest will fail too (bad number, closed window);
		// stop rather than logging three identical failures.
		if (!sid) break;
	}
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
			const applied = outcome.cancelled || outcome.rescheduled;
			if (applied || outcome.reason !== "ERROR_CODE_NOT_FOUND") {
				const copy = getBotCopy(locale);
				const when = (ms: number) =>
					formatLocalDateTime(ms, restaurant?.timezone ?? undefined, locale);
				let body: string;
				if (outcome.rescheduled) {
					body = copy.rescheduleConfirmed(when(outcome.startsAt));
				} else if (outcome.cancelled) {
					body = copy.cancelConfirmed(when(outcome.startsAt));
				} else if (outcome.kind === "reschedule") {
					// The code was good; the slot went while it was outstanding. Say
					// exactly that, because "invalid code" would send the customer round
					// the loop again for a booking that never changed.
					body = copy.rescheduleNoLongerAvailable;
				} else {
					body = copy.cancelCodeInvalid;
				}
				await sendAndRecord(ctx, {
					conversationId,
					restaurantId: channel.restaurantId,
					to: replyAddress,
					body,
					// Entirely server-composed: the model was never consulted for the
					// authorization decision and must not be shown this as its own line.
					modelBody: "",
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
			// Resolved here, once, rather than inside `send_menu_link`: the tool's
			// once-per-turn claim must not sit across an await (the AI SDK runs a
			// step's tool calls concurrently), and the slug is already in hand from
			// `getRestaurantContext` above.
			const { menuLinkEnabled } = await ctx.runQuery(internal.whatsapp.data.getBotFeatureFlags, {});

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
				// Absent unless the menu page is actually reachable by the diner who
				// receives the link — see `isMenuLinkEnabled`. Absent also disarms
				// the tool: `runBotTurn` does not register it.
				menuLinkSlug: menuLinkEnabled ? (restaurant?.slug ?? undefined) : undefined,
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
				modelBody: result.text,
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
				modelBody: "",
			});
		}
	},
});
