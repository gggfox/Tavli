import { render } from "@react-email/render";
import { createElement } from "react";
import type { OperatorAlertKind, OperatorAlertSeverity } from "../constants";
import { interpolate } from "./copy";
import type { InviteEmailLocale } from "./locale";
import {
	getOperatorAlertChrome,
	getOperatorAlertKindCopy,
	translateOperatorAlertKey,
} from "./operatorAlertCopy";
import OperatorAlertEmail, { type OperatorAlertEmailProps } from "./operatorAlertEmail";

export type OperatorAlertEmailContext = {
	locale: InviteEmailLocale;
	kind: OperatorAlertKind;
	severity: OperatorAlertSeverity;
	/** The alert's stored i18n key — not prose. */
	messageKey: string;
	messageParams?: Record<string, string | number>;
	restaurantName: string | null;
	stripeObjectId: string | null;
	/** Deep link to `/admin/alerts`. */
	alertsUrl: string;
};

export async function renderOperatorAlertEmail(
	context: OperatorAlertEmailContext
): Promise<{ subject: string; html: string; text: string }> {
	const chrome = getOperatorAlertChrome(context.locale);
	const kindCopy = getOperatorAlertKindCopy(context.locale, context.kind);

	// The title comes from the kind; the body from the alert's own
	// `messageKey`, which defaults to that kind's explanation but lets a call
	// site say something more specific without the backend storing prose.
	const explanation = translateOperatorAlertKey(
		context.locale,
		context.messageKey,
		context.messageParams
	);

	const emailProps: OperatorAlertEmailProps = {
		locale: context.locale,
		heading: chrome.heading,
		alertTitle: kindCopy.title,
		explanation,
		severityLine: `${chrome.severityLabel}: ${chrome.severities[context.severity]}`,
		restaurantLine: context.restaurantName
			? `${chrome.restaurantLabel}: ${context.restaurantName}`
			: null,
		referenceLine: context.stripeObjectId
			? `${chrome.referenceLabel}: ${context.stripeObjectId}`
			: null,
		ctaLabel: chrome.cta,
		alertsUrl: context.alertsUrl,
		footerWhy: chrome.footerWhy,
		footerSentBy: chrome.footerSentBy,
		previewText: chrome.preview,
	};

	const element = createElement(OperatorAlertEmail, emailProps);
	const html = await render(element);
	const text = await render(element, { plainText: true });
	const subject = interpolate(chrome.subject, { title: kindCopy.title });

	return { subject, html, text };
}
