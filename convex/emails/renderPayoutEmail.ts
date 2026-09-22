import { render } from "@react-email/render";
import { createElement } from "react";
import { NOTIFICATION_KIND, type PayoutFailureCode } from "../constants";
import type { InviteEmailLocale } from "./locale";
import PayoutEmail, { type PayoutEmailProps } from "./payoutEmail";
import {
	getPayoutEmailChrome,
	getPayoutFailureCopy,
	getPayoutsResumedCopy,
	type PayoutEmailKind,
} from "./payoutCopy";

export type PayoutEmailContext = {
	locale: InviteEmailLocale;
	kind: PayoutEmailKind;
	/** Already grouped and two-decimalled by `formatPayoutAmount`. */
	amountFormatted: string;
	/** Currency code, e.g. `MXN`. */
	currency: string;
	restaurantName: string | null;
	/** The normalized failure code — never Stripe's raw string. Absent on "resumed". */
	failureCode: PayoutFailureCode | undefined;
	/** Deep link to `/admin/payouts`. */
	payoutsUrl: string;
};

/**
 * Render the payout email (TAVLI-103) for one recipient in their language.
 *
 * The reason/fix pair comes from the **normalized** `failureCode`, so an
 * undocumented Stripe code renders the `unknown` copy rather than leaking a raw
 * identifier into somebody's inbox. `payouts_resumed` has no failure code and
 * uses its own pair.
 */
export async function renderPayoutEmail(
	context: PayoutEmailContext
): Promise<{ subject: string; html: string; text: string }> {
	const chrome = getPayoutEmailChrome(context.locale, context.kind);
	const detail =
		context.kind === NOTIFICATION_KIND.PAYOUTS_RESUMED
			? getPayoutsResumedCopy(context.locale)
			: getPayoutFailureCopy(context.locale, context.failureCode ?? "unknown");

	const emailProps: PayoutEmailProps = {
		locale: context.locale,
		safeLine: chrome.safeLine,
		heading: chrome.heading,
		amountLine: `${chrome.amountLabel}: ${context.amountFormatted} ${context.currency}`.trim(),
		restaurantLine: context.restaurantName
			? `${chrome.restaurantLabel}: ${context.restaurantName}`
			: null,
		reasonLabel: chrome.reasonLabel,
		reason: detail.reason,
		fixLabel: chrome.fixLabel,
		fix: detail.fix,
		ctaLabel: chrome.cta,
		payoutsUrl: context.payoutsUrl,
		footerWhy: chrome.footerWhy,
		footerSentBy: chrome.footerSentBy,
		previewText: chrome.preview,
	};

	const element = createElement(PayoutEmail, emailProps);
	const html = await render(element);
	const text = await render(element, { plainText: true });

	return { subject: chrome.subject, html, text };
}
