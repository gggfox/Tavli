import type { Id } from "convex/_generated/dataModel";
import { create } from "zustand";

interface SessionState {
	sessionId: Id<"sessions"> | null;
	restaurantId: Id<"restaurants"> | null;
	setSession: (data: { sessionId: Id<"sessions">; restaurantId: Id<"restaurants"> }) => void;
	clearSession: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
	sessionId: null,
	restaurantId: null,
	setSession: (data) => {
		// Zustand compares the *merged* object with Object.is, so a fresh object
		// literal always looks like a change and notifies every subscriber. Skip
		// the write when nothing actually changed, or callers that run on every
		// render can drive an unbounded re-render loop.
		const { sessionId, restaurantId } = get();
		if (sessionId !== data.sessionId || restaurantId !== data.restaurantId) {
			set(data);
		}
		try {
			sessionStorage.setItem("tavli_session", JSON.stringify(data));
		} catch {
			// SSR or sessionStorage unavailable
		}
	},
	clearSession: () => {
		const { sessionId, restaurantId } = get();
		if (sessionId !== null || restaurantId !== null) {
			set({ sessionId: null, restaurantId: null });
		}
		// Always drop the stored session, even when the in-memory state was
		// already empty — storage can hold a stale entry from a previous visit.
		try {
			sessionStorage.removeItem("tavli_session");
		} catch {
			// SSR or sessionStorage unavailable
		}
	},
}));

export function restoreSession(): {
	sessionId: Id<"sessions">;
	restaurantId: Id<"restaurants">;
} | null {
	try {
		const stored = sessionStorage.getItem("tavli_session");
		if (!stored) return null;
		return JSON.parse(stored);
	} catch {
		return null;
	}
}
