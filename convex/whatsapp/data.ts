/**
 * WhatsApp data layer — the DB reads/writes behind the inbound pipeline.
 *
 * These run in the default Convex runtime (no `"use node"`) and are invoked
 * from the `processing` action via `ctx.runQuery` / `ctx.runMutation`, mirroring
 * the `stripe.ts` (action) ↔ `stripeHelpers.ts` (db) split.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { TABLE, WHATSAPP_CONVERSATION_STATUS, WHATSAPP_MESSAGE_DIRECTION } from "../constants";
import { redactConfirmationCodes } from "./format";
import { MAX_CONTACT_NAME_LENGTH } from "../reservationHelpers";
import { normalizePhone } from "./phone";

/**
 * Provision (or update) the channel that maps a WhatsApp sender number to a
 * restaurant. Idempotent on the normalized phone number. This is the backend
 * primitive a future staff/admin surface will call; for now it is invoked
 * directly (e.g. via the Convex dashboard/CLI) to onboard a pilot restaurant.
 */
export const provisionChannel = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		phoneNumber: v.string(),
		isActive: v.optional(v.boolean()),
		defaultLocale: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const phoneNumber = normalizePhone(args.phoneNumber);
		const now = Date.now();
		const existing = await ctx.db
			.query(TABLE.WHATSAPP_CHANNELS)
			.withIndex("by_phone_number", (q) => q.eq("phoneNumber", phoneNumber))
			.first();
		if (existing) {
			await ctx.db.patch(existing._id, {
				restaurantId: args.restaurantId,
				isActive: args.isActive ?? true,
				defaultLocale: args.defaultLocale,
				updatedAt: now,
			});
			return existing._id;
		}
		return await ctx.db.insert(TABLE.WHATSAPP_CHANNELS, {
			restaurantId: args.restaurantId,
			phoneNumber,
			isActive: args.isActive ?? true,
			defaultLocale: args.defaultLocale,
			createdAt: now,
			updatedAt: now,
		});
	},
});

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

/** Route an inbound message: map the Twilio "To" number to an active channel. */
export const getActiveChannelByPhone = internalQuery({
	args: { phoneNumber: v.string() },
	handler: async (ctx, args) => {
		const channel = await ctx.db
			.query(TABLE.WHATSAPP_CHANNELS)
			.withIndex("by_phone_number", (q) => q.eq("phoneNumber", args.phoneNumber))
			.first();
		if (!channel || !channel.isActive) return null;
		return channel;
	},
});

/**
 * Idempotently record an inbound message: upsert the Conversation for
 * (channel, customer), then append the inbound row unless its MessageSid was
 * already stored. Returns the conversation id, the resolved reply locale, and
 * whether this delivery was a duplicate (Twilio retries the same MessageSid).
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
			.withIndex("by_channel_customer", (q) =>
				q.eq("channelId", args.channelId).eq("customerPhone", args.customerPhone)
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

/** Append an outbound reply to the conversation log and bump its activity time. */
export const recordOutbound = internalMutation({
	args: {
		conversationId: v.id(TABLE.WHATSAPP_CONVERSATIONS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		body: v.string(),
		modelBody: v.optional(v.string()),
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
