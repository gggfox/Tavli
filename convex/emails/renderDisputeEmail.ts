import { render } from "@react-email/render";
import { createElement } from "react";
import { NOTIFICATION_KIND } from "../constants";
import DisputeEmail, { type DisputeEmailProps } from "./disputeEmail";
import { getDisputeEmailChrome, getDisputeWhatNext, type DisputeEmailKind } from "./disputeCopy";
import type { InviteEmailLocale } from "./locale";

export type DisputeEmailContext = {
	locale: InviteEmailLocale;
	kind: DisputeEmailKind;
	/** Already grouped and two-decimalled by `formatDisputeAmount`. */
	amountFormatted: string;
	/** Currency code, e.g. `MXN`. */
	currency: string;
	restaurantName: string | null;
	/** The order's per-day number — what staff call an order. Null for a tab charge. */
	orderNumber: number | null;
	/** The restaurant's recovery percentage; 0 when nothing will be withheld. */
	recoveryPercent: number;
	/** Deep link to `/admin/payments`. */
	paymentsUrl: string;
};

/**
 * Render the dispute email (TAVLI-102) for one recipient in their language.
 *
 * The only conditional piece is "what happens next" on a loss, which changes
 * with the restaurant's recovery percentage — see `disputeCopy.ts` for why
 * saying nothing there would be worse than saying either version.
 */
export async function renderDisputeEmail(
	context: DisputeEmailContext
): Promise<{ subject: string; html: string; text: string }> {
	const chrome = getDisputeEmailChrome(context.locale, context.kind);
	const isFavourable = context.kind === NOTIFICATION_KIND.DISPUTE_WON;

	const emailProps: DisputeEmailProps = {
		locale: context.locale,
		leadLine: chrome.leadLine,
		isFavourable,
		heading: chrome.heading,
		amountLine: `${chrome.amountLabel}: ${context.amountFormatted} ${context.currency}`.trim(),
		restaurantLine: context.restaurantName
			? `${chrome.restaurantLabel}: ${context.restaurantName}`
			: null,
		orderLine:
			context.orderNumber !== null ? `${chrome.orderLabel}: #${context.orderNumber}` : null,
		whatHappenedLabel: chrome.whatHappenedLabel,
		whatHappened: chrome.whatHappened,
		whatNextLabel: chrome.whatNextLabel,
		whatNext: getDisputeWhatNext(context.locale, context.kind, context.recoveryPercent),
		ctaLabel: chrome.cta,
		paymentsUrl: context.paymentsUrl,
		footerWhy: chrome.footerWhy,
		footerSentBy: chrome.footerSentBy,
		previewText: chrome.preview,
	};

	const element = createElement(DisputeEmail, emailProps);
	const html = await render(element);
	const text = await render(element, { plainText: true });

	return { subject: chrome.subject, html, text };
}
