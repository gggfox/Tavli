/**
 * The payout emails (TAVLI-103).
 *
 * The structural tests are the important ones. `convex/` cannot import the
 * frontend's locale files, so the only thing stopping a Stripe failure code from
 * arriving as a blank email — or worse, as the raw Stripe identifier — is that
 * every code in the closed set must have `en` and `es` copy here, keyed by the
 * same i18n keys the payouts page renders.
 */
import { describe, expect, it } from "vitest";
import {
	NOTIFICATION_KIND,
	PAYOUT_FAILURE_CODE,
	PAYOUT_FAILURE_CODES,
	PAYOUT_FAILURE_FIX_KEY,
	PAYOUT_FAILURE_REASON_KEY,
} from "../constants";
import {
	getPayoutEmailChrome,
	getPayoutFailureCopy,
	PAYOUT_EMAIL_KINDS,
	translatePayoutKey,
} from "./payoutCopy";
import { renderPayoutEmail } from "./renderPayoutEmail";

const LOCALES = ["en", "es"] as const;

const baseContext = {
	kind: NOTIFICATION_KIND.PAYOUT_FAILED,
	amountFormatted: "12,450.00",
	currency: "MXN",
	restaurantName: "La Cocina",
	failureCode: PAYOUT_FAILURE_CODE.INVALID_ACCOUNT_NUMBER,
	payoutsUrl: "https://app.tavliai.com/admin/payouts",
} as const;

describe("payout email copy", () => {
	it.each(LOCALES)("%s has a reason and a fix for every failure code", (locale) => {
		for (const code of PAYOUT_FAILURE_CODES) {
			const copy = getPayoutFailureCopy(locale, code);
			expect(copy?.reason, `${locale} reason missing for ${code}`).toBeTruthy();
			expect(copy?.fix, `${locale} fix missing for ${code}`).toBeTruthy();
		}
	});

	it.each(LOCALES)("%s resolves both i18n keys of every failure code", (locale) => {
		for (const code of PAYOUT_FAILURE_CODES) {
			const reasonKey = PAYOUT_FAILURE_REASON_KEY[code];
			const fixKey = PAYOUT_FAILURE_FIX_KEY[code];
			// A key that resolves to itself means there is no copy behind it.
			expect(translatePayoutKey(locale, reasonKey)).not.toBe(reasonKey);
			expect(translatePayoutKey(locale, fixKey)).not.toBe(fixKey);
		}
	});

	it.each(LOCALES)("%s has chrome for both payout email kinds", (locale) => {
		for (const kind of PAYOUT_EMAIL_KINDS) {
			const chrome = getPayoutEmailChrome(locale, kind);
			expect(chrome?.subject, `${locale} subject missing for ${kind}`).toBeTruthy();
			expect(chrome?.safeLine, `${locale} reassurance missing for ${kind}`).toBeTruthy();
			expect(chrome?.cta, `${locale} cta missing for ${kind}`).toBeTruthy();
		}
	});

	it.each(LOCALES)("%s never puts a raw Stripe identifier in the copy", (locale) => {
		// Only the snake_case codes: `declined` on its own is an ordinary English
		// word and appears in the copy legitimately, while `debit_not_authorized`
		// could only get there by somebody pasting Stripe's identifier.
		const identifiers = PAYOUT_FAILURE_CODES.filter((code) => code.includes("_"));
		expect(identifiers.length).toBeGreaterThan(10);

		for (const code of PAYOUT_FAILURE_CODES) {
			const copy = getPayoutFailureCopy(locale, code);
			const rendered = `${copy.reason} ${copy.fix}`;
			for (const identifier of identifiers) {
				expect(rendered, `${locale}/${code} leaks the raw code ${identifier}`).not.toContain(
					identifier
				);
			}
		}
	});
});

describe("renderPayoutEmail", () => {
	it("leads with the reassurance, then the amount, then the reason, then the fix", async () => {
		const { subject, html, text } = await renderPayoutEmail({ ...baseContext, locale: "en" });

		expect(subject).toContain("the money is safe");
		expect(html).toContain("This money is yours and it is safe.");
		expect(html).toContain("12,450.00 MXN");
		expect(html).toContain("La Cocina");

		// The order on the page is the promise: reassurance before the problem.
		const safeAt = text.indexOf("This money is yours and it is safe");
		const reasonAt = text.indexOf("is not valid");
		const fixAt = text.indexOf("Re-enter the account number");
		expect(safeAt).toBeGreaterThanOrEqual(0);
		expect(safeAt).toBeLessThan(reasonAt);
		expect(reasonAt).toBeLessThan(fixAt);

		expect(text).toContain("https://app.tavliai.com/admin/payouts");
	});

	it("renders the Spanish failure from the same code", async () => {
		const { subject, html } = await renderPayoutEmail({ ...baseContext, locale: "es" });

		expect(subject).toContain("tu dinero está seguro");
		expect(html).toContain("Este dinero es tuyo y está seguro.");
		expect(html).toContain("Revisar tus depósitos");
	});

	it("never renders the raw Stripe code, even for one Stripe has not documented", async () => {
		const { html } = await renderPayoutEmail({
			...baseContext,
			locale: "en",
			// What `normalizePayoutFailureCode` hands over for anything unrecognised.
			failureCode: PAYOUT_FAILURE_CODE.UNKNOWN,
		});
		expect(html).toContain("did not say why");
		expect(html).not.toContain("failure_code");
	});

	it("falls back to the unknown copy when no code arrived at all", async () => {
		const { html } = await renderPayoutEmail({
			...baseContext,
			locale: "en",
			failureCode: undefined,
		});
		expect(html).toContain("did not say why");
	});

	it("renders the resumed email with its own reason and no fix to perform", async () => {
		const { subject, html } = await renderPayoutEmail({
			...baseContext,
			locale: "en",
			kind: NOTIFICATION_KIND.PAYOUTS_RESUMED,
			failureCode: undefined,
		});

		expect(subject).toContain("flowing again");
		expect(html).toContain("Your money reached your bank.");
		expect(html).toContain("you are all set");
	});

	it("omits the restaurant line when the restaurant was purged before delivery", async () => {
		const { html } = await renderPayoutEmail({
			...baseContext,
			locale: "en",
			restaurantName: null,
		});
		expect(html).not.toContain("Restaurant:");
	});
});
