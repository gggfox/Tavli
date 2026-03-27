import type { Id } from "convex/_generated/dataModel";
import { create } from "zustand";

interface SessionState {
	sessionId: Id<"sessions"> | null;
	restaurantId: Id<"restaurants"> | null;
	tableId: Id<"tables"> | null;
	setSession: (data: {
		sessionId: Id<"sessions">;
		restaurantId: Id<"restaurants">;
		tableId: Id<"tables">;
	}) => void;
	clearSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
	sessionId: null,
	restaurantId: null,
	tableId: null,
	setSession: (data) => {
		set(data);
		try {
			sessionStorage.setItem("tavli_session", JSON.stringify(data));
		} catch {
			// SSR or sessionStorage unavailable
		}
	},
	clearSession: () => {
		set({ sessionId: null, restaurantId: null, tableId: null });
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
	tableId: Id<"tables">;
} | null {
	try {
		const stored = sessionStorage.getItem("tavli_session");
		if (!stored) return null;
		return JSON.parse(stored);
	} catch {
		return null;
	}
}
