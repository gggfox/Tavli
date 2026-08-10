import { OrderingKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { useConvexAction } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Loader2, Mail, MailCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * "Email me a receipt" (ADR 008 / TAVLI-71 Phase 3C). Sends the
 * restaurant-branded receipt for a PAID order to the caller's own verified
 * email via `receiptActions.sendReceiptEmail` — the backend derives the
 * recipient from the identity, so no address is ever passed from here.
 *
 * The button disables permanently on a rate-limit rejection (max sends per
 * order per hour) with the mapped friendly message; other failures leave it
 * enabled for retry.
 */
export function EmailReceiptButton({ orderId }: Readonly<{ orderId: Id<"orders"> }>) {
	const { t, i18n } = useTranslation();
	const sendReceiptEmail = useConvexAction(api.receiptActions.sendReceiptEmail);

	const [sending, setSending] = useState(false);
	const [sentTo, setSentTo] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [rateLimited, setRateLimited] = useState(false);

	const handleSend = async () => {
		setSending(true);
		setError(null);
		try {
			const locale = i18n.language.toLowerCase().startsWith("es")
				? ("es" as const)
				: ("en" as const);
			const result = await sendReceiptEmail({ orderId, locale });
			setSentTo(result.sentTo);
		} catch (err) {
			// The rate limit is per order, not per attempt — once tripped, further
			// clicks can only fail until the window resets, so disable the button.
			const raw = err instanceof Error ? `${err.message}` : String(err);
			if (raw.includes("ERROR_RECEIPT_RATE_LIMITED")) {
				setRateLimited(true);
			}
			setSentTo(null);
			setError(getErrorMessage(err, t, OrderingKeys.CHECKOUT_GENERIC_ERROR));
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="space-y-2">
			<button
				type="button"
				onClick={handleSend}
				disabled={sending || rateLimited}
				className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border border-border text-foreground hover:bg-(--bg-hover) disabled:opacity-50"
			>
				{sending ? (
					<>
						<Loader2 size={16} className="animate-spin" />
						{t(OrderingKeys.RECEIPT_EMAIL_SENDING)}
					</>
				) : (
					<>
						{sentTo ? <MailCheck size={16} /> : <Mail size={16} />}
						{t(OrderingKeys.RECEIPT_EMAIL_CTA)}
					</>
				)}
			</button>
			{sentTo && !error && (
				<p className="text-xs text-center text-success">
					{t(OrderingKeys.RECEIPT_EMAIL_SENT, { email: sentTo })}
				</p>
			)}
			{error && <p className="text-xs text-center text-destructive">{error}</p>}
		</div>
	);
}
