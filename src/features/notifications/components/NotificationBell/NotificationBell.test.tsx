/**
 * The manager's notification bell (TAVLI-111).
 *
 * What is pinned here is what a manager would notice being wrong: the badge says
 * how many are unread, the panel says what happened in the page's own words
 * (never backend prose), an item that carries an `href` links to the page that
 * explains it and marks itself read on the way, the two mark-read controls name
 * the row they clear, and a signed-out visitor gets no bell at all.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useConvexAuth } from "convex/react";
import { NOTIFICATION_KIND } from "convex/constants";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "./NotificationBell";

vi.mock("@tanstack/react-query", () => ({
	useMutation: vi.fn(),
	useQuery: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	convexQuery: (ref: any, args: unknown) => ({ queryKey: [getFunctionName(ref)], ref, args }),
	useConvexMutation: (ref: unknown) => ref,
}));

vi.mock("convex/react", () => ({
	useConvexAuth: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Link: ({ children, ...rest }: any) => <a {...rest}>{children}</a>,
}));

vi.mock("react-i18next", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-i18next")>();
	return {
		...actual,
		useTranslation: () => ({
			// Keys, plus their interpolation values, so a test can tell
			// "3 unread" from "some unread".
			t: (key: string, params?: Record<string, unknown>) =>
				params && Object.keys(params).length > 0
					? `${key} ${Object.values(params).join(" ")}`
					: key,
			i18n: { language: "en" },
		}),
	};
});

type MutationCall = { name: string; args: unknown };

const calls: MutationCall[] = [];
/** `enabled` as the component passed it, per Convex function name. */
const queryEnabled: Record<string, boolean | undefined> = {};

const NOW = Date.now();

const PAYOUT_FAILED = {
	_id: "notifications:payout",
	_creationTime: 2,
	userId: "user_manager_a",
	restaurantId: "restaurants:cocina",
	restaurantName: "La Cocina",
	kind: NOTIFICATION_KIND.PAYOUT_FAILED,
	messageKey: "notifications.kind.payoutFailed.body",
	href: "/admin/payments",
	createdAt: NOW - 60_000,
};

const DISPUTE_WON_READ = {
	_id: "notifications:won",
	_creationTime: 1,
	userId: "user_manager_a",
	restaurantId: "restaurants:cocina",
	restaurantName: "La Cocina",
	kind: NOTIFICATION_KIND.DISPUTE_WON,
	messageKey: "notifications.kind.disputeWon.body",
	readAt: NOW - 30_000,
	createdAt: NOW - 120_000,
};

function mockBell(args: { unread: number; rows?: unknown[]; listError?: Error }) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	vi.mocked(useQuery).mockImplementation((options: any) => {
		const name = String(options.queryKey[0]);
		queryEnabled[name] = options.enabled;
		const isCount = name.includes("unreadCount");
		return {
			data: isCount ? args.unread : options.enabled ? (args.rows ?? []) : undefined,
			error: isCount ? null : (args.listError ?? null),
			isLoading: false,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any;
	});
}

function openPanel() {
	fireEvent.click(screen.getByRole("button", { expanded: false }));
	return screen.getByRole("dialog");
}

