import type { Id } from "convex/_generated/dataModel";
import { create } from "zustand";

interface SessionState {
	sessionId: Id<"sessions"> | null;
	restaurantId: Id<"restaurants"> | null;
	setSession: (data: { sessionId: Id<"sessions">; restaurantId: Id<"restaurants"> }) => void;
	clearSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
	sessionId: null,
	restaurantId: null,
	setSession: (data) => {
		set(data);
		try {
			sessionStorage.setItem("tavli_session", JSON.stringify(data));
		} catch {
			// SSR or sessionStorage unavailable
		}
	},
	clearSession: () => {
		set({ sessionId: null, restaurantId: null });
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
