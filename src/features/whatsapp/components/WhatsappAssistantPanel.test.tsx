/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WhatsappAssistantPanel } from "./WhatsappAssistantPanel";

const DEEP_LINK =
	"https://wa.me/14155238886?text=Hola%2C%20quiero%20informaci%C3%B3n%20sobre%20Vern%C3%A1culo%20%C2%B7%20VRN-8F3";

function renderPanel(overrides: Partial<React.ComponentProps<typeof WhatsappAssistantPanel>> = {}) {
	return render(
		<WhatsappAssistantPanel
			restaurantName="Vernáculo"
			formattedShortCode="VRN-8F3"
			deepLinkUrl={DEEP_LINK}
			deepLinkText="Hola, quiero información sobre Vernáculo · VRN-8F3"
			{...overrides}
		/>
	);
}

describe("WhatsappAssistantPanel", () => {
	it("links straight to the wa.me deep link", () => {
		renderPanel();
		const link = screen.getByRole("link", { name: /whatsapp/i });
		expect(link.getAttribute("href")).toBe(DEEP_LINK);
	});

	it("shows the code, because staff read it aloud and diners retype it", () => {
		renderPanel();
		expect(screen.getByText("VRN-8F3")).toBeTruthy();
	});

	it("renders a QR that encodes the same link, in black on white", () => {
		const { container } = renderPanel();
		const svg = container.querySelector("svg[data-testid='whatsapp-qr']");
		expect(svg).toBeTruthy();
		// Never themed: a QR in muted dark-mode colours fails to scan, and this
		// one exists to be printed on a table tent.
		expect(svg!.innerHTML).toContain('fill="white"');
		expect(svg!.innerHTML).toContain('fill="black"');
	});

	it("says the number is unconfigured rather than rendering a dead link", () => {
		renderPanel({ deepLinkUrl: null });
		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.queryByTestId("whatsapp-qr")).toBeNull();
		expect(screen.getByText(/not configured/i)).toBeTruthy();
	});

	it("shows the sentence a diner will actually send, since they can edit it first", () => {
		renderPanel();
		expect(screen.getByText(/Hola, quiero información sobre Vernáculo/)).toBeTruthy();
	});
});
