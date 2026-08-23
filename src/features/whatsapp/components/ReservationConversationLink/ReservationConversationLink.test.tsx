/**
 * The link from a reservation to the thread it came from (TAVLI-93).
 *
 * This is the entry point the ticket is really about: staff are already on the
 * reservations screen when a diner says "but your bot told me…", and until now
 * there was nothing there to click.
 */
import { render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsappKeys } from "@/global/i18n";
import { ReservationConversationLink } from "./ReservationConversationLink";

vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: unknown, args: unknown) => ({ queryKey: ["link", args], ref, args }),
}));

vi.mock("@tanstack/react-router", () => ({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Link: ({ to, search, children, ...rest }: any) => (
		<a href={`${to}?conversation=${search?.conversation ?? ""}`} {...rest}>
			{children}
		</a>
	),
}));

vi.mock("react-i18next", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-i18next")>();
	return {
		...actual,
		useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
	};
});

const seen: Array<{ args: unknown }> = [];

function mockLink(data: unknown) {
	vi.mocked(useQuery).mockImplementation(((options: { args?: unknown }) => {
		seen.push({ args: options.args });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return { data, isLoading: false, isError: false, error: null } as any;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	}) as any);
}

beforeEach(() => {
	seen.length = 0;
});

describe("ReservationConversationLink", () => {
	it("links to the conversation a WhatsApp booking came from", () => {
		mockLink({ conversationId: "whatsappConversations:7", customerPhone: "+528114906208" });

		render(
			<ReservationConversationLink reservationId={"reservations:1" as never} source="whatsapp" />
		);

		const link = screen.getByRole("link", { name: WhatsappKeys.RESERVATION_LINK });
		expect(link).toHaveAttribute("href", "/admin/whatsapp?conversation=whatsappConversations:7");
	});

	it("renders nothing, and asks nothing, for a booking staff typed in", () => {
		mockLink({ conversationId: "whatsappConversations:7", customerPhone: "+528114906208" });

		const { container } = render(
			<ReservationConversationLink reservationId={"reservations:1" as never} source="staff" />
		);

		expect(container).toBeEmptyDOMElement();
		// A non-WhatsApp reservation has no thread by definition; asking anyway
		// would be a query per drawer open for an answer that is always null.
		expect(seen.every((call) => call.args === "skip")).toBe(true);
	});

	it("renders nothing when the thread is gone", () => {
		mockLink(null);

		const { container } = render(
			<ReservationConversationLink reservationId={"reservations:1" as never} source="whatsapp" />
		);

		expect(container).toBeEmptyDOMElement();
	});
});
