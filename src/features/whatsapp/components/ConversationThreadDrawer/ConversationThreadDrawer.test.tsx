/**
 * The read-only WhatsApp thread staff open from a reservation (TAVLI-93).
 *
 * What is pinned here is what staff would be misled by if it broke: the thread
 * shows the words the diner actually received, a reply that never arrived says
 * so, each message names who wrote it, and a long thread admits it is showing
 * only the recent end of itself.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { useConvexAuth } from "convex/react";
import { WHATSAPP_CONVERSATION_MAX_MESSAGES } from "convex/constants";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsappKeys } from "@/global/i18n";
import { ConversationThreadDrawer } from "./ConversationThreadDrawer";

vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: unknown, args: unknown) => ({ queryKey: ["thread", args], ref, args }),
}));

vi.mock("convex/react", () => ({ useConvexAuth: vi.fn() }));

vi.mock("react-i18next", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-i18next")>();
	return {
		...actual,
		useTranslation: () => ({
			t: (key: string, options?: Record<string, unknown>) =>
				options?.count === undefined ? key : `${key}:${options.count}`,
			i18n: { language: "en" },
		}),
	};
});

/** Query args the component asked for, newest last. */
const requestedArgs: unknown[] = [];

type ThreadOverrides = {
	messages?: unknown[];
	hasOlder?: boolean;
	atMaxWindow?: boolean;
};

function mockThread(overrides: ThreadOverrides = {}) {
	vi.mocked(useQuery).mockImplementation(((options: { args?: unknown }) => {
		requestedArgs.push(options.args);
		return {
			data: {
				conversation: {
					_id: "whatsappConversations:1",
					customerPhone: "+528114906208",
					customerName: "Ana",
					status: "active",
					lastMessageAt: 1_700_000_000_000,
					lastInboundAt: 1_700_000_000_000,
					createdAt: 1_699_000_000_000,
				},
				messages: overrides.messages ?? [],
				hasOlder: overrides.hasOlder ?? false,
				atMaxWindow: overrides.atMaxWindow ?? false,
			},
			isLoading: false,
			isError: false,
			error: null,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	}) as any);
}

const message = (overrides: Record<string, unknown>) => ({
	_id: `whatsappMessages:${Math.random()}`,
	direction: "outbound",
	sentBy: "assistant",
	body: "hola",
	createdAt: 1_700_000_000_000,
	...overrides,
});

/**
 * `<dialog>`-based Drawer runs a two-frame phase machine before painting.
 *
 * Note these tests query by text, not by role: jsdom does not set the `open`
 * attribute from `showModal()`, so everything inside the dialog is treated as
 * hidden and `getByRole` finds nothing.
 */
async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 50));
	});
}

async function renderThread(overrides: ThreadOverrides = {}) {
	mockThread(overrides);
	render(
		<ConversationThreadDrawer
			conversationId={"whatsappConversations:1" as never}
			onClose={vi.fn()}
		/>
	);
	await settle();
}

beforeEach(() => {
	requestedArgs.length = 0;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	vi.mocked(useConvexAuth).mockReturnValue({ isLoading: false, isAuthenticated: true } as any);
});

describe("ConversationThreadDrawer", () => {
	it("shows what the diner received, and who said it", async () => {
		await renderThread({
			messages: [
				message({ direction: "inbound", sentBy: null, body: "¿tienen mesa?" }),
				message({ body: "¡Sí! ✅ Reservación confirmada." }),
			],
		});

		expect(screen.getByText("¿tienen mesa?")).toBeInTheDocument();
		expect(screen.getByText("¡Sí! ✅ Reservación confirmada.")).toBeInTheDocument();
		expect(screen.getByText(WhatsappKeys.SENDER_CUSTOMER)).toBeInTheDocument();
		expect(screen.getByText(WhatsappKeys.SENDER_ASSISTANT)).toBeInTheDocument();
	});

	it("marks a reply the diner never received", async () => {
		await renderThread({
			messages: [
				message({ body: "delivered" }),
				message({ body: "never arrived", deliveryFailedAt: 1_700_000_500_000 }),
			],
		});

		// "The bot never answered me" is a common complaint; this row is the
		// evidence, so it must be visible rather than quietly rendered as sent.
		expect(screen.getAllByText(WhatsappKeys.MESSAGE_UNDELIVERED)).toHaveLength(1);
	});

	it("says the thread is read-only", async () => {
		await renderThread({ messages: [message({})] });

		expect(screen.getByText(WhatsappKeys.THREAD_READ_ONLY)).toBeInTheDocument();
	});

	it("widens the window when staff ask for older messages", async () => {
		await renderThread({ messages: [message({})], hasOlder: true });
		const initial = (requestedArgs.at(-1) as { limit?: number }).limit;

		fireEvent.click(screen.getByText(WhatsappKeys.THREAD_LOAD_OLDER));
		await settle();

		const widened = (requestedArgs.at(-1) as { limit?: number }).limit;
		expect(widened).toBeGreaterThan(initial ?? 0);
	});

	it("offers nothing to load when the whole thread is on screen", async () => {
		await renderThread({ messages: [message({})], hasOlder: false });

		expect(screen.queryByText(WhatsappKeys.THREAD_LOAD_OLDER)).not.toBeInTheDocument();
	});

	it("admits truncation instead of offering a button that cannot help", async () => {
		await renderThread({ messages: [message({})], hasOlder: true, atMaxWindow: true });

		expect(screen.queryByText(WhatsappKeys.THREAD_LOAD_OLDER)).not.toBeInTheDocument();
		expect(
			screen.getByText(`${WhatsappKeys.THREAD_WINDOW_FULL}:${WHATSAPP_CONVERSATION_MAX_MESSAGES}`)
		).toBeInTheDocument();
	});

	it("says so when the thread has no messages", async () => {
		await renderThread({ messages: [] });

		expect(screen.getByText(WhatsappKeys.THREAD_EMPTY)).toBeInTheDocument();
	});
});
