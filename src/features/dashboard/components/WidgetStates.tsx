/**
 * Reusable inline states for widget bodies. Concrete widgets use these
 * inside the WidgetShell content area.
 */
import { DashboardKeys } from "@/global/i18n";
import { useTranslation } from "react-i18next";

export function WidgetLoading() {
	const { t } = useTranslation();
	return (
		<div className="h-full flex items-center justify-center text-xs text-faint-foreground">
			{t(DashboardKeys.WIDGET_LOADING)}
		</div>
	);
}

export function WidgetEmpty() {
	const { t } = useTranslation();
	return (
		<div className="h-full flex items-center justify-center text-xs text-faint-foreground">
			{t(DashboardKeys.WIDGET_EMPTY)}
		</div>
	);
}

interface WidgetErrorProps {
	error: Error | null;
}

export function WidgetError({ error }: WidgetErrorProps) {
	const { t } = useTranslation();
	const code = error?.message ?? "";
	let messageKey: string = DashboardKeys.WIDGET_ERROR_DESCRIPTION;
	if (code.includes("RANGE_TOO_LARGE")) {
		messageKey = DashboardKeys.WIDGET_ERROR_RANGE_TOO_LARGE;
	} else if (code.includes("ROLE_REQUIRED") || code.includes("INSUFFICIENT_ROLES")) {
		messageKey = DashboardKeys.WIDGET_ERROR_ACCESS_DENIED;
	}
	return (
		<div className="h-full flex flex-col items-center justify-center gap-1 text-center px-2">
			<p className="text-xs font-medium text-foreground">
				{t(DashboardKeys.WIDGET_ERROR_TITLE)}
			</p>
			<p className="text-[11px] text-faint-foreground">{t(messageKey)}</p>
		</div>
	);
}
