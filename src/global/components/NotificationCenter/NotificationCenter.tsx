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
import {
	Bell,
	CalendarClock,
	CheckCircle,
	Info,
	X,
	AlertTriangle,
	AlertCircle,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CommonKeys } from "@/global/i18n";
import { DEFAULT_AUTO_DISMISS_MS, ToastKind, useNotificationStore } from "./store";

const ICONS: Record<ToastKind, typeof Bell> = {
	info: Info,
	reservation: CalendarClock,
	success: CheckCircle,
	warning: AlertTriangle,
	error: AlertCircle,
};

const ACCENT_VAR: Record<ToastKind, string> = {
	info: "var(--accent-info))",
	reservation: "var(--accent-primary))",
	success: "var(--accent-success)",
	warning: "var(--accent-warning))",
	error: "var(--accent-danger)",
};

export function NotificationCenter() {
	const { t } = useTranslation();
	const toasts = useNotificationStore((s) => s.toasts);
	const dismissToast = useNotificationStore((s) => s.dismissToast);

	useEffect(() => {
		const timers = toasts
			.filter((toast) => toast.autoDismissMs !== null)
			.map((toast) => {
				const ms = toast.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS;
				const elapsed = Date.now() - toast.createdAt;
				const remaining = Math.max(ms - elapsed, 0);
				return globalThis.setTimeout(() => dismissToast(toast.id), remaining);
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
			aria-label={t(CommonKeys.NOTIFICATIONS_REGION)}
		>
			{toasts.map((toast) => {
				const Icon = ICONS[toast.kind];
				return (
					<output
						key={toast.id}
						className="flex items-start gap-3 rounded-lg px-4 py-3 shadow-lg border border-border text-foreground"
						style={{ backgroundColor: "var(--bg-elevated)" }}
					>
						<Icon
							size={18}
							style={{ color: ACCENT_VAR[toast.kind], flexShrink: 0, marginTop: 2 }}
						/>
						<div className="flex-1 min-w-0">
							<p className="text-sm font-medium">{toast.title}</p>
							{toast.body && <p className="text-xs mt-1 text-muted-foreground">{toast.body}</p>}
							{toast.actionHref && (
								<Link
									to={toast.actionHref}
									className="text-xs font-medium mt-2 inline-block"
									style={{ color: ACCENT_VAR[toast.kind] }}
									onClick={() => dismissToast(toast.id)}
								>
									{toast.actionLabel ?? t(CommonKeys.VIEW)}
								</Link>
							)}
						</div>
						<button
							type="button"
							onClick={() => dismissToast(toast.id)}
							className="p-1 rounded-md text-faint-foreground"
							aria-label={t(CommonKeys.DISMISS)}
						>
							<X size={14} />
						</button>
					</output>
				);
			})}
		</section>
	);
}
