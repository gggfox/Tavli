import { describe, expect, it } from "vitest";
import { renderReceiptEmail, type ReceiptEmailContext } from "./renderReceiptEmail";

const baseContext: Omit<ReceiptEmailContext, "locale"> = {
	restaurantName: "La Cocina",
	taxInfo: {
		rfc: "COC010101ABC",
		razonSocial: "La Cocina S.A. de C.V.",
		fiscalAddress: "Av. Siempre Viva 123, Monterrey",
	},
	orderNumber: 42,
	orderDateMs: new Date("2026-06-06T15:00:00Z").getTime(),
	timezone: "America/Monterrey",
	items: [
		{ name: "Pozole", quantity: 2, lineTotalCents: 10000, refunded: false },
		{ name: "Agua de horchata", quantity: 1, lineTotalCents: 2500, refunded: true },
	],
	subtotalCents: 12500,
	feeCents: 1500,
	totalCents: 14000,
	tipCents: 2000,
	paymentHint: "card",
	contact: { email: null, phone: null, whatsAppUrl: null },
};

const withContact = {
	email: "hola@lacocina.mx",
	phone: "+528112345678",
	whatsAppUrl: "https://wa.me/528112345678",
};

describe("renderReceiptEmail", () => {
	it("renders the English receipt branded as the restaurant with the charged split", async () => {
		const { subject, html, text } = await renderReceiptEmail({ ...baseContext, locale: "en" });

		expect(subject).toBe("Your receipt from La Cocina");
		expect(html).toContain("La Cocina");
		expect(html).toContain("Order #42");
		expect(html).toContain("2x Pozole");
		expect(html).toContain("$100.00");
		expect(html).toContain("Subtotal");
		expect(html).toContain("$125.00");
		expect(html).toContain("$140.00");
		expect(html).toContain("Tip (this visit)");
		expect(html).toContain("$20.00");
		expect(html).toContain("Paid by card");
		expect(text).toContain("2x Pozole");
	});

	it("renders the Spanish receipt when locale is es", async () => {
		const { subject, html } = await renderReceiptEmail({ ...baseContext, locale: "es" });

		expect(subject).toBe("Tu recibo de La Cocina");
		expect(html).toContain("Recibo");
		expect(html).toContain("Pedido #42");
		expect(html).toContain("Tarifa de servicio Tavli (12%)");
		expect(html).toContain("Cobrada por Tavli");
		expect(html).toContain(
			"Este documento no es un CFDI. Para solicitar tu factura, contacta al restaurante."
		);
	});

	it("labels the fee line as Tavli's, with the charged-by attribution", async () => {
		const { html } = await renderReceiptEmail({ ...baseContext, locale: "en" });

		// The 12% comes from PLATFORM_APPLICATION_FEE_RATE, never hardcoded copy drift.
		expect(html).toContain("Tavli service fee (12%)");
		expect(html).toContain("Charged by Tavli");
		expect(html).toContain("$15.00");
	});

	it("always renders the not-a-CFDI footer", async () => {
		const { html, text } = await renderReceiptEmail({ ...baseContext, locale: "en" });

		expect(html).toContain(
			"This is not a CFDI (tax invoice). For a factura, contact the restaurant."
		);
		expect(text).toContain("This is not a CFDI");
	});

	it("promises no contact details when the restaurant has published none", async () => {
		const { html } = await renderReceiptEmail({ ...baseContext, locale: "en" });

		// The footer must not say "using the details below" when there are none —
		// that was the original dead end this block exists to close.
		expect(html).not.toContain("using the details below");
		expect(html).not.toContain("Contact La Cocina");
	});

	it("renders the contact block and points the footer at it", async () => {
		const { html } = await renderReceiptEmail({
			...baseContext,
			locale: "en",
			contact: withContact,
		});

		expect(html).toContain("using the details below");
		expect(html).toContain("Contact La Cocina");
		expect(html).toContain("mailto:hola@lacocina.mx");
		expect(html).toContain("tel:+528112345678");
		expect(html).toContain("https://wa.me/528112345678");
	});

	it("puts the contact rows after the disclaimer that points at them", async () => {
		const { html } = await renderReceiptEmail({
			...baseContext,
			locale: "en",
			contact: withContact,
		});

		// The copy literally says "using the details below", so rendering the
		// block above it makes the sentence wrong. `toContain` alone cannot catch
		// that — the order has to be asserted.
		expect(html.indexOf("using the details below")).toBeLessThan(html.indexOf("Contact La Cocina"));
	});

	it("omits the WhatsApp row when the number is not on WhatsApp", async () => {
		const { html } = await renderReceiptEmail({
			...baseContext,
			locale: "en",
			contact: { ...withContact, whatsAppUrl: null },
		});

		expect(html).toContain("tel:+528112345678");
		expect(html).not.toContain("wa.me");
	});

	it("keeps raw tel: and wa.me hrefs out of the plain-text part", async () => {
		const { text } = await renderReceiptEmail({
			...baseContext,
			locale: "en",
			contact: withContact,
		});

		// html-to-text only strips a `mailto:` prefix before deciding a link's
		// href duplicates its text, so without explicit selectors the plain-text
		// part reads "Phone: +52... tel:+52...".
		expect(text).toContain("+528112345678");
		expect(text).not.toContain("tel:+528112345678");
		expect(text).not.toContain("https://wa.me/");
	});

	it("localizes the contact labels", async () => {
		const { html } = await renderReceiptEmail({
			...baseContext,
			locale: "es",
			contact: withContact,
		});

		expect(html).toContain("Contacta a La Cocina");
		expect(html).toContain("Teléfono");
		expect(html).toContain("con los datos de abajo");
	});

	it("omits the tax block entirely when the restaurant configured no tax fields", async () => {
		const { html } = await renderReceiptEmail({
			...baseContext,
			locale: "en",
			taxInfo: {},
		});

		expect(html).not.toContain("Tax information");
		expect(html).not.toContain("RFC:");
	});

	it("renders a partial tax block from whichever fields exist", async () => {
		const { html } = await renderReceiptEmail({
			...baseContext,
			locale: "en",
			taxInfo: { rfc: "COC010101ABC" },
		});

		expect(html).toContain("Tax information");
		expect(html).toContain("RFC: COC010101ABC");
		expect(html).not.toContain("La Cocina S.A. de C.V.");
	});

	it("cash order: no fee line, paid-in-person hint", async () => {
		const { html } = await renderReceiptEmail({
			...baseContext,
			locale: "en",
			feeCents: 0,
			totalCents: 12500,
			tipCents: null,
			paymentHint: "in_person",
		});

		expect(html).not.toContain("Tavli service fee");
		expect(html).not.toContain("Charged by Tavli");
		expect(html).toContain("Paid in person");
		expect(html).not.toContain("Tip (this visit)");
	});

	it("marks refunded lines with the refunded note", async () => {
		const { html } = await renderReceiptEmail({ ...baseContext, locale: "en" });

		expect(html).toContain("1x Agua de horchata");
		expect(html).toContain("Refunded");
	});
});
