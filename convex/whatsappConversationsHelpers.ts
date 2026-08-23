/**
 * Pure shaping for the staff WhatsApp conversation view (TAVLI-93).
 *
 * Kept out of `whatsappConversations.ts` so the projections — which decide what
 * a staff member is allowed to see — can be asserted without a database, and so
 * there is exactly one place that answers "what leaves the server".
 */
import type { Doc } from "./_generated/dataModel";
import {
	WHATSAPP_CONVERSATION_MAX_MESSAGES,
	WHATSAPP_CONVERSATION_PAGE_SIZE,
	WHATSAPP_MESSAGE_DIRECTION,
	WHATSAPP_MESSAGE_SENDER,
	type WhatsappMessageDirection,
	type WhatsappMessageSender,
} from "./constants";

/** One row of the conversation list, and the header of an open thread. */
export type ConversationSummary = {
	_id: Doc<"whatsappConversations">["_id"];
	customerPhone: string;
	customerName?: string;
	status: Doc<"whatsappConversations">["status"];
	locale?: string;
	lastMessageAt: number;
	lastInboundAt: number;
	createdAt: number;
};

/**
 * One message as staff see it.
 *
 * `modelBody` is deliberately absent. It exists so the model can be replayed
 * its own words *without* the server-composed notice lines, which means it is
 * not what the diner read — and "what did your bot tell them" is the entire
 * question this screen answers. Not returning it at all is stronger than
 * remembering not to render it.
 */
export type ConversationMessage = {
	_id: Doc<"whatsappMessages">["_id"];
	direction: WhatsappMessageDirection;
	/** `null` for inbound: the sender is the diner, which `direction` says. */
	sentBy: WhatsappMessageSender | null;
	body: string;
	mediaUrl?: string;
	/** Set when the send failed. An undelivered reply must not look delivered. */
	deliveryFailedAt?: number;
	createdAt: number;
};

/**
 * One read of a thread, as the staff view consumes it.
 *
 * Lives here rather than next to the query so the client imports a module with
 * no Convex server bindings in it — `import type` erases either way, but a
 * shape this screen renders belongs with the projections that produce it.
 */
export type ConversationThread = {
	conversation: ConversationSummary;
	/** Oldest-first, the way a chat reads. */
	messages: ConversationMessage[];
	/** More messages exist before the first one returned. */
	hasOlder: boolean;
	/** True once the window has hit the ceiling and cannot widen further. */
	atMaxWindow: boolean;
};

/**
 * The conversation a reservation came from, when there is one.
 */
export type ReservationConversationLinkResult = {
	conversationId: Doc<"whatsappConversations">["_id"];
	customerPhone: string;
} | null;

export function toConversationSummary(doc: Doc<"whatsappConversations">): ConversationSummary {
	return {
		_id: doc._id,
		customerPhone: doc.customerPhone,
		customerName: doc.customerName,
		status: doc.status,
		locale: doc.locale,
		lastMessageAt: doc.lastMessageAt,
		lastInboundAt: doc.lastInboundAt,
		createdAt: doc.createdAt,
	};
}

/**
 * Who a stored outbound row came from.
 *
 * Rows written before `sentBy` existed carry nothing. Every one of them was
 * written by the assistant or by fixed server copy, because no staff-reply path
 * existed yet — so reading a missing value as the assistant is the one guess
 * that can never wrongly put a human's name on a message.
 */
export function resolveMessageSender(
	doc: Pick<Doc<"whatsappMessages">, "direction" | "sentBy">
): WhatsappMessageSender | null {
	if (doc.direction === WHATSAPP_MESSAGE_DIRECTION.INBOUND) return null;
	return doc.sentBy ?? WHATSAPP_MESSAGE_SENDER.ASSISTANT;
}

export function toConversationMessage(doc: Doc<"whatsappMessages">): ConversationMessage {
	return {
		_id: doc._id,
		direction: doc.direction,
		sentBy: resolveMessageSender(doc),
		body: doc.body,
		mediaUrl: doc.mediaUrl,
		deliveryFailedAt: doc.deliveryFailedAt,
		createdAt: doc.createdAt,
	};
}

/**
 * How many messages one read of a thread may return.
 *
 * Clamped at both ends: a client asking for nothing gets a page, and a client
 * asking for a hundred thousand gets the ceiling rather than a function that
 * dies against Convex's read limit halfway through.
 */
export function clampMessageLimit(requested: number | undefined): number {
	if (requested === undefined || !Number.isFinite(requested)) {
		return WHATSAPP_CONVERSATION_PAGE_SIZE;
	}
	const floored = Math.floor(requested);
	if (floored < 1) return 1;
	return Math.min(floored, WHATSAPP_CONVERSATION_MAX_MESSAGES);
}