beforeEach(() => {
	calls.length = 0;
	for (const key of Object.keys(queryEnabled)) delete queryEnabled[key];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	vi.mocked(useConvexAuth).mockReturnValue({ isLoading: false, isAuthenticated: true } as any);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	vi.mocked(useMutation).mockImplementation((options: any) => {
		const name = getFunctionName(options.mutationFn);
		return {
			mutateAsync: async (args: unknown) => {
				calls.push({ name, args });
				return [args, null];
			},
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any;
	});
});

describe("NotificationBell", () => {
	it("says how many are unread, and stays quiet when nothing is", () => {
		mockBell({ unread: 3 });
		const withUnread = render(<NotificationBell />);

		const bell = screen.getByRole("button");
		expect(bell.getAttribute("aria-label")).toBe("notifications.bell.unreadCount 3");
		expect(within(bell).getByText("3")).toBeTruthy();
		withUnread.unmount();

		mockBell({ unread: 0 });
		render(<NotificationBell />);

		const quiet = screen.getByRole("button");
		expect(quiet.getAttribute("aria-label")).toBe("notifications.bell.label");
		expect(within(quiet).queryByText("0")).toBeNull();
	});

	it("caps the badge instead of widening the sidebar", () => {
		mockBell({ unread: 250 });
		render(<NotificationBell />);

		expect(within(screen.getByRole("button")).getByText("99+")).toBeTruthy();
		// The real number still reaches a screen reader through the label.
		expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
			"notifications.bell.unreadCount 250"
		);
	});

	it("does not subscribe to the list until the panel is opened", () => {
		mockBell({ unread: 1, rows: [PAYOUT_FAILED] });
		render(<NotificationBell />);

		expect(queryEnabled["notifications:unreadCount"]).toBe(true);
		expect(queryEnabled["notifications:listMine"]).toBe(false);
		expect(screen.queryByRole("dialog")).toBeNull();

		openPanel();

		expect(queryEnabled["notifications:listMine"]).toBe(true);
	});

	it("lists the notifications newest first, in the page's own words", () => {
		mockBell({ unread: 1, rows: [PAYOUT_FAILED, DISPUTE_WON_READ] });
		render(<NotificationBell />);
		const panel = openPanel();

		const titles = within(panel)
			.getAllByText(/^notifications\.kind\..*\.title$/)
			.map((node) => node.textContent);
		expect(titles).toEqual([
			"notifications.kind.payoutFailed.title",
			"notifications.kind.disputeWon.title",
		]);
		// The stored key is what the row renders — never backend prose.
		expect(within(panel).getByText("notifications.kind.payoutFailed.body")).toBeTruthy();
		// Every row says which restaurant it is about and how long ago it happened —
		// a manager of two restaurants has to be able to tell them apart.
		expect(within(panel).getAllByText(/^La Cocina · time\.relative\./)).toHaveLength(2);
	});

	it("offers mark-read only on the unread ones, and names the row it clears", async () => {
		mockBell({ unread: 1, rows: [PAYOUT_FAILED, DISPUTE_WON_READ] });
		render(<NotificationBell />);
		const panel = openPanel();

		const markRead = within(panel).getAllByText("notifications.bell.markRead");
		expect(markRead).toHaveLength(1);

		fireEvent.click(markRead[0]);

		await waitFor(() => expect(calls).toHaveLength(1));
		expect(calls[0].name).toBe("notifications:markRead");
		expect(calls[0].args).toEqual({ notificationId: PAYOUT_FAILED._id });
	});

	it("links an item with an href to the page that explains it, and marks it read", async () => {
		mockBell({ unread: 1, rows: [PAYOUT_FAILED] });
		render(<NotificationBell />);
		const panel = openPanel();

		const link = within(panel).getByText("notifications.kind.payoutFailed.title").closest("a");
		expect(link?.getAttribute("to")).toBe("/admin/payments");

		fireEvent.click(link!);

		await waitFor(() => expect(calls).toHaveLength(1));
		expect(calls[0].args).toEqual({ notificationId: PAYOUT_FAILED._id });
		// Following a link closes the panel behind you.
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("marks an href-less item read in place, without navigating", async () => {
		const noHref = { ...PAYOUT_FAILED, href: undefined };
		mockBell({ unread: 1, rows: [noHref] });
		render(<NotificationBell />);
		const panel = openPanel();

		expect(within(panel).queryByRole("link")).toBeNull();
		fireEvent.click(within(panel).getByText("notifications.kind.payoutFailed.title"));

		await waitFor(() => expect(calls).toHaveLength(1));
		expect(screen.getByRole("dialog")).toBeTruthy();
	});

	it("clears the whole list from the panel header", async () => {
		mockBell({ unread: 2, rows: [PAYOUT_FAILED] });
		render(<NotificationBell />);
		const panel = openPanel();

		fireEvent.click(within(panel).getByText("notifications.bell.markAllRead"));

		await waitFor(() => expect(calls).toHaveLength(1));
		expect(calls[0].name).toBe("notifications:markAllRead");
	});

	it("hides mark-all-read once nothing is unread", () => {
		mockBell({ unread: 0, rows: [DISPUTE_WON_READ] });
		render(<NotificationBell />);
		const panel = openPanel();

		expect(within(panel).queryByText("notifications.bell.markAllRead")).toBeNull();
	});

	it("says nothing is new when the list is empty", () => {
		mockBell({ unread: 0, rows: [] });
		render(<NotificationBell />);
		const panel = openPanel();

		expect(within(panel).getByText("notifications.bell.emptyTitle")).toBeTruthy();
		expect(within(panel).getByText("notifications.bell.emptyDescription")).toBeTruthy();
	});

	it("admits it could not load rather than showing an empty bell", () => {
		mockBell({ unread: 1, rows: [PAYOUT_FAILED], listError: new Error("NOT_AUTHENTICATED") });
		render(<NotificationBell />);
		const panel = openPanel();

		expect(within(panel).getByText("notifications.bell.loadFailed")).toBeTruthy();
		expect(within(panel).queryByText("notifications.kind.payoutFailed.title")).toBeNull();
	});

	it("moves focus into the panel, and hands it back to the bell on close", () => {
		mockBell({ unread: 1, rows: [PAYOUT_FAILED] });
		render(<NotificationBell />);
		const bell = screen.getByRole("button", { expanded: false });

		const panel = openPanel();
		// Without this the portalled panel sits at the end of <body>, so Tab from
		// the bell would walk the whole page before reaching it.
		expect(document.activeElement).toBe(panel);

		fireEvent.keyDown(document, { key: "Escape" });
		// And dismissing it must not strand focus on <body>.
		expect(document.activeElement).toBe(bell);
	});

	it("closes on Escape, and on a click outside it", () => {
		mockBell({ unread: 1, rows: [PAYOUT_FAILED] });
		render(<NotificationBell />);
		openPanel();

		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();

		openPanel();
		fireEvent.pointerDown(document.body);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("dates every row against one clock reading, taken when the panel opened", () => {
		// A clock that jumps a minute on every reading. A component that read it
		// during a row's render would date the two rows from different moments; one
		// that reads it once, on open, cannot.
		let ticks = 0;
		const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => NOW + ticks++ * 60_000);
		mockBell({ unread: 1, rows: [PAYOUT_FAILED, DISPUTE_WON_READ] });
		render(<NotificationBell />);

		const panel = openPanel();

		// The two rows were created 60s apart, so against one shared reading their
		// ages differ by exactly one minute. Per-row readings would drift them apart.
		const ages = within(panel)
			.getAllByText(/^La Cocina · time\.relative\.minAgo \d+$/)
			.map((node) => Number(node.textContent!.split(" ").at(-1)));
		expect(ages).toHaveLength(2);
		expect(ages[1] - ages[0]).toBe(1);
		nowSpy.mockRestore();
	});

	it("renders no bell at all for a visitor who is not signed in", () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.mocked(useConvexAuth).mockReturnValue({ isLoading: false, isAuthenticated: false } as any);
		mockBell({ unread: 0 });
		const { container } = render(<NotificationBell />);

		expect(container.firstChild).toBeNull();
		expect(screen.queryByRole("button")).toBeNull();
	});
});
