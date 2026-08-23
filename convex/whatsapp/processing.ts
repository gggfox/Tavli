"use node";

/**
 * Inbound WhatsApp processing pipeline (Milestone 2: menu Q&A).
 *
 * Scheduled by the `/whatsapp/inbound` HTTP route after the signature is
 * verified, so it runs off the request path — Twilio's ~15s webhook timeout does
 * not bound the LLM turn. Node action because the AI SDK provider (`llm.ts`)
 * runs under `"use node"`.
 *
 * Flow: dedupe on MessageSid → resolve the restaurant → record inbound → redeem
 * a confirmation code if the body carries one → otherwise run the LLM turn →
 * send the reply (model prose plus server-composed fact lines) → record
 * outbound. Any failure sends a fixed localized apology — never a silent
 * failure (AC #6).
 *
 * **Routing (ADR 012).** Tavli is the sender on one shared number, so the
 * Twilio "To" identifies nobody. The restaurant comes from the short code in
 * the wa.me deep-link text; failing that, from this phone's own recent history,
 * but only when that history names exactly one restaurant. Anything else gets a
 * fixed reply with no model call — Tavli deliberately does NOT try to match a
 * restaurant name the diner typed against every restaurant it knows, because
 * that is an enumeration and spoofing surface.
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
	WHATSAPP_COLD_START_WINDOW_MS,
	WHATSAPP_CONFIRMATION_CODE_DIGITS,
	WHATSAPP_CONTEXT_MESSAGE_LIMIT,
	WHATSAPP_MAX_OUTBOUND_BODY_CHARS,
	WHATSAPP_MAX_REPLY_PARTS,
} from "../constants";
import { getBotCopy, getUnroutableGuidance, resolveLocale } from "./copy";
import { formatLocalDateTime } from "./datetime";
import { splitOutboundBody } from "./format";
import { runBotTurn } from "./llm";
import { sendWhatsappMessage } from "./outbound";
import { normalizePhone, toCanonicalE164 } from "./phone";
import { extractShortCodeCandidates, stripShortCode } from "./shortCode";

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

/**
 * Which restaurant this message is for, and the body with the routing token
 * removed.
 *
 * Two inputs, in order, and no third. The short code in the deep-link text is
 * the primary route. Its absence falls back to this phone's own recent history,
 * and only when that history names exactly one enabled restaurant — two
 * restaurants is genuinely ambiguous, and picking the most recent would silently
 * send a diner's question to the wrong kitchen.
 */
async function resolveRoute(
	ctx: ActionCtx,
	args: { body: string; customerPhone: string }
): Promise<{
	restaurantId: Id<"restaurants">;
	channelId: Id<"whatsappChannels">;
	defaultLocale?: string;
	body: string;
} | null> {
	const candidates = extractShortCodeCandidates(args.body);
	if (candidates.length > 0) {
		const match = await ctx.runQuery(internal.whatsapp.data.getEnabledChannelByShortCode, {
			candidates,
		});
		if (match) {
			return {
				restaurantId: match.channel.restaurantId,
				channelId: match.channel._id,
				defaultLocale: match.channel.defaultLocale,
				// Stripped only now that the token has actually resolved: a word that
				// merely looked like a code stays in the diner's own words.
				body: stripShortCode(args.body, match.matchedCode),
			};
		}
		// An unrecognized code is not an error the diner can act on — fall through
		// to the same cold-start path a codeless message takes.
	}

	const routes = await ctx.runQuery(internal.whatsapp.data.getRecentRoutesForPhone, {
		customerPhone: args.customerPhone,
		sinceMs: Date.now() - WHATSAPP_COLD_START_WINDOW_MS,
	});
	if (routes.length !== 1) return null;
	return { ...routes[0], body: args.body };
}

export const handleInboundMessage = internalAction({
	args: {
		messageSid: v.string(),
		from: v.string(),
		body: v.string(),
		profileName: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		// Fast-path dedupe: Twilio retries deliver the same MessageSid.
		const existing = await ctx.runQuery(internal.whatsapp.data.getMessageBySid, {
			messageSid: args.messageSid,
		});
		if (existing) return;

		// Two different things, deliberately kept apart. `replyAddress` is the
		// transport address Twilio used and is the only thing safe to send to;
		// `customerPhone` is the canonical E.164 identity everything else keys on
		// (see `toCanonicalE164` — WhatsApp's Mexican mobiles carry a legacy 1 that
		// would otherwise fork one human into two customers).
		const replyAddress = normalizePhone(args.from);
		const customerPhone = toCanonicalE164(args.from);

		const route = await resolveRoute(ctx, { body: args.body, customerPhone });
		if (!route) {
			// Nothing to attach this to — no restaurant means no conversation and no
			// row to record against, so this send is deliberately unlogged. It is a
			// fixed string and NOT a model call: an unroutable message is exactly the
			// case where there is no menu, no restaurant name and no locale to ground
			// a model in, and spending a turn guessing is how a first responder
			// starts inventing restaurants.
			await sendWhatsappMessage({ to: replyAddress, body: getUnroutableGuidance() });
			return;
		}

		const {
			conversationId,
			locale: conversationLocale,
			isDuplicate,
		} = await ctx.runMutation(internal.whatsapp.data.ingestInbound, {
			channelId: route.channelId,
			restaurantId: route.restaurantId,
			customerPhone,
			body: route.body,
			messageSid: args.messageSid,
			profileName: args.profileName,
		});
		if (isDuplicate) return;

		const restaurant = await ctx.runQuery(internal.whatsapp.data.getRestaurantContext, {
			restaurantId: route.restaurantId,
		});
		const locale = resolveLocale(
			conversationLocale,
			route.defaultLocale,
			restaurant?.defaultLanguage
		);

		// The whole message was the routing code — the diner opened the deep link
		// and deleted the sentence. There is no question to answer, and an empty
		// turn would leave the model with no user message at all, so greet them
		// from fixed copy instead of spending a model call on nothing.
		if (!route.body.trim()) {
			await sendAndRecord(ctx, {
				conversationId,
				restaurantId: route.restaurantId,
				to: replyAddress,
				body: getBotCopy(locale).deepLinkWelcome(restaurant?.name ?? "Tavli"),
				modelBody: "",
			});
			return;
		}

		// Confirmation codes are matched HERE, before the model is involved at all.
		// The authorization decision for a destructive action is therefore a string
		// comparison against a server-generated, single-use, expiring value — not a
		// language-understanding problem. Injected text (forwarded messages, a
		// poisoned menu description, an instruction stored in history) can steer one
		// turn's tool calls, but none of it can produce this second inbound message.
		const code = extractConfirmationCode(route.body);
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
					restaurantId: route.restaurantId,
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
				{ restaurantId: route.restaurantId }
			);

			const result = await runBotTurn(ctx, {
				// Built here, from the Twilio-verified webhook fields, and frozen. The
				// assistant's identity must not be derivable from anything the model or
				// the customer's text can influence.
				actor: Object.freeze({
					restaurantId: route.restaurantId,
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
				restaurantId: route.restaurantId,
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
				restaurantId: route.restaurantId,
				to: replyAddress,
				body: getBotCopy(locale).genericError,
				modelBody: "",
			});
		}
	},
});
