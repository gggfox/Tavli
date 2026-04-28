/**
 * Lightweight in-app toast store.
 *
 * Backed by Zustand (already a dep). The store exposes a single `pushToast`
 * action; consumers listen via `useNotificationStore`. Toasts auto-dismiss
 * after `autoDismissMs` unless that's explicitly null.
 *
 * This is deliberately not coupled to any specific notification source --
 * any feature can `pushToast({ kind, title, ... })`. The reservations
 * listener (see `src/features/reservations/hooks/useNewReservationListener.ts`)
 * is the first caller.
 */
import { create } from "zustand";

export type ToastKind = "info" | "reservation" | "warning" | "error" | "success";

export interface Toast {
	id: string;
	kind: ToastKind;
	title: string;
	body?: string;
	actionHref?: string;
	actionLabel?: string;
	createdAt: number;
	autoDismissMs?: number | null;
}

interface NotificationState {
	toasts: Toast[];
	pushToast: (toast: Omit<Toast, "createdAt"> & { createdAt?: number }) => void;
	dismissToast: (id: string) => void;
	clearAll: () => void;
}

export const DEFAULT_AUTO_DISMISS_MS = 8000;

export const useNotificationStore = create<NotificationState>((set, get) => ({
	toasts: [],
	pushToast: (toast) => {
		// Dedupe by id -- prevents the listener from re-pushing the same
		// reservation toast when the underlying query result re-emits.
		if (get().toasts.some((t) => t.id === toast.id)) return;
		const next: Toast = {
			...toast,
			createdAt: toast.createdAt ?? Date.now(),
		};
		set((state) => ({ toasts: [...state.toasts, next] }));
	},
	dismissToast: (id) => {
		set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
	},
	clearAll: () => set({ toasts: [] }),
}));

/** Convenience for callers outside React (e.g. in cron-side code). */
export function pushToast(toast: Omit<Toast, "createdAt"> & { createdAt?: number }): void {
	useNotificationStore.getState().pushToast(toast);
}
