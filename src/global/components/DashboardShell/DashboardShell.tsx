/**
 * DashboardShell — collapses the loading-error-content triad that the
 * order, payments, and reservations dashboards each implemented from
 * scratch. The error copy is localized: the caller passes an already-translated
 * `errorTitle` (one whole sentence per entity, e.g. `errors.loadFailed.orders`,
 * because gluing an English noun into "Could not load {{entity}}" broke Spanish
 * agreement and leaked English), and the description runs the caught error
 * through `getErrorMessage`, so a known backend code maps to a localized
 * message and anything else falls back to `errors.dashboardShell.loadHint` — a
 * raw backend message never reaches the UI.
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
	/**
	 * Translated title shown when `error` is set, e.g.
	 * `t(ErrorKeys.LOAD_FAILED_ORDERS)`. Pass a full sentence, never a noun.
	 */
	readonly errorTitle: string;
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
	errorTitle,
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
					title={errorTitle}
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
