/**
 * ErrorBoundary - React Error Boundary for graceful error handling
 *
 * Catches JavaScript errors anywhere in its child component tree and
 * displays a fallback UI instead of crashing the entire app.
 *
 * This covers *render* errors only. Errors raised by a route's `beforeLoad`,
 * loader, or during navigation are surfaced by TanStack Router instead — see
 * `RouteErrorComponent`, which renders the same `ErrorFallback` panel and is
 * wired up as the router's `defaultErrorComponent` in `src/router.tsx`.
 */
import { Component, type ReactNode } from "react";
import { ErrorFallback } from "./ErrorFallback";

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

	render() {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback;
			}

			return <ErrorFallback error={this.state.error} onRetry={this.handleRetry} />;
		}

		return this.props.children;
	}
}
