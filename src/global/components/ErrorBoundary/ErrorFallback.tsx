/**
 * ErrorFallback - the shared "something went wrong" panel.
 *
 * Extracted from `ErrorBoundary` so the exact same UI can be used by both
 * error surfaces:
 *   - React render errors, caught by the `ErrorBoundary` class component;
 *   - router errors (loader / beforeLoad / route component), surfaced by
 *     TanStack Router through `errorComponent`, which is a *function*
 *     component receiving `{ error, reset }` and therefore cannot reuse a
 *     class boundary.
 *
 * Presentational only: it never inspects where the error came from, and it
 * never renders a raw backend message (see `getErrorMessage`).
 */
import { ErrorKeys, i18n } from "@/global/i18n";
import { extractErrorCode, getErrorMessage } from "@/global/utils/errorMessages";
import type { ReactNode } from "react";

export interface ErrorFallbackProps {
	readonly error: Error | undefined;
	/** Clears the error and re-renders the failed subtree. */
	readonly onRetry: () => void;
	/** Extra actions rendered next to Retry / Reload. */
	readonly actions?: ReactNode;
	/**
	 * Copy overrides for call sites that already know what went wrong and
	 * hold a localized string for it (e.g. a failed session handshake), rather
	 * than an `Error` carrying a backend code.
	 */
	readonly title?: string;
	readonly description?: string;
}

export function ErrorFallback({
	error,
	onRetry,
	actions,
	title,
	description: descriptionOverride,
}: ErrorFallbackProps) {
	// Localized via the shared i18n singleton rather than `useTranslation`, so
	// the class-component boundary can render this too.
	const t = i18n.t.bind(i18n);
	const isAuthError =
		extractErrorCode(error) === "NOT_AUTHENTICATED" ||
		!!error?.message?.toLowerCase().includes("authenticated");
	// Never render a raw backend message — map known codes, otherwise the
	// generic boundary copy.
	const description =
		descriptionOverride ?? getErrorMessage(error, t, ErrorKeys.BOUNDARY_DESCRIPTION);

	return (
		<div className="min-h-[400px] flex items-center justify-center p-8">
			<div
				className="max-w-md w-full backdrop-blur-sm rounded-xl p-8 text-center bg-card border border-border"
				style={{ boxShadow: "var(--shadow-lg)" }}
			>
				<div className="w-16 h-16 mx-auto mb-6 rounded-full flex items-center justify-center bg-destructive-subtle">
					<svg
						className="w-8 h-8 text-destructive"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						aria-hidden="true"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
				</div>

				<h2 className="text-xl font-semibold mb-2 text-foreground">
					{isAuthError
						? t(ErrorKeys.BOUNDARY_SESSION_TITLE)
						: (title ?? t(ErrorKeys.BOUNDARY_TITLE))}
				</h2>

				<p className="mb-6 text-muted-foreground">
					{isAuthError ? t(ErrorKeys.BOUNDARY_SESSION_DESCRIPTION) : description}
				</p>

				<div className="flex flex-col sm:flex-row gap-3 justify-center">
					{isAuthError ? (
						<button
							type="button"
							onClick={() => globalThis.location.reload()}
							className="px-6 py-2.5 font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 hover-btn-primary"
						>
							{t(ErrorKeys.BOUNDARY_SIGN_IN)}
						</button>
					) : (
						<>
							<button
								type="button"
								onClick={onRetry}
								className="px-6 py-2.5 font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 hover-btn-primary"
							>
								{t(ErrorKeys.BOUNDARY_RETRY)}
							</button>
							<button
								type="button"
								onClick={() => globalThis.location.reload()}
								className="px-6 py-2.5 font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 hover-btn-secondary"
							>
								{t(ErrorKeys.BOUNDARY_RELOAD)}
							</button>
							{actions}
						</>
					)}
				</div>
			</div>
		</div>
	);
}
