/**
 * WhatsApp data layer — the DB reads/writes behind the inbound pipeline.
 *
 * These run in the default Convex runtime (no `"use node"`) and are invoked
 * from the `processing` action via `ctx.runQuery` / `ctx.runMutation`, mirroring
 * the `stripe.ts` (action) ↔ `stripeHelpers.ts` (db) split.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import {
	TABLE,
	WHATSAPP_COLD_START_SCAN_LIMIT,
	WHATSAPP_CONVERSATION_STATUS,
	WHATSAPP_MESSAGE_DIRECTION,
	WHATSAPP_MESSAGE_SENDER,
	WHATSAPP_PENDING_CODE_SCAN_LIMIT,
	WHATSAPP_UNROUTED_CLAIM_TTL_MS,
	WHATSAPP_UNROUTED_PURGE_BATCH,
} from "../constants";
import type { Id } from "../_generated/dataModel";
import { isMenuLinkEnabled } from "../featureFlags";
import { redactConfirmationCodes } from "./format";
import { MAX_CONTACT_NAME_LENGTH } from "../reservationHelpers";
import { normalizeShortCode } from "./shortCode";

/** Dedupe lookup: has this Twilio MessageSid already been ingested? */
export const getMessageBySid = internalQuery({
	args: { messageSid: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.WHATSAPP_MESSAGES)
			.withIndex("by_message_sid", (q) => q.eq("messageSid", args.messageSid))
			.first();
	},
});

/**
 * Route an inbound message by the short code carried in the deep-link text.
 *
 * Takes the candidates the message yielded rather than one code, because a
 * message can contain an accidental match — the table, not the parser, decides
 * which token is a route. Candidate count is already capped by
 * `extractShortCodeCandidates`, so this is a bounded number of index lookups.
 */
export const getEnabledChannelByShortCode = internalQuery({
	args: { candidates: v.array(v.string()) },
	handler: async (ctx, args) => {
		for (const raw of args.candidates) {
			const shortCode = normalizeShortCode(raw);
			if (!shortCode) continue;
			const channel = await ctx.db
				.query(TABLE.WHATSAPP_CHANNELS)
				.withIndex("by_short_code", (q) => q.eq("shortCode", shortCode))
				.first();
			// An inactive restaurant is deliberately treated as no match at all:
			// the diner gets the same guidance as an unknown code, and learns
			// nothing about whether that restaurant exists on Tavli.
			if (channel?.isActive) {
				return { channel, matchedCode: shortCode };
			}
		}
		return null;
	},
});

/**
 * Cold start: the enabled restaurants this phone has messaged since `sinceMs`.
 *
 * Only ever used to bind a message that carried NO code, and only when the
 * answer is exactly one restaurant — see `processing.ts`. Tavli deliberately
 * does not try to match a restaurant name the diner typed: that would be an
 * enumeration and spoofing surface (ADR 012), so a phone's own recent history
 * is the only other thing allowed to route.
 */
export const getRecentRoutesForPhone = internalQuery({
	args: { customerPhone: v.string(), sinceMs: v.number() },
	handler: async (ctx, args) => {
		const recent = await ctx.db
			.query(TABLE.WHATSAPP_CONVERSATIONS)
			.withIndex("by_customer_last_inbound", (q) =>
				q.eq("customerPhone", args.customerPhone).gte("lastInboundAt", args.sinceMs)
			)
			.order("desc")
			.take(WHATSAPP_COLD_START_SCAN_LIMIT);

		const routes: { restaurantId: Id<"restaurants">; channelId: Id<"whatsappChannels"> }[] = [];
		const seen = new Set<string>();
		for (const conversation of recent) {
			if (seen.has(conversation.restaurantId)) continue;
			seen.add(conversation.restaurantId);
			const channel = await ctx.db
				.query(TABLE.WHATSAPP_CHANNELS)
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", conversation.restaurantId))
				.first();
			if (channel?.isActive) {
				routes.push({ restaurantId: conversation.restaurantId, channelId: channel._id });
			}
		}
		return routes;
	},
});

