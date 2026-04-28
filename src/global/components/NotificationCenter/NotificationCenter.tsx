/**
 * Fixed-corner toast surface mounted once in the staff layout. Reads from
 * `useNotificationStore` and renders a stack of toasts with auto-dismiss
 * timers + a manual close button.
 *
 * Styling follows the project's CSS-variable theming (--bg-elevated,
 * --border-default, etc.) so the surface tracks light/dark mode without
 * extra wiring.
 */
import { useEffect } from "react";
import { Bell, CalendarClock, CheckCircle, Info, X, AlertTriangle, AlertCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { DEFAULT_AUTO_DISMISS_MS, ToastKind, useNotificationStore } from "./store";

const ICONS: Record<ToastKind, typeof Bell> = {
	info: Info,
	reservation: CalendarClock,
	success: CheckCircle,
	warning: AlertTriangle,
	error: AlertCircle,
};

const ACCENT_VAR: Record<ToastKind, string> = {
	info: "var(--accent-info, var(--text-secondary))",
	reservation: "var(--accent-primary, var(--text-primary))",
	success: "var(--accent-success)",
	warning: "var(--accent-warning, var(--accent-primary))",
	error: "var(--accent-danger)",
};

export function NotificationCenter() {
	const toasts = useNotificationStore((s) => s.toasts);
	const dismissToast = useNotificationStore((s) => s.dismissToast);

	useEffect(() => {
		const timers = toasts
			.filter((t) => t.autoDismissMs !== null)
			.map((t) => {
				const ms = t.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS;
				const elapsed = Date.now() - t.createdAt;
				const remaining = Math.max(ms - elapsed, 0);
				return globalThis.setTimeout(() => dismissToast(t.id), remaining);
			});
		return () => {
			for (const timer of timers) globalThis.clearTimeout(timer);
		};
	}, [toasts, dismissToast]);

	if (toasts.length === 0) return null;

	return (
		<section
			className="fixed z-50 flex flex-col gap-2"
			style={{ bottom: "1rem", right: "1rem", maxWidth: "22rem" }}
			aria-label="Notifications"
		>
			{toasts.map((t) => {
				const Icon = ICONS[t.kind];
				return (
					<output
						key={t.id}
						className="flex items-start gap-3 rounded-lg px-4 py-3 shadow-lg"
						style={{
							backgroundColor: "var(--bg-elevated, var(--bg-secondary))",
							border: "1px solid var(--border-default)",
							color: "var(--text-primary)",
						}}
					>
						<Icon size={18} style={{ color: ACCENT_VAR[t.kind], flexShrink: 0, marginTop: 2 }} />
						<div className="flex-1 min-w-0">
							<p className="text-sm font-medium">{t.title}</p>
							{t.body && (
								<p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
									{t.body}
								</p>
							)}
							{t.actionHref && (
								<Link
									to={t.actionHref}
									className="text-xs font-medium mt-2 inline-block"
									style={{ color: ACCENT_VAR[t.kind] }}
									onClick={() => dismissToast(t.id)}
								>
									{t.actionLabel ?? "View"}
								</Link>
							)}
						</div>
						<button
							type="button"
							onClick={() => dismissToast(t.id)}
							className="p-1 rounded-md"
							style={{ color: "var(--text-muted)" }}
							aria-label="Dismiss"
						>
							<X size={14} />
						</button>
					</output>
				);
			})}
		</section>
	);
}
