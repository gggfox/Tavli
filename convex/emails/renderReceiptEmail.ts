import { render } from "@react-email/render";
import { createElement } from "react";
import { PLATFORM_APPLICATION_FEE_RATE } from "../constants";
import { interpolate } from "./copy";
import type { InviteEmailLocale } from "./locale";
import { getReceiptCopy } from "./receiptCopy";
import ReceiptEmail, { type ReceiptEmailItem, type ReceiptEmailProps } from "./receiptEmail";

export type ReceiptEmailContext = {
	locale: InviteEmailLocale;
	restaurantName: string;
	/** Informational tax block (NOT a CFDI). Omitted entirely when every field is unset. */
	taxInfo: { rfc?: string; razonSocial?: string; fiscalAddress?: string };
	/** Daily order number, when the order has one. */
	orderNumber: number | null;
	/** When the order was paid, in UTC ms. */
	orderDateMs: number;
	/** IANA timezone the date renders in (the restaurant's, already resolved). */
	timezone: string;
	items: Array<{ name: string; quantity: number; lineTotalCents: number; refunded: boolean }>;
	subtotalCents: number;
	/** 0 on cash (paid-in-person) orders — they carry no Tavli service fee, so no fee line renders. */
	feeCents: number;
	totalCents: number;
	/** Sum of the caller's paid tips this session; null/0 hides the tip line. */
	tipCents: number | null;
	paymentHint: "card" | "in_person";
};

/**
 * Grouped, fixed-2-decimals formatting, pinned to `en-US` for the same reasons
 * `src/global/utils/money.ts` pins its formatter: both app locales (en-US and
 * Mexican Spanish) group with `,` and separate decimals with `.`, and a bare
 * `"es"` would resolve to es-ES's `2.000,00`.
 */
const RECEIPT_AMOUNT_FORMATTER = new Intl.NumberFormat("en-US", {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

/**
 * Minimal replica of `src/global/utils/money.ts#formatCents` — emails cannot
 * import from `src/`, and the display convention (integer cents → "$12.99",
 * "$2,000.00") must match the app.
 */
export function formatReceiptAmount(cents: number): string {
	return `$${RECEIPT_AMOUNT_FORMATTER.format(cents / 100)}`;
}

/** Localized date-time in the restaurant's timezone (mirrors `formatExpiresAt`). */
export function formatReceiptDate(
	utcMs: number,
	locale: InviteEmailLocale,
	timezone: string
): string {
	return new Intl.DateTimeFormat(locale === "es" ? "es-MX" : "en-US", {
		dateStyle: "long",
		timeStyle: "short",
		timeZone: timezone,
	}).format(new Date(utcMs));
}

/** Customer-borne service-fee rate as a display percentage (12). */
const SERVICE_FEE_PERCENT = String(PLATFORM_APPLICATION_FEE_RATE * 100);

export async function renderReceiptEmail(context: ReceiptEmailContext): Promise<{
	subject: string;
	html: string;
	text: string;
}> {
	const copy = getReceiptCopy(context.locale);
	const dateFormatted = formatReceiptDate(context.orderDateMs, context.locale, context.timezone);

	const vars = {
		restaurantName: context.restaurantName,
		n: context.orderNumber !== null ? String(context.orderNumber) : "",
		date: dateFormatted,
		rate: SERVICE_FEE_PERCENT,
	};

	const taxLines: string[] = [];
	const razonSocial = context.taxInfo.razonSocial?.trim();
	const rfc = context.taxInfo.rfc?.trim();
	const fiscalAddress = context.taxInfo.fiscalAddress?.trim();
	if (razonSocial) taxLines.push(razonSocial);
	if (rfc) taxLines.push(interpolate(copy.rfcLabel, { rfc }));
	if (fiscalAddress) taxLines.push(fiscalAddress);

	const items: ReceiptEmailItem[] = context.items.map((item) => ({
		label: `${item.quantity}x ${item.name}`,
		amount: formatReceiptAmount(item.lineTotalCents),
		refunded: item.refunded,
	}));

	const emailProps: ReceiptEmailProps = {
		locale: context.locale,
		previewText: interpolate(copy.preview, vars),
		restaurantName: context.restaurantName,
		title: copy.title,
		orderLine:
			context.orderNumber !== null
				? interpolate(copy.orderLine, vars)
				: interpolate(copy.orderLineNoNumber, vars),
		taxBlock: taxLines.length > 0 ? { heading: copy.taxBlockHeading, lines: taxLines } : null,
		itemsHeading: copy.itemsHeading,
		items,
		refundedNote: copy.refundedNote,
		subtotalLabel: copy.subtotalLabel,
		subtotalValue: formatReceiptAmount(context.subtotalCents),
		feeLine:
			context.feeCents > 0
				? {
						label: interpolate(copy.feeLabel, vars),
						attribution: copy.feeAttribution,
						value: formatReceiptAmount(context.feeCents),
					}
				: null,
		totalLabel: copy.totalLabel,
		totalValue: formatReceiptAmount(context.totalCents),
		tipLine:
			context.tipCents !== null && context.tipCents > 0
				? { label: copy.tipLabel, value: formatReceiptAmount(context.tipCents) }
				: null,
		paymentHint:
			context.paymentHint === "in_person" ? copy.paymentHintInPerson : copy.paymentHintCard,
		footerNotCfdi: copy.footerNotCfdi,
		footerSentBy: copy.footerSentBy,
	};

	const element = createElement(ReceiptEmail, emailProps);
	const html = await render(element);
	const text = await render(element, { plainText: true });
	const subject = interpolate(copy.subject, vars);

	return { subject, html, text };
}
