/* eslint-disable @typescript-eslint/no-explicit-any */
import { OrderingKeys } from "@/global/i18n";
import { useAuth } from "@clerk/tanstack-react-start";
import { useConvexMutation } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { Id } from "convex/_generated/dataModel";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCustomerSession } from "./useCustomerSession";
import { useSessionStore } from "./useSession";

vi.mock("@clerk/tanstack-react-start", () => ({
	useAuth: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
	useConvexMutation: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
}));

const SLUG = "vernaculo-spgg";
const STORED_SESSION_ID = "sessions:stored" as Id<"sessions">;
const RESTAURANT_ID = "restaurants:test" as Id<"restaurants">;

function mockAuth(state: { isLoaded: boolean; isSignedIn: boolean }) {
	vi.mocked(useAuth).mockReturnValue(state as any);
}

function mockRestoreQuery(data: unknown, isPending = false) {
	vi.mocked(useQuery).mockReturnValue({ data, isPending } as any);
}

/**
 * Hands the hook a *fresh function identity on every render* — the worst case a
 * `useMutation({ mutationFn })` wrapper produces. The hook must stay stable
 * anyway, so this is what keeps the re-render loop from creeping back in.
 */
function mockCreateSession(impl: (args: unknown) => Promise<unknown>) {
	const createSession = vi.fn(impl);
	vi.mocked(useConvexMutation).mockImplementation(
		() => ((args: unknown) => createSession(args)) as any
	);
	return createSession;
}

describe("useCustomerSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useSessionStore.setState({ sessionId: null, restaurantId: null });
		sessionStorage.clear();
		mockRestoreQuery(undefined);
	});

	it("creates no session and reports a signed-out visitor without looping", () => {
		// The regression: clearSession() notified subscribers even when the store
		// was already empty, re-running the effect until React bailed out with
		// "Maximum update depth exceeded".
		const createSession = mockCreateSession(async () => ({}));
		mockAuth({ isLoaded: true, isSignedIn: false });

		const { result } = renderHook(() => useCustomerSession(SLUG));

		expect(result.current.isSignedIn).toBe(false);
		expect(result.current.sessionId).toBeNull();
		expect(result.current.errorKey).toBeNull();
		expect(createSession).not.toHaveBeenCalled();
	});

	it("waits for Clerk before touching the session", () => {
		const createSession = mockCreateSession(async () => ({}));
		mockAuth({ isLoaded: false, isSignedIn: false });

		const { result } = renderHook(() => useCustomerSession(SLUG));

		expect(result.current.isLoaded).toBe(false);
		expect(createSession).not.toHaveBeenCalled();
	});

	it("creates exactly one session for a signed-in visitor", async () => {
		const createSession = mockCreateSession(async () => ({
			sessionId: "sessions:new",
			restaurantId: RESTAURANT_ID,
		}));
		mockAuth({ isLoaded: true, isSignedIn: true });

		const { result } = renderHook(() => useCustomerSession(SLUG));

		await waitFor(() => {
			expect(result.current.sessionId).toBe("sessions:new");
		});
		expect(createSession).toHaveBeenCalledTimes(1);
		expect(createSession).toHaveBeenCalledWith({ restaurantSlug: SLUG });
		expect(useSessionStore.getState().restaurantId).toBe(RESTAURANT_ID);
	});

	it("restores a still-active session from storage instead of creating one", async () => {
		sessionStorage.setItem(
			"tavli_session",
			JSON.stringify({ sessionId: STORED_SESSION_ID, restaurantId: RESTAURANT_ID })
		);
		const createSession = mockCreateSession(async () => ({}));
		mockRestoreQuery({ _id: STORED_SESSION_ID, restaurantId: RESTAURANT_ID });
		mockAuth({ isLoaded: true, isSignedIn: true });

		const { result } = renderHook(() => useCustomerSession(SLUG));

		await waitFor(() => {
			expect(result.current.sessionId).toBe(STORED_SESSION_ID);
		});
		expect(createSession).not.toHaveBeenCalled();
	});

	it("stops retrying after session creation fails", async () => {
		const createSession = mockCreateSession(async () => {
			throw new Error("Restaurant not found");
		});
		mockAuth({ isLoaded: true, isSignedIn: true });

		const { result, rerender } = renderHook(() => useCustomerSession(SLUG));

		await waitFor(() => {
			expect(result.current.errorKey).toBe(OrderingKeys.SESSION_ERROR_NOT_FOUND);
		});
		rerender();
		rerender();

		expect(createSession).toHaveBeenCalledTimes(1);
		expect(result.current.sessionId).toBeNull();
	});
});
