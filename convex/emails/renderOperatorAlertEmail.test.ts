/**
 * The severe-alert email (TAVLI-109).
 *
 * The structural test is the important one: `convex/` cannot import the
 * frontend's locale files, so the only thing stopping an alert kind from
 * arriving as a blank email is that every kind must have `en` and `es` copy
 * here, keyed by the same i18n keys the alerts page renders.
 */
import { describe, expect, it } from "vitest";
import {
	OPERATOR_ALERT_EXPLANATION_KEY,
	OPERATOR_ALERT_KIND,
	OPERATOR_ALERT_KINDS,
	OPERATOR_ALERT_SEVERITY,
	OPERATOR_ALERT_TITLE_KEY,
} from "../constants";
import { getOperatorAlertKindCopy, translateOperatorAlertKey } from "./operatorAlertCopy";
import { renderOperatorAlertEmail } from "./renderOperatorAlertEmail";

const LOCALES = ["en", "es"] as const;

const baseContext = {
	kind: OPERATOR_ALERT_KIND.CHARGE_UNMATCHED,
	severity: OPERATOR_ALERT_SEVERITY.SEVERE,
	messageKey: OPERATOR_ALERT_EXPLANATION_KEY[OPERATOR_ALERT_KIND.CHARGE_UNMATCHED],
	restaurantName: "La Cocina",
	stripeObjectId: "ch_3Qsample",
	alertsUrl: "https://app.tavliai.com/admin/alerts",
};

describe("operator alert copy", () => {
	it.each(LOCALES)("%s has a title and an explanation for every kind", (locale) => {
		for (const kind of OPERATOR_ALERT_KINDS) {
			const copy = getOperatorAlertKindCopy(locale, kind);
			expect(copy?.title, `${locale} title missing for ${kind}`).toBeTruthy();
			expect(copy?.explanation, `${locale} explanation missing for ${kind}`).toBeTruthy();
		}
	});

	it.each(LOCALES)("%s resolves both i18n keys of every kind", (locale) => {
		for (const kind of OPERATOR_ALERT_KINDS) {
			const titleKey = OPERATOR_ALERT_TITLE_KEY[kind];
			const explanationKey = OPERATOR_ALERT_EXPLANATION_KEY[kind];
			// A key that resolves to itself means there is no copy behind it.
			expect(translateOperatorAlertKey(locale, titleKey)).not.toBe(titleKey);
			expect(translateOperatorAlertKey(locale, explanationKey)).not.toBe(explanationKey);
		}
	});

	it("interpolates stored message params", () => {
		expect(
			translateOperatorAlertKey("en", "Charge {{id}} for {{cents}}", { id: "ch_1", cents: 500 })
		).toBe("Charge ch_1 for 500");
	});

	/**
	 * The amount-mismatch alert is the one kind whose copy is useless without
	 * its params: "Stripe collected a different amount" tells the operator
	 * nothing they can act on, and the two numbers are the whole decision.
	 * Both amounts arrive pre-formatted (neither renderer formats money).
	 */
	it.each(LOCALES)("%s names both amounts in the amount-mismatch explanation", (locale) => {
		const rendered = translateOperatorAlertKey(
			locale,
			OPERATOR_ALERT_EXPLANATION_KEY[OPERATOR_ALERT_KIND.PAYMENT_AMOUNT_MISMATCH],
			{ received: "18.00", expected: "19.80", currency: "MXN" }
		);

		expect(rendered).toContain("18.00");
		expect(rendered).toContain("19.80");
		expect(rendered).toContain("MXN");
		// No placeholder survived — `interpolate` silently drops unknown keys.
		expect(rendered).not.toContain("{{");
	});

	it("falls back to the key rather than sending an empty body", () => {
		expect(translateOperatorAlertKey("en", "alerts.kind.notYetTranslated.explanation")).toBe(
			"alerts.kind.notYetTranslated.explanation"
		);
	});
});

describe("renderOperatorAlertEmail", () => {
	it("renders the English alert with its title, severity, restaurant and reference", async () => {
		const { subject, html, text } = await renderOperatorAlertEmail({
			...baseContext,
			locale: "en",
		});

		expect(subject).toContain("Tavli operator alert");
		expect(subject).toContain("Charge matches no order");
		expect(html).toContain("Severity: Severe");
		expect(html).toContain("La Cocina");
		expect(html).toContain("ch_3Qsample");
		expect(text).toContain("https://app.tavliai.com/admin/alerts");
	});

	it("renders the Spanish alert from the same keys", async () => {
		const { subject, html } = await renderOperatorAlertEmail({
			...baseContext,
			locale: "es",
		});

		expect(subject).toContain("Alerta de operación Tavli");
		expect(subject).toContain("Cargo sin orden asociada");
		expect(html).toContain("Gravedad: Grave");
		expect(html).toContain("Abrir alertas de operación");
	});

	it("omits the restaurant and reference lines when the alert names neither", async () => {
		const { html } = await renderOperatorAlertEmail({
			...baseContext,
			locale: "en",
			restaurantName: null,
			stripeObjectId: null,
		});

		expect(html).not.toContain("Restaurant:");
		expect(html).not.toContain("Stripe reference:");
	});
});
