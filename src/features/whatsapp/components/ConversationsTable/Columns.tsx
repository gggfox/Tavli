/**
 * Columns for the staff WhatsApp conversation list (TAVLI-93).
 *
 * Every column is a field the conversation row already carries. A "last
 * message" preview would read prettier and would cost one extra query per
 * conversation — a few hundred of those on one screen is how a Convex function
 * runs into its per-call read limit.
 */
import { WhatsappKeys } from "@/global/i18n";
import { formatDate } from "@/global/utils";
import { createColumnHelper } from "@tanstack/react-table";
import { WHATSAPP_CONVERSATION_STATUS } from "convex/constants";
import type { ConversationSummary } from "convex/whatsappConversationsHelpers";
import type { TFunction } from "i18next";

export type ConversationRow = ConversationSummary;

const STATUS_LABEL_KEY: Record<string, string> = {
	[WHATSAPP_CONVERSATION_STATUS.ACTIVE]: WhatsappKeys.STATUS_ACTIVE,
	[WHATSAPP_CONVERSATION_STATUS.HANDOFF]: WhatsappKeys.STATUS_HANDOFF,
	[WHATSAPP_CONVERSATION_STATUS.CLOSED]: WhatsappKeys.STATUS_CLOSED,
};

const columnHelper = createColumnHelper<ConversationRow>();

/**
 * Built per render rather than as a module constant because every header and
 * the status cell are translated, and `t` is bound to the active language.
 */
export function buildConversationColumns(t: TFunction, locale: string) {
	return [
		columnHelper.accessor("customerName", {
			header: t(WhatsappKeys.COLUMN_CUSTOMER),
			cell: (info) => {
				const name = info.getValue()?.trim();
				return name ? (
					<span className="text-sm font-medium text-foreground">{name}</span>
				) : (
					// Twilio omits `ProfileName` when the diner has no WhatsApp display
					// name. The row still has to be identifiable, and the phone column
					// next to it is the identity.
					<span className="text-sm italic text-faint-foreground">
						{t(WhatsappKeys.CUSTOMER_UNKNOWN)}
					</span>
				);
			},
		}),
		columnHelper.accessor("customerPhone", {
			header: t(WhatsappKeys.COLUMN_PHONE),
			cell: (info) => (
				<span className="text-sm tabular-nums text-muted-foreground">{info.getValue()}</span>
			),
		}),
		columnHelper.accessor("status", {
			header: t(WhatsappKeys.COLUMN_STATUS),
			cell: (info) => {
				const key = STATUS_LABEL_KEY[info.getValue()];
				return (
					<span className="text-sm text-muted-foreground">{key ? t(key) : info.getValue()}</span>
				);
			},
		}),
		columnHelper.accessor("lastMessageAt", {
			header: t(WhatsappKeys.COLUMN_LAST_ACTIVITY),
			cell: (info) => (
				<span className="text-sm text-muted-foreground">{formatDate(info.getValue(), locale)}</span>
			),
		}),
		columnHelper.accessor("createdAt", {
			header: t(WhatsappKeys.COLUMN_STARTED),
			cell: (info) => (
				<span className="text-sm text-faint-foreground">{formatDate(info.getValue(), locale)}</span>
			),
		}),
	];
}
