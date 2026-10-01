import { ErrorKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { useTranslation } from "react-i18next";

interface TableErrorStateProps {
	readonly error: Error;
	/**
	 * Already-translated title, e.g. `t(ErrorKeys.LOAD_FAILED_ALERTS)`.
	 * Defaults to the entity-neutral `errors.loadFailed.generic`.
	 */
	readonly title?: string;
	readonly onRetry?: () => void;
	/**
	 * When true, the error card grows to fill the remaining vertical space of
	 * its parent. The parent must be a flex column with a defined or
	 * `min-h-full` height for this to take effect.
	 */
	readonly fill?: boolean;
}

export function TableErrorState({ error, title, onRetry, fill = false }: TableErrorStateProps) {
	const { t } = useTranslation();
	const sizing = fill ? "flex-1 self-stretch min-h-0 py-12" : "py-12";
	return (
		<div
			className={`flex flex-col items-center justify-center rounded-lg ${sizing}`}
			style={{ backgroundColor: "var(--color-destructive-subtle)" }}
		>
			<p className="text-lg font-medium text-destructive">
				{title ?? t(ErrorKeys.LOAD_FAILED_GENERIC)}
			</p>
			<p className="text-sm mt-1 text-center max-w-md text-muted-foreground">
				{getErrorMessage(error, t, ErrorKeys.GENERIC)}
			</p>
			{onRetry && (
				<button
					type="button"
					onClick={onRetry}
					className="mt-4 px-4 py-2 rounded-lg text-sm transition-colors bg-muted text-foreground border border-border"
				>
					{t(ErrorKeys.BOUNDARY_RETRY)}
				</button>
			)}
		</div>
	);
}