/**
 * Route by a confirmation code this phone was actually issued.
 *
 * The last resort before the fixed guidance reply, and deliberately NOT a third
 * general routing input. The assistant's own cancellation copy tells the diner
 * to "reply with this code: 481920" — six bare digits with no short code — so
 * for any diner who has talked to two restaurants that reply is otherwise
 * unroutable and the cancellation they were told to confirm silently never
 * happens (ADR 011's second-message authorization, broken by ADR 012's shared
 * number).
 *
 * This does not reopen the surface ADR 012 closes. A short code names a
 * restaurant and is printed on a table for anyone to read; this value is
 * server-minted, single-use, ten-minute-lived, and looked up by
 * (customerPhone, code) — so it can only ever bind a phone to a code Tavli
 * itself sent to that same phone. It is neither an enumeration oracle nor
 * something the diner can type their way into.
 */
export const getRouteByPendingCode = internalQuery({
	args: { customerPhone: v.string(), code: v.string() },
	handler: async (ctx, args) => {
		const now = Date.now();
		const rows = await ctx.db
			.query(TABLE.WHATSAPP_PENDING_ACTIONS)
			.withIndex("by_phone_code", (q) =>
				q.eq("customerPhone", args.customerPhone).eq("code", args.code)
			)
			.order("desc")
			.take(WHATSAPP_PENDING_CODE_SCAN_LIMIT);

		for (const row of rows) {
			// Spent and expired codes route nothing: redemption re-checks both, and
			// binding to one would only reach `internalConsumeCancelCode` to be
			// refused there.
			if (row.consumedAt !== undefined) continue;
			if (row.expiresAt <= now) continue;
			const channel = await ctx.db
				.query(TABLE.WHATSAPP_CHANNELS)
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", row.restaurantId))
				.first();
			// A restaurant switched off while the code was outstanding is off for
			// this message too — same as every other route into a disabled
			// restaurant, rather than a back door that keeps working.
			if (channel?.isActive) {
				return {
					restaurantId: row.restaurantId,
					channelId: channel._id,
					defaultLocale: channel.defaultLocale,
				};
			}
		}
		return null;
	},
});

/**
 * Claim an inbound MessageSid that resolved to no restaurant, once.
 *
 * Returns false when this SID was already claimed — a Twilio redelivery, which
 * must not be answered or charged a second time. The routed path dedupes on the
 * `whatsappMessages` row `ingestInbound` stores; an unroutable message stores
 * none by design (there is no conversation to attach it to), so this row is its
 * only dedupe. Read-then-insert inside one Convex mutation is atomic, so two
 * concurrent redeliveries cannot both claim.
 */
export const claimUnroutedMessage = internalMutation({
	args: { messageSid: v.string() },
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query(TABLE.WHATSAPP_UNROUTED_MESSAGES)
			.withIndex("by_message_sid", (q) => q.eq("messageSid", args.messageSid))
			.first();
		if (existing) return { claimed: false };
		await ctx.db.insert(TABLE.WHATSAPP_UNROUTED_MESSAGES, {
			messageSid: args.messageSid,
			createdAt: Date.now(),
		});
		return { claimed: true };
	},
});

/**
 * Reclaim unrouted-message claims older than Twilio can retry.
 *
 * These rows are dedupe scratch, not history: one per message from a phone no
 * restaurant knows, which under a flood is exactly the traffic that must not
 * leave permanent rows behind. Hourly, batched.
 */
export const purgeExpiredUnroutedClaims = internalMutation({
	args: {},
	handler: async (ctx) => {
		const stale = await ctx.db
			.query(TABLE.WHATSAPP_UNROUTED_MESSAGES)
			.withIndex("by_created", (q) =>
				q.lt("createdAt", Date.now() - WHATSAPP_UNROUTED_CLAIM_TTL_MS)
			)
			.take(WHATSAPP_UNROUTED_PURGE_BATCH);
		for (const row of stale) await ctx.db.delete(row._id);
		return { deleted: stale.length };
	},
});

