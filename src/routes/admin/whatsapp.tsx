/**
 * The staff WhatsApp inbox (TAVLI-93): every conversation the assistant is
 * having for the selected restaurant, and a read-only thread panel.
 *
 * The open thread lives in the URL (`?conversation=…`) rather than in component
 * state, because the reservation drawer links straight here — "open the
 * conversation this booking came from" has to be a link someone can follow,
 * share, and come back to.
 */
import { useRestaurant } from "@/features/restaurants";
import { ConversationThreadDrawer, ConversationsTable } from "@/features/whatsapp";
import { AdminPageLayout, TableSkeleton } from "@/global/components";
import { WhatsappKeys } from "@/global/i18n";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";
import { useTranslation } from "react-i18next";

function validateWhatsappSearch(search: Record<string, unknown>) {
	return {
		conversation: typeof search.conversation === "string" ? search.conversation : undefined,
	};
}

export const Route = createFileRoute("/admin/whatsapp")({
	component: WhatsappConversationsPage,
	validateSearch: validateWhatsappSearch,
});

function WhatsappConversationsPage() {
	const { restaurant, isLoading } = useRestaurant();
	const { conversation } = Route.useSearch();
	const navigate = useNavigate();

	// An id off the URL is never trusted here — `getThread` re-derives the
	// restaurant from the stored row and checks access against that, so a
	// hand-edited query string reaches a `NOT_AUTHORIZED`, not a transcript.
	const openConversationId = (conversation as Id<"whatsappConversations"> | undefined) ?? null;

	const setOpenConversation = (next: Id<"whatsappConversations"> | undefined) => {
		void navigate({ to: "/admin/whatsapp", search: { conversation: next } });
	};

	return (
		<AdminPageLayout>
			<ConversationsContent
				restaurantId={restaurant?._id}
				isLoading={isLoading}
				onSelect={setOpenConversation}
			/>
			<ConversationThreadDrawer
				conversationId={openConversationId}
				onClose={() => setOpenConversation(undefined)}
			/>
		</AdminPageLayout>
	);
}

function ConversationsContent({
	restaurantId,
	isLoading,
	onSelect,
}: Readonly<{
	restaurantId: Id<"restaurants"> | undefined;
	isLoading: boolean;
	onSelect: (conversationId: Id<"whatsappConversations">) => void;
}>) {
	const { t } = useTranslation();

	if (isLoading) return <TableSkeleton />;
	if (!restaurantId) {
		return (
			<p className="text-sm text-faint-foreground">{t(WhatsappKeys.PAGE_SETUP_RESTAURANT_FIRST)}</p>
		);
	}
	return <ConversationsTable restaurantId={restaurantId} onSelect={onSelect} />;
}
