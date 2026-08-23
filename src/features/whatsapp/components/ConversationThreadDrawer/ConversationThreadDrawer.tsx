/**
 * A WhatsApp thread, as staff read it (TAVLI-93).
 *
 * Deliberately read-only: no composer, no takeover, no export. Handover is a
 * much larger build — it needs a staff identity on outbound messages, a way to
 * pause the assistant, and a rule for when it resumes — and a half-built
 * composer would be worse than none. The panel says so out loud rather than
 * leaving staff to discover there is nothing to type into.
 *
 * Two display decisions carry the whole point of the screen:
 *
 *   - Every bubble renders `body`, what was actually **sent**. The server never
 *     returns `modelBody` (see `whatsappConversationsHelpers.ts`), so the wrong
 *     one cannot be rendered by accident.
 *   - A row with `deliveryFailedAt` is drawn as undelivered. "The bot never
 *     answered me" is a common complaint, and these rows are the evidence.
 */
import { DialogHeader, Drawer, EmptyState, StatusBadge, TableSkeleton } from "@/global/components";
import { WhatsappKeys } from "@/global/i18n";
import { formatDate, unwrapResult } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import {
	WHATSAPP_CONVERSATION_MAX_MESSAGES,
	WHATSAPP_CONVERSATION_PAGE_SIZE,
	WHATSAPP_MESSAGE_DIRECTION,
	WHATSAPP_MESSAGE_SENDER,
	type WhatsappMessageSender,
} from "convex/constants";
import type { ConversationThread } from "convex/whatsappConversationsHelpers";
import { AlertTriangle, ChevronUp, MessageSquare, Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const SENDER_LABEL_KEY: Record<WhatsappMessageSender, string> = {
	[WHATSAPP_MESSAGE_SENDER.ASSISTANT]: WhatsappKeys.SENDER_ASSISTANT,
	[WHATSAPP_MESSAGE_SENDER.SYSTEM]: WhatsappKeys.SENDER_SYSTEM,
	[WHATSAPP_MESSAGE_SENDER.STAFF]: WhatsappKeys.SENDER_STAFF,
};

interface ConversationThreadDrawerProps {
	readonly conversationId: Id<"whatsappConversations"> | null;
	readonly onClose: () => void;
}

export function ConversationThreadDrawer({
	conversationId,
	onClose,
}: Readonly<ConversationThreadDrawerProps>) {
	const { t, i18n } = useTranslation();
	// "Load older" widens the window rather than walking a cursor, so the newest
	// message is always the last one — a live reply still lands at the bottom
	// while staff are reading. The server clamps this; see `clampMessageLimit`.
	const [limit, setLimit] = useState(WHATSAPP_CONVERSATION_PAGE_SIZE);

	// A different thread starts at one page again, or the second thread opens
	// showing however far someone scrolled back in the first.
	useEffect(() => setLimit(WHATSAPP_CONVERSATION_PAGE_SIZE), [conversationId]);

	const { data, isLoading, isError } = useQuery({
		...convexQuery(
			api.whatsappConversations.getThread,
			conversationId ? { conversationId, limit } : "skip"
		),
		select: unwrapResult<ConversationThread>,
	});

	const title = data?.conversation.customerName?.trim() || t(WhatsappKeys.CUSTOMER_UNKNOWN);

	return (
		<Drawer
			isOpen={conversationId !== null}
			onClose={onClose}
			ariaLabel={t(WhatsappKeys.THREAD_ARIA)}
			side="right"
		>
			<DialogHeader
				title={<h2 className="text-lg font-semibold text-foreground">{title}</h2>}
				subtitle={
					<span className="text-xs tabular-nums text-faint-foreground">
						{data?.conversation.customerPhone ?? ""}
					</span>
				}
				onClose={onClose}
				closeAriaLabel={t(WhatsappKeys.THREAD_CLOSE_ARIA)}
			/>

			<p className="px-6 pt-3 text-xs text-muted-foreground">{t(WhatsappKeys.THREAD_READ_ONLY)}</p>

			<div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
				<ThreadBody
					data={data}
					isLoading={isLoading && conversationId !== null}
					isError={isError}
					locale={i18n.language}
					onLoadOlder={() => setLimit((n) => n + WHATSAPP_CONVERSATION_PAGE_SIZE)}
				/>
			</div>
		</Drawer>
	);
}

interface ThreadBodyProps {
	readonly data: ConversationThread | undefined;
	readonly isLoading: boolean;
	readonly isError: boolean;
	readonly locale: string;
	readonly onLoadOlder: () => void;
}

function ThreadBody({ data, isLoading, isError, locale, onLoadOlder }: Readonly<ThreadBodyProps>) {
	const { t } = useTranslation();

	if (isError) {
		return <EmptyState icon={AlertTriangle} title={t(WhatsappKeys.THREAD_ERROR)} />;
	}
	if (isLoading || !data) return <TableSkeleton rows={4} />;
	if (data.messages.length === 0) {
		return <EmptyState icon={MessageSquare} title={t(WhatsappKeys.THREAD_EMPTY)} />;
	}

	return (
		<div className="flex flex-col gap-3">
			{/* At the ceiling there is nothing left to load, so the panel says the
			    thread is truncated instead of offering a button that does nothing. */}
			{data.hasOlder && data.atMaxWindow && (
				<p className="text-center text-xs text-faint-foreground">
					{t(WhatsappKeys.THREAD_WINDOW_FULL, { count: WHATSAPP_CONVERSATION_MAX_MESSAGES })}
				</p>
			)}
			{data.hasOlder && !data.atMaxWindow && (
				<button
					type="button"
					onClick={onLoadOlder}
					className="mx-auto flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground"
				>
					<ChevronUp size={14} />
					{t(WhatsappKeys.THREAD_LOAD_OLDER)}
				</button>
			)}

			{data.messages.map((message) => (
				<MessageBubble key={message._id} message={message} locale={locale} />
			))}
		</div>
	);
}

interface MessageBubbleProps {
	readonly message: ConversationThread["messages"][number];
	readonly locale: string;
}

function MessageBubble({ message, locale }: Readonly<MessageBubbleProps>) {
	const { t } = useTranslation();
	const isInbound = message.direction === WHATSAPP_MESSAGE_DIRECTION.INBOUND;
	const senderKey = message.sentBy
		? SENDER_LABEL_KEY[message.sentBy]
		: WhatsappKeys.SENDER_CUSTOMER;
	const undelivered = message.deliveryFailedAt !== undefined;

	return (
		<div className={`flex flex-col gap-1 ${isInbound ? "items-start" : "items-end"}`}>
			<div className="flex items-center gap-2 text-[11px] text-faint-foreground">
				<span>{t(senderKey)}</span>
				<span className="tabular-nums">{formatDate(message.createdAt, locale)}</span>
			</div>
			<div
				className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words border ${
					isInbound ? "bg-muted border-border" : "bg-hover border-border"
				}`}
				style={undelivered ? { opacity: 0.7 } : undefined}
			>
				{message.body}
			</div>
			{message.mediaUrl && (
				<span className="flex items-center gap-1 text-[11px] text-faint-foreground">
					<Paperclip size={11} />
					{t(WhatsappKeys.MESSAGE_ATTACHMENT)}
				</span>
			)}
			{undelivered && (
				<StatusBadge
					bgColor="var(--color-destructive)"
					textColor="#fff"
					label={t(WhatsappKeys.MESSAGE_UNDELIVERED)}
				/>
			)}
		</div>
	);
}