/**
 * Idempotently record an inbound message: upsert the Conversation for
 * (customer phone, RESTAURANT), then append the inbound row unless its
 * MessageSid was already stored. Returns the conversation id, the resolved
 * reply locale, and whether this delivery was a duplicate (Twilio retries the
 * same MessageSid).
 *
 * Keyed on the restaurant, not the channel row (ADR 012). The diner sees one
 * continuous thread with Tavli; underneath, each restaurant gets its own
 * conversation. One interleaved thread was never an option: it would show one
 * restaurant another restaurant's messages, and would replay two restaurants'
 * menus into the model's context for a single turn.
 */
export const ingestInbound = internalMutation({
	args: {
		channelId: v.id(TABLE.WHATSAPP_CHANNELS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		customerPhone: v.string(),
		body: v.string(),
		messageSid: v.string(),
		profileName: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const now = Date.now();

		const channel = await ctx.db.get(args.channelId);

		// Clamp to what `validateCreateInputs` will accept, so a display name
		// captured here can never be the reason a later booking is rejected.
		const profileName = args.profileName?.trim().slice(0, MAX_CONTACT_NAME_LENGTH) || undefined;

		const existingConversation = await ctx.db
			.query(TABLE.WHATSAPP_CONVERSATIONS)
			.withIndex("by_restaurant_customer", (q) =>
				q.eq("restaurantId", args.restaurantId).eq("customerPhone", args.customerPhone)
			)
			.first();

		let conversationId = existingConversation?._id;
		if (!conversationId) {
			conversationId = await ctx.db.insert(TABLE.WHATSAPP_CONVERSATIONS, {
				channelId: args.channelId,
				restaurantId: args.restaurantId,
				customerPhone: args.customerPhone,
				status: WHATSAPP_CONVERSATION_STATUS.ACTIVE,
				locale: channel?.defaultLocale,
				customerName: profileName,
				lastMessageAt: now,
				lastInboundAt: now,
				createdAt: now,
				updatedAt: now,
			});
		} else {
			await ctx.db.patch(conversationId, {
				lastMessageAt: now,
				lastInboundAt: now,
				updatedAt: now,
				// The thread follows the restaurant, not the enablement row: if the
				// restaurant was disabled and re-enabled under a fresh channel, the
				// diner keeps the same conversation and this pointer catches up.
				...(existingConversation?.channelId !== args.channelId
					? { channelId: args.channelId }
					: {}),
				// Only overwrite with a real name — Twilio omits ProfileName when the
				// customer has no WhatsApp display name set, and a blank must not
				// erase one we captured earlier.
				...(profileName ? { customerName: profileName } : {}),
			});
		}

		const locale = existingConversation?.locale ?? channel?.defaultLocale;
		// Prefer the name captured on this message; fall back to one seen earlier.
		const customerName = profileName ?? existingConversation?.customerName;

		// Dedupe: a repeated MessageSid means Twilio retried an already-stored
		// delivery. Do not append a second inbound row.
		const alreadyStored = await ctx.db
			.query(TABLE.WHATSAPP_MESSAGES)
			.withIndex("by_message_sid", (q) => q.eq("messageSid", args.messageSid))
			.first();
		if (alreadyStored) {
			return { conversationId, locale, customerName, isDuplicate: true };
		}

		await ctx.db.insert(TABLE.WHATSAPP_MESSAGES, {
			conversationId,
			restaurantId: args.restaurantId,
			direction: WHATSAPP_MESSAGE_DIRECTION.INBOUND,
			messageSid: args.messageSid,
			body: args.body,
			createdAt: now,
		});

		return { conversationId, locale, customerName, isDuplicate: false };
	},
});

/**
 * Append an outbound reply to the conversation log and bump its activity time.
 *
 * `sentBy` is required, not defaulted: every send path has to say who is
 * speaking, so a new one cannot silently inherit "assistant" and put the
 * assistant's name on copy it never wrote. See `WHATSAPP_MESSAGE_SENDER`.
 */
export const recordOutbound = internalMutation({
	args: {
		conversationId: v.id(TABLE.WHATSAPP_CONVERSATIONS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		body: v.string(),
		modelBody: v.optional(v.string()),
		sentBy: v.union(
			v.literal(WHATSAPP_MESSAGE_SENDER.ASSISTANT),
			v.literal(WHATSAPP_MESSAGE_SENDER.SYSTEM),
			v.literal(WHATSAPP_MESSAGE_SENDER.STAFF)
		),
		mediaUrl: v.optional(v.string()),
		messageSid: v.optional(v.string()),
		deliveryFailedAt: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		await ctx.db.insert(TABLE.WHATSAPP_MESSAGES, {
			conversationId: args.conversationId,
			restaurantId: args.restaurantId,
			direction: WHATSAPP_MESSAGE_DIRECTION.OUTBOUND,
			messageSid: args.messageSid,
			body: args.body,
			modelBody: args.modelBody,
			sentBy: args.sentBy,
			mediaUrl: args.mediaUrl,
			deliveryFailedAt: args.deliveryFailedAt,
			createdAt: now,
		});
		await ctx.db.patch(args.conversationId, { lastMessageAt: now, updatedAt: now });
	},
});

/**
 * Last N *delivered* messages for a conversation, oldest-first, as LLM context.
 *
 * Undelivered outbound rows are excluded: a failed send (Twilio quota, outage)
 * is still logged for the message history, but replaying it would tell the model
 * it already said something the customer never received — which is how the
 * assistant ends up insisting it "already sent the menu".
 *
 * Overfetches to keep a full window of context when recent sends failed, while
 * staying bounded.
 */
export const getConversationContext = internalQuery({
	args: {
		conversationId: v.id(TABLE.WHATSAPP_CONVERSATIONS),
		limit: v.number(),
	},
	handler: async (ctx, args) => {
		const recent = await ctx.db
			.query(TABLE.WHATSAPP_MESSAGES)
			.withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
			.order("desc")
			.take(args.limit * 2);
		return (
			recent
				.filter((m) => m.deliveryFailedAt === undefined)
				// The model is shown its own words only. Outbound rows replay
				// `modelBody`, never `body`: `body` also carries the appended notice
				// lines — "✅ …", and the confirmation code — and replaying those as
				// the assistant's own prior turn taught it to write fake ✅ lines and
				// invent codes. There is deliberately no fallback to `body` for rows
				// that predate `modelBody`; one such row back in context was enough
				// to make the model fabricate a six-digit code. A row with no model
				// prose (a code confirmation, an apology) is server-composed and is
				// dropped.
				.map((m) => ({
					direction: m.direction,
					// Both directions redacted: a code the customer sent back and a code
					// the model fabricated are each a worked example it will imitate.
					body: redactConfirmationCodes(
						m.direction === WHATSAPP_MESSAGE_DIRECTION.INBOUND ? m.body : (m.modelBody ?? "")
					),
				}))
				.filter((m) => m.body.trim().length > 0)
				.slice(0, args.limit)
				.reverse()
		);
	},
});

/** Minimal restaurant context the bot needs for the system prompt and links. */
export const getRestaurantContext = internalQuery({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return null;
		return {
			name: restaurant.name,
			currency: restaurant.currency,
			defaultLanguage: restaurant.defaultLanguage ?? null,
			slug: restaurant.slug,
			timezone: restaurant.timezone ?? null,
		};
	},
});

/**
 * Which optional tools this turn may offer the model.
 *
 * Read once per inbound message, in `processing.ts`, and passed into
 * `runBotTurn` — never read from inside a tool body, where the round trip would
 * put an `await` in the middle of a once-per-turn claim (see `send_menu_link`).
 */
export const getBotFeatureFlags = internalQuery({
	args: {},
	handler: async (ctx) => ({ menuLinkEnabled: await isMenuLinkEnabled(ctx) }),
});
