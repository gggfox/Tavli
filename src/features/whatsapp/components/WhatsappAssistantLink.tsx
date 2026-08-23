import { WhatsappAssistantPanel } from "@/features/whatsapp/components/WhatsappAssistantPanel";
import { Modal } from "@/global/components";
import { WhatsappKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { MessageCircle, QrCode as QrCodeIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface WhatsappAssistantLinkProps {
	readonly slug: string;
}

/**
 * The diner-facing entry point to the WhatsApp assistant: one line pinned above
 * the contact bar, with a link that opens the chat and a QR button beside it.
 *
 * A single line rather than an inline item in the contact bar, because that bar
 * renders nothing at all for a restaurant that has published no public profile —
 * and whether the assistant is enabled has nothing to do with whether anyone
 * filled in an address. Renders nothing when the assistant is off, so a page
 * without it loses no vertical space and makes no promise.
 *
 * The QR is here, on a diner's page, because this is also the page a staff
 * member opens on a laptop to print the table tent. The query is anonymous by
 * design: the code it returns is a router, not a secret (ADR 012).
 */
export function WhatsappAssistantLink({ slug }: WhatsappAssistantLinkProps) {
	const { t } = useTranslation();
	const [showQr, setShowQr] = useState(false);
	const { data } = useQuery(convexQuery(api.whatsappChannels.getPublicBySlug, { slug }));

	if (!data?.deepLinkUrl) return null;

	return (
		<section
			aria-label={t(WhatsappKeys.ASSISTANT_TITLE)}
			className="shrink-0 border-t border-border bg-muted px-4 py-1.5"
		>
			<div className="flex items-center gap-3 text-xs">
				<a
					href={data.deepLinkUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="flex min-w-0 items-center gap-1.5 text-foreground"
				>
					<MessageCircle size={14} className="shrink-0 text-muted-foreground" aria-hidden />
					<span className="truncate underline">{t(WhatsappKeys.ASSISTANT_PUBLIC_CTA)}</span>
				</a>
				<button
					type="button"
					onClick={() => setShowQr(true)}
					aria-label={t(WhatsappKeys.ASSISTANT_PRINT_QR)}
					className="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground"
				>
					<QrCodeIcon size={14} aria-hidden />
					<span className="font-mono tracking-wider">{data.formattedShortCode}</span>
				</button>
			</div>

			<Modal
				isOpen={showQr}
				onClose={() => setShowQr(false)}
				ariaLabel={t(WhatsappKeys.ASSISTANT_TITLE)}
				size="lg"
			>
				<div className="space-y-3 rounded-xl border border-border bg-background p-6">
					<h2 className="text-sm font-semibold text-foreground">
						{t(WhatsappKeys.ASSISTANT_TITLE)}
					</h2>
					<WhatsappAssistantPanel
						restaurantName={data.restaurantName}
						formattedShortCode={data.formattedShortCode}
						deepLinkUrl={data.deepLinkUrl}
						deepLinkText={data.deepLinkText}
					/>
				</div>
			</Modal>
		</section>
	);
}
