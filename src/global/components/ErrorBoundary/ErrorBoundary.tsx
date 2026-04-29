/**
 * ErrorBoundary - React Error Boundary for graceful error handling
 *
 * Catches JavaScript errors anywhere in its child component tree and
 * displays a fallback UI instead of crashing the entire app.
 */
import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
	readonly children: ReactNode;
	readonly fallback?: ReactNode;
	readonly onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

type ErrorBoundaryState =
	| {
			hasError: false;
			error: undefined;
	  }
	| {
			hasError: true;
			error: Error;
	  };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: undefined };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.error("ErrorBoundary caught an error:", error, errorInfo);
		this.props.onError?.(error, errorInfo);
	}

	handleRetry = () => {
		this.setState({ hasError: false, error: undefined });
	};

	handleSignIn = () => {
		globalThis.location.reload();
	};

	render() {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback;
			}

			const isAuthError = this.state.error?.message?.toLowerCase().includes("authenticated");

			return (
				<div className="min-h-[400px] flex items-center justify-center p-8">
					<div
						className="max-w-md w-full backdrop-blur-sm rounded-xl p-8 text-center bg-card border border-border"
						style={{boxShadow: "var(--shadow-lg)"}}
					>
						<div
							className="w-16 h-16 mx-auto mb-6 rounded-full flex items-center justify-center bg-destructive-subtle"
							
						>
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

						<h2 className="text-xl font-semibold mb-2 text-foreground" >
							{isAuthError ? "Session Expired" : "Something went wrong"}
						</h2>

						<p className="mb-6 text-muted-foreground" >
							{isAuthError
								? "Your session has expired. Please sign in again to continue."
								: this.state.error?.message || "An unexpected error occurred. Please try again."}
						</p>

						<div className="flex flex-col sm:flex-row gap-3 justify-center">
							{isAuthError ? (
								<button
									type="button"
									onClick={this.handleSignIn}
									className="px-6 py-2.5 font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 hover-btn-primary"
								>
									Sign In
								</button>
							) : (
								<>
									<button
										type="button"
										onClick={this.handleRetry}
										className="px-6 py-2.5 font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 hover-btn-primary"
									>
										Try Again
									</button>
									<button
										type="button"
										onClick={() => globalThis.location.reload()}
										className="px-6 py-2.5 font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 hover-btn-secondary"
									>
										Reload Page
									</button>
								</>
							)}
						</div>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
