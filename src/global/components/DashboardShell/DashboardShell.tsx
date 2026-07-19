/**
 * DashboardShell — collapses the loading-error-content triad that the
 * order, payments, and reservations dashboards each implemented from
 * scratch. The error copy is localized: the title uses
 * `errors.dashboardShell.loadFailed` ("Could not load {{entity}}.") and the
 * description runs the caught error through `getErrorMessage`, so a known
 * backend code maps to a localized message and anything else falls back to
 * `errors.dashboardShell.loadHint` — a raw backend message never reaches the UI.
 *
 * Renders:
 *   1. `header` always (filter pills, range chips, page actions, etc.).
 *      When inside AdminPageLayout, the header registers as sticky toolbar chrome.
 *   2. `skeleton` while `isLoading` is true.
 *   3. An `EmptyState` with `AlertTriangle` when `error` is non-null.
 *   4. `children` otherwise.
 */
import { useAdminPageChromeContext } from "@/global/hooks/useAdminPageToolbar";
import { ErrorKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { AlertTriangle } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../EmptyState";

interface DashboardShellError {
	readonly message?: string;
}

export interface DashboardShellProps {
	readonly isLoading: boolean;
	readonly error: DashboardShellError | null | undefined;
	readonly entityName: string;
	readonly skeleton: ReactNode;
	readonly header?: ReactNode;
	readonly children: ReactNode;
	/**
	 * Tailwind spacing scale value used for the vertical gap between
	 * `header`, content/skeleton/error. Defaults to `"4"` (1rem).
	 */
	readonly gap?: "2" | "3" | "4" | "5" | "6" | "8";
	readonly className?: string;
}

const GAP_CLASSES = {
	"2": "gap-2",
	"3": "gap-3",
	"4": "gap-4",
	"5": "gap-5",
	"6": "gap-6",
	"8": "gap-8",
} as const;

export function DashboardShell({
	isLoading,
	error,
	entityName,
	skeleton,
	header,
	children,
	gap = "4",
	className = "",
}: DashboardShellProps) {
	const { t } = useTranslation();
	const chromeContext = useAdminPageChromeContext();

	useEffect(() => {
		if (!chromeContext || !header) return;
		chromeContext.registerToolbar(header);
		return () => chromeContext.registerToolbar(null);
	}, [chromeContext, header]);

	const inlineHeader = chromeContext ? null : header;

	const wrapperClasses = ["flex min-h-0 flex-1 flex-col", GAP_CLASSES[gap], className]
		.filter(Boolean)
		.join(" ");

	if (isLoading) {
		return (
			<div className={wrapperClasses}>
				{inlineHeader}
				{skeleton}
			</div>
		);
	}

	if (error) {
		return (
			<div className={wrapperClasses}>
				{inlineHeader}
				<EmptyState
					icon={AlertTriangle}
					title={t(ErrorKeys.DASHBOARD_LOAD_FAILED, { entity: entityName })}
					description={getErrorMessage(error, t, ErrorKeys.DASHBOARD_LOAD_HINT)}
					fill
				/>
			</div>
		);
	}

	return (
		<div className={wrapperClasses}>
			{inlineHeader}
			{children}
		</div>
	);
}
