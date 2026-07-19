import type { Id } from "convex/_generated/dataModel";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { restoreSession, useSessionStore } from "./useSession";

const SESSION_ID = "sessions:test" as Id<"sessions">;
const RESTAURANT_ID = "restaurants:test" as Id<"restaurants">;

describe("useSessionStore", () => {
	beforeEach(() => {
		useSessionStore.setState({ sessionId: null, restaurantId: null });
		sessionStorage.clear();
	});

	it("does not notify subscribers when clearing an already-empty session", () => {
		const listener = vi.fn();
		const unsubscribe = useSessionStore.subscribe(listener);

		useSessionStore.getState().clearSession();
		useSessionStore.getState().clearSession();

		expect(listener).not.toHaveBeenCalled();
		unsubscribe();
	});

	it("notifies once when clearing an active session, then stays quiet", () => {
		useSessionStore.getState().setSession({
			sessionId: SESSION_ID,
			restaurantId: RESTAURANT_ID,
		});

		const listener = vi.fn();
		const unsubscribe = useSessionStore.subscribe(listener);

		useSessionStore.getState().clearSession();
		useSessionStore.getState().clearSession();

		expect(listener).toHaveBeenCalledTimes(1);
		expect(useSessionStore.getState().sessionId).toBeNull();
		expect(useSessionStore.getState().restaurantId).toBeNull();
		unsubscribe();
	});

	it("clears stored session data even when the in-memory state was already empty", () => {
		sessionStorage.setItem(
			"tavli_session",
			JSON.stringify({ sessionId: SESSION_ID, restaurantId: RESTAURANT_ID })
		);

		useSessionStore.getState().clearSession();

		expect(restoreSession()).toBeNull();
	});

	it("does not notify subscribers when setting the same session twice", () => {
		useSessionStore.getState().setSession({
			sessionId: SESSION_ID,
			restaurantId: RESTAURANT_ID,
		});

		const listener = vi.fn();
		const unsubscribe = useSessionStore.subscribe(listener);

		useSessionStore.getState().setSession({
			sessionId: SESSION_ID,
			restaurantId: RESTAURANT_ID,
		});

		expect(listener).not.toHaveBeenCalled();
		unsubscribe();
	});

	it("notifies when the session actually changes", () => {
		useSessionStore.getState().setSession({
			sessionId: SESSION_ID,
			restaurantId: RESTAURANT_ID,
		});

		const listener = vi.fn();
		const unsubscribe = useSessionStore.subscribe(listener);

		useSessionStore.getState().setSession({
			sessionId: "sessions:other" as Id<"sessions">,
			restaurantId: RESTAURANT_ID,
		});

		expect(listener).toHaveBeenCalledTimes(1);
		expect(useSessionStore.getState().sessionId).toBe("sessions:other");
		unsubscribe();
	});
});
