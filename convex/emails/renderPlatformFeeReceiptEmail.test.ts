import { describe, expect, it } from "vitest";
import { PLATFORM_MONTHLY_FEE_MXN_CENTS } from "../constants";
import {
	formatBillingPeriod,
	formatPlatformFeeAmount,
	renderPlatformFeeReceiptEmail,
	type PlatformFeeReceiptEmailContext,
} from "./renderPlatformFeeReceiptEmail";

const baseContext: Omit<PlatformFeeReceiptEmailContext, "locale"> = {
	restaurantName: "La Cocina",
	invoiceNumber: "TAVLI-0042",
	amountPaidCents: PLATFORM_MONTHLY_FEE_MXN_CENTS,
	currency: "MXN",
	periodStartMs: new Date("2026-06-01T00:00:00Z").getTime(),
	periodEndMs: new Date("2026-07-01T00:00:00Z").getTime(),
	hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_123/test_invoice",
};

describe("renderPlatformFeeReceiptEmail", () => {
	it("renders the English receipt issued by Tavli to the restaurant", async () => {
		const { subject, html, text } = await renderPlatformFeeReceiptEmail({
			...baseContext,
			locale: "en",
		});

		expect(subject).toBe("Tavli receipt — monthly subscription for La Cocina");
		expect(html).toContain("Subscription receipt");
		expect(html).toContain("Tavli platform subscription (monthly)");
		expect(html).toContain("$2,000.00 MXN");
		expect(html).toContain("TAVLI-0042");
		expect(html).toContain("June 1, 2026");
		expect(html).toContain("July 1, 2026");
		expect(html).toContain("https://invoice.stripe.com/i/acct_123/test_invoice");
		expect(text).toContain("Amount paid");
	});

	it("renders the Spanish receipt when locale is es", async () => {
		const { subject, html } = await renderPlatformFeeReceiptEmail({
			...baseContext,
			locale: "es",
		});

		expect(subject).toBe("Recibo Tavli — suscripción mensual de La Cocina");
		expect(html).toContain("Recibo de suscripción");
		expect(html).toContain("Suscripción a la plataforma Tavli (mensual)");
		expect(html).toContain("Monto pagado");
		expect(html).toContain("Ver comprobante");
		// "Factura" means CFDI in Mexico and Tavli does not issue one — the ES copy
		// must never call this receipt that.
		expect(html).not.toContain("Ver factura");
		expect(html).not.toContain(">Factura<");
	});

	it("keeps the monthly subscription apart from the diner-paid service fee", async () => {
		const en = await renderPlatformFeeReceiptEmail({ ...baseContext, locale: "en" });
		const es = await renderPlatformFeeReceiptEmail({ ...baseContext, locale: "es" });

		expect(en.html).toContain("separate from the Tavli service fee your diners pay");
		expect(es.html).toContain("distinta de la tarifa de servicio Tavli");
	});

	it("shows the invoice's own amount, not the display constant", async () => {
		// A prorated first month: the constant would be a lie on this invoice.
		const { html } = await renderPlatformFeeReceiptEmail({
			...baseContext,
			locale: "en",
			amountPaidCents: 66667,
		});

		expect(html).toContain("$666.67 MXN");
		expect(html).not.toContain("$2,000.00 MXN");
	});

	it("drops the invoice line and CTA when Stripe supplied neither", async () => {
		const { html } = await renderPlatformFeeReceiptEmail({
			...baseContext,
			locale: "en",
			invoiceNumber: null,
			hostedInvoiceUrl: null,
		});

		expect(html).not.toContain("TAVLI-0042");
		expect(html).not.toContain("View invoice");
		// The amount block still renders — that is the point of the receipt.
		expect(html).toContain("$2,000.00 MXN");
	});
});

describe("platform fee formatting", () => {
	it("spells out the currency so a restaurant knows what it was billed in", () => {
		expect(formatPlatformFeeAmount(200000, "MXN")).toBe("$2,000.00 MXN");
		expect(formatPlatformFeeAmount(200000, "mxn")).toBe("$2,000.00 MXN");
		expect(formatPlatformFeeAmount(0, "USD")).toBe("$0.00 USD");
	});

	it("formats the billing period in the recipient's locale", () => {
		const start = new Date("2026-06-01T00:00:00Z").getTime();
		const end = new Date("2026-07-01T00:00:00Z").getTime();

		expect(formatBillingPeriod(start, end, "en")).toBe("June 1, 2026 – July 1, 2026");
		expect(formatBillingPeriod(start, end, "es")).toContain("junio");
	});
});
