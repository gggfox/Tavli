/**
 * "Open the WhatsApp conversation", on a reservation the assistant booked
 * (TAVLI-93).
 *
 * This is the entry point the ticket exists for. Staff are already on the
 * reservations screen when a diner says "but your bot told me…", so the link
 * belongs in the reservation detail drawer rather than only in a separate
 * inbox they would have to know about.
 *
 * Renders nothing — and asks nothing — unless the booking came from WhatsApp.
 * A reservation staff typed in has no thread behind it, so the query would be
 * one round trip per drawer open for an answer that is always `null`.
 */
import { WhatsappKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { RESERVATION_SOURCE } from "convex/constants";
import type { ReservationConversationLinkResult } from "convex/whatsappConversationsHelpers";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ReservationConversationLinkProps {
	readonly reservationId: Id<"reservations">;
	readonly source: Doc<"reservations">["source"];
}

export function ReservationConversationLink({
	reservationId,
	source,
}: Readonly<ReservationConversationLinkProps>) {
	const { t } = useTranslation();
	const isFromWhatsapp = source === RESERVATION_SOURCE.WHATSAPP;

	const { data } = useQuery({
		...convexQuery(
			api.whatsappConversations.getForReservation,
			isFromWhatsapp ? { reservationId } : "skip"
		),
		select: unwrapResult<ReservationConversationLinkResult>,
	});

	// No thread: either this booking did not come from WhatsApp, or its
	// conversation has since been purged. Neither is an error worth showing on
	// a reservation — it is simply a link that is not there.
	if (!isFromWhatsapp || !data) return null;

	return (
		<Link
			to="/admin/whatsapp"
			search={{ conversation: data.conversationId }}
			className="flex items-center gap-2 text-sm underline text-muted-foreground"
		>
			<MessageSquare size={14} />
			{t(WhatsappKeys.RESERVATION_LINK)}
		</Link>
	);
}
