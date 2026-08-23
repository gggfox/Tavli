/**
 * One restaurant's WhatsApp threads, most recently active first (TAVLI-93).
 *
 * Read-only, like everything on this screen: clicking a row opens the thread,
 * and there is nothing else to do here. Deliberately no CSV export — phone
 * numbers are PII, and the fact that they are already on the reservation
 * justifies showing them, not handing them out in a file.
 *
 * Built on `AdminTable` + `useAdminTable`, which carry `"use no memo"` because
 * React Compiler would otherwise freeze TanStack Table's row models and sorting
 * would stop reaching the rendered rows.
 */
import { AdminTable } from "@/global/components";
import { useAdminTable } from "@/global/hooks";
import { WhatsappKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { WHATSAPP_CONVERSATION_LIST_LIMIT } from "convex/constants";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buildConversationColumns, type ConversationRow } from "./Columns";

interface ConversationsTableProps {
	readonly restaurantId: Id<"restaurants">;
	readonly onSelect: (conversationId: Id<"whatsappConversations">) => void;
}

export function ConversationsTable({ restaurantId, onSelect }: Readonly<ConversationsTableProps>) {
	const { t, i18n } = useTranslation();

	const tableState = useAdminTable<ConversationRow>({
		queryOptions: convexQuery(api.whatsappConversations.listForRestaurant, { restaurantId }),
		columns: buildConversationColumns(t, i18n.language),
		getRowId: (row) => row._id,
	});

	// The query returns the most recently active threads and stops. Saying so is
	// better than a list that silently ends — the older ones are still reachable
	// from the reservation they produced.
	const isTruncated = (tableState.data?.length ?? 0) >= WHATSAPP_CONVERSATION_LIST_LIMIT;

	return (
		<div className="flex flex-col flex-1 h-full min-h-0 gap-2">
			<AdminTable
				tableState={tableState}
				entityName={t(WhatsappKeys.LIST_ENTITY)}
				searchPlaceholder={t(WhatsappKeys.LIST_SEARCH_PLACEHOLDER)}
				getResultCountText={(count) => t(WhatsappKeys.LIST_RESULT_COUNT, { count })}
				emptyIcon={MessageSquare}
				emptyTitle={t(WhatsappKeys.LIST_EMPTY_TITLE)}
				emptyDescription={t(WhatsappKeys.LIST_EMPTY_DESCRIPTION)}
				filteredEmptyTitle={t(WhatsappKeys.LIST_FILTERED_EMPTY_TITLE)}
				notAuthenticatedMessage={t(WhatsappKeys.LIST_NOT_AUTHENTICATED)}
				onRowClick={(row) => onSelect(row._id)}
			/>
			{isTruncated && (
				<p className="text-xs text-faint-foreground">
					{t(WhatsappKeys.LIST_TRUNCATED, { count: WHATSAPP_CONVERSATION_LIST_LIMIT })}
				</p>
			)}
		</div>
	);
}
