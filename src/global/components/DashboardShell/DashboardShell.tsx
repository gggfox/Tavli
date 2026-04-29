/**
 * DashboardShell — collapses the loading-error-content triad that the
 * order, payments, and reservations dashboards each implemented from
 * scratch. The error copy ("Could not load X." / "Please check your
 * permissions and try again.") matches the previous bespoke text exactly,
 * so swapping in the shell is a behavior-preserving change.
 *
 * Renders:
 *   1. `header` always (filter pills, range chips, page actions, etc.).
 *   2. `skeleton` while `isLoading` is true.
 *   3. An `EmptyState` with `AlertTriangle` when `error` is non-null.
 *   4. `children` otherwise.
 */
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
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

const DEFAULT_ERROR_DESCRIPTION = "Please check your permissions and try again.";

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
	const wrapperClasses = [
		"flex flex-col min-h-full",
		GAP_CLASSES[gap],
		className,
	]
		.filter(Boolean)
		.join(" ");

	if (isLoading) {
		return (
			<div className={wrapperClasses}>
				{header}
				{skeleton}
			</div>
		);
	}

	if (error) {
		return (
			<div className={wrapperClasses}>
				{header}
				<EmptyState
					icon={AlertTriangle}
					title={`Could not load ${entityName}.`}
					description={error.message ?? DEFAULT_ERROR_DESCRIPTION}
					fill
				/>
			</div>
		);
	}

	return (
		<div className={wrapperClasses}>
			{header}
			{children}
		</div>
	);
}
