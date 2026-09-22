/**
 * The dispute emails (TAVLI-102).
 *
 * Two things are worth a test rather than a reading. First the structural one:
 * `convex/` cannot import the frontend's locale files, so nothing but this
 * suite stops a phase from arriving as a blank email. Second the one the ticket
 * is actually about — a restaurant with recovery switched off must not be told
 * money will be withheld, and one with a percentage configured must be told
 * exactly what it is, because the alternative is a short payout nobody
 * explained.
 */
import { describe, expect, it } from "vitest";
import { NOTIFICATION_KIND } from "../constants";
import {
	DISPUTE_EMAIL_KINDS,
	getDisputeEmailChrome,
	getDisputeWhatNext,
	isDisputeEmailKind,
} from "./disputeCopy";
import { renderDisputeEmail } from "./renderDisputeEmail";

const LOCALES = ["en", "es"] as const;

const baseContext = {
	kind: NOTIFICATION_KIND.DISPUTE_LOST,
	amountFormatted: "640.00",
	currency: "MXN",
	restaurantName: "La Cocina",
	orderNumber: 42,
	recoveryPercent: 0,
	paymentsUrl: "https://app.tavliai.com/admin/payments",
} as const;

describe("dispute email copy", () => {
	it.each(LOCALES)("%s has chrome for every dispute email kind", (locale) => {
		for (const kind of DISPUTE_EMAIL_KINDS) {
			const chrome = getDisputeEmailChrome(locale, kind);
			expect(chrome?.subject, `${locale} subject missing for ${kind}`).toBeTruthy();
			expect(chrome?.leadLine, `${locale} lead line missing for ${kind}`).toBeTruthy();
			expect(chrome?.whatHappened, `${locale} explanation missing for ${kind}`).toBeTruthy();
			expect(chrome?.whatNext, `${locale} next step missing for ${kind}`).toBeTruthy();
			expect(chrome?.whatNextWithRecovery, `${locale} recovery variant missing`).toBeTruthy();
			expect(chrome?.cta, `${locale} cta missing for ${kind}`).toBeTruthy();
		}
	});

	it("narrows the notification kinds an action may pass", () => {
		expect(isDisputeEmailKind(NOTIFICATION_KIND.DISPUTE_LOST)).toBe(true);
		expect(isDisputeEmailKind(NOTIFICATION_KIND.PAYOUT_FAILED)).toBe(false);
	});

	it.each(LOCALES)("%s interpolates the percentage rather than leaving a placeholder", (locale) => {
		const withRecovery = getDisputeWhatNext(locale, NOTIFICATION_KIND.DISPUTE_LOST, 25);
		expect(withRecovery).toContain("25");
		expect(withRecovery).not.toContain("{{");
	});

	it.each(LOCALES)("%s says nothing is withheld when recovery is off", (locale) => {
		const without = getDisputeWhatNext(locale, NOTIFICATION_KIND.DISPUTE_LOST, 0);
		const with25 = getDisputeWhatNext(locale, NOTIFICATION_KIND.DISPUTE_LOST, 25);
		expect(without).not.toBe(with25);
		expect(without).not.toContain("%");
	});
});

describe("renderDisputeEmail", () => {
	it("leads with what happened, names the order, then says what happens next", async () => {
		const { subject, html, text } = await renderDisputeEmail({ ...baseContext, locale: "en" });

		expect(subject).toContain("went back to the diner");
		expect(html).toContain("The diner&#x27;s bank decided in their favour.");
		expect(html).toContain("640.00 MXN");
		expect(html).toContain("Order: #42");
		expect(html).toContain("La Cocina");

		const leadAt = text.indexOf("decided in their favour");
		const happenedAt = text.indexOf("returned this payment to the diner");
		const nextAt = text.indexOf("Nothing is being withheld");
		expect(leadAt).toBeGreaterThanOrEqual(0);
		expect(leadAt).toBeLessThan(happenedAt);
		expect(happenedAt).toBeLessThan(nextAt);

		expect(text).toContain("https://app.tavliai.com/admin/payments");
	});

	it("names the percentage when recovery applies, and never a placeholder", async () => {
		const { html } = await renderDisputeEmail({
			...baseContext,
			locale: "en",
			recoveryPercent: 30,
		});
		expect(html).toContain("30% of the food subtotal");
		// Two promises the copy must keep, because both are load-bearing terms.
		expect(html).toContain("never from tips");
		expect(html).toContain("the amount your diners pay does not change");
		expect(html).not.toContain("{{percent}}");
	});

	it("renders the Spanish loss from the same inputs", async () => {
		const { subject, html } = await renderDisputeEmail({
			...baseContext,
			locale: "es",
			recoveryPercent: 30,
		});
		expect(subject).toContain("regresó al comensal");
		expect(html).toContain("30% del subtotal de alimentos");
		expect(html).toContain("Ver tus pagos");
	});

	it("renders the opened email without pretending the restaurant can act", async () => {
		// Evidence submission is out of scope for TAVLI-102, so the copy must not
		// ask for evidence the app has no way to accept.
		const { subject, html } = await renderDisputeEmail({
			...baseContext,
			locale: "en",
			kind: NOTIFICATION_KIND.DISPUTE_OPENED,
		});
		expect(subject).toContain("questioned a payment");
		expect(html).toContain("Tavli handles the dispute with Stripe");
		expect(html.toLowerCase()).not.toContain("upload");
		expect(html.toLowerCase()).not.toContain("evidence");
	});

	it("renders the won email as good news, and says the money comes back", async () => {
		const { subject, html } = await renderDisputeEmail({
			...baseContext,
			locale: "en",
			kind: NOTIFICATION_KIND.DISPUTE_WON,
		});
		expect(subject).toContain("resolved in your favour");
		expect(html).toContain("The payment stands");
		expect(html).toContain("on its way back to your account");
	});

	it("omits the order line for a charge with no order number", async () => {
		const { html } = await renderDisputeEmail({
			...baseContext,
			locale: "en",
			orderNumber: null,
		});
		expect(html).not.toContain("Order:");
	});

	it("omits the restaurant line when the restaurant was purged before delivery", async () => {
		const { html } = await renderDisputeEmail({
			...baseContext,
			locale: "en",
			restaurantName: null,
		});
		expect(html).not.toContain("Restaurant:");
	});
});
