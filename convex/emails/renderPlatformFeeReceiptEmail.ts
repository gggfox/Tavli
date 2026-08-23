import { render } from "@react-email/render";
import { createElement } from "react";
import { interpolate } from "./copy";
import type { InviteEmailLocale } from "./locale";
import { getPlatformFeeReceiptCopy } from "./platformFeeReceiptCopy";
import PlatformFeeReceiptEmail, {
	type PlatformFeeReceiptEmailProps,
} from "./platformFeeReceiptEmail";

export type PlatformFeeReceiptEmailContext = {
	locale: InviteEmailLocale;
	restaurantName: string;
	/** Stripe's human-readable invoice number; null until Stripe assigns one. */
	invoiceNumber: string | null;
	/** From the INVOICE (`amount_paid`), never `PLATFORM_MONTHLY_FEE_MXN_CENTS`. */
	amountPaidCents: number;
	/** ISO 4217 code from the invoice, e.g. "MXN". */
	currency: string;
	periodStartMs: number;
	periodEndMs: number;
	hostedInvoiceUrl: string | null;
};

/**
 * Money for the platform subscription, formatted with its currency spelled out
 * ("$2,000.00 MXN").
 *
 * Diner-facing receipts drop the currency code because a diner is standing in
 * the restaurant paying in the local currency; a restaurant reading Tavli's
 * invoice is looking at a bill in a specific currency and needs to see which.
 */
export function formatPlatformFeeAmount(cents: number, currency: string): string {
	const amount = (cents / 100).toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	return `$${amount} ${currency.toUpperCase()}`;
}

/** "June 1 – July 1, 2026" in the recipient's locale, dates only (UTC). */
export function formatBillingPeriod(
	startMs: number,
	endMs: number,
	locale: InviteEmailLocale
): string {
	const formatter = new Intl.DateTimeFormat(locale === "es" ? "es-MX" : "en-US", {
		dateStyle: "long",
		timeZone: "UTC",
	});
	return `${formatter.format(new Date(startMs))} – ${formatter.format(new Date(endMs))}`;
}

export async function renderPlatformFeeReceiptEmail(
	context: PlatformFeeReceiptEmailContext
): Promise<{ subject: string; html: string; text: string }> {
	const copy = getPlatformFeeReceiptCopy(context.locale);
	const vars = { restaurantName: context.restaurantName };

	const emailProps: PlatformFeeReceiptEmailProps = {
		locale: context.locale,
		previewText: interpolate(copy.preview, vars),
		issuer: copy.issuer,
		title: copy.title,
		intro: interpolate(copy.intro, vars),
		periodLabel: copy.periodLabel,
		periodValue: formatBillingPeriod(context.periodStartMs, context.periodEndMs, context.locale),
		amountLabel: copy.amountLabel,
		amountValue: formatPlatformFeeAmount(context.amountPaidCents, context.currency),
		planLabel: copy.planLabel,
		planValue: copy.planValue,
		invoiceLine: context.invoiceNumber
			? { label: copy.invoiceNumberLabel, value: context.invoiceNumber }
			: null,
		invoiceUrl: context.hostedInvoiceUrl,
		ctaLabel: copy.cta,
		notServiceFee: copy.notServiceFee,
		footerQuestions: copy.footerQuestions,
		footerSentBy: copy.footerSentBy,
	};

	const element = createElement(PlatformFeeReceiptEmail, emailProps);
	const html = await render(element);
	const text = await render(element, { plainText: true });
	const subject = interpolate(copy.subject, vars);

	return { subject, html, text };
}
