/**
 * The conversation list staff land on from the sidebar (TAVLI-93).
 *
 * The table itself is `AdminTable`, which has its own tests. What is pinned
 * here is this screen's own decisions: a diner with no WhatsApp display name
 * still has to be identifiable, and clicking a row is what opens the thread.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { useConvexAuth } from "convex/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsappKeys } from "@/global/i18n";
import { ConversationsTable } from "./ConversationsTable";

vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: unknown, args: unknown) => ({ queryKey: ["conversations"], ref, args }),
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

const ROW = {
	_id: "whatsappConversations:1",
	customerPhone: "+528114906208",
	customerName: "Ana",
	status: "active",
	lastMessageAt: 1_700_000_900_000,
	lastInboundAt: 1_700_000_900_000,
	createdAt: 1_699_000_000_000,
};

function mockRows(rows: unknown[]) {
	vi.mocked(useQuery).mockReturnValue({
		data: rows,
		isLoading: false,
		error: null,
		isError: false,
		refetch: vi.fn(),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any);
}

beforeEach(() => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	vi.mocked(useConvexAuth).mockReturnValue({ isLoading: false, isAuthenticated: true } as any);
});

describe("ConversationsTable", () => {
	it("labels a diner who never set a WhatsApp display name", () => {
		mockRows([{ ...ROW, customerName: undefined }]);

		render(<ConversationsTable restaurantId={"restaurants:1" as never} onSelect={vi.fn()} />);

		expect(screen.getByText(WhatsappKeys.CUSTOMER_UNKNOWN)).toBeInTheDocument();
		// The phone is the diner's real identity here, and it is already visible
		// on the reservation, so showing it is consistent.
		expect(screen.getByText("+528114906208")).toBeInTheDocument();
	});

	it("opens the thread for the row that was clicked", () => {
		mockRows([ROW]);
		const onSelect = vi.fn();

		render(<ConversationsTable restaurantId={"restaurants:1" as never} onSelect={onSelect} />);
		fireEvent.click(screen.getByText("Ana"));

		expect(onSelect).toHaveBeenCalledWith("whatsappConversations:1");
	});

	it("translates the thread's lifecycle rather than showing the stored word", () => {
		mockRows([{ ...ROW, status: "handoff" }]);

		render(<ConversationsTable restaurantId={"restaurants:1" as never} onSelect={vi.fn()} />);

		expect(screen.getByText(WhatsappKeys.STATUS_HANDOFF)).toBeInTheDocument();
		expect(screen.queryByText("handoff")).not.toBeInTheDocument();
	});
});
