/**
 * Client telemetry — error tracking, product events and user identity —
 * backed by PostHog (TAVLI-9). Backend exceptions do NOT come through here:
 * Convex reports them natively through its dashboard integration.
 *
 * One seam, no provider, no hooks. Call sites import `track` / `reportError`
 * and never see the vendor SDK, so a class component (`ErrorBoundary`) and a
 * plain function work exactly like a React one, and swapping the vendor is a
 * one-file change.
 *
 * Disabled — every export is a no-op — when `VITE_PUBLIC_POSTHOG_PROJECT_TOKEN`
 * is unset, which is every local dev and test run.
 *
 * Privacy (ADR-006, TAVLI-9 AC): `identifyUser` takes the Clerk user id and
 * nothing else — no email, no name — and session recordings mask every input
 * and every text node client-side, whatever the project's dashboard setting,
 * so a replay can never show a PIN or a diner's name. Unmask a non-PII surface
 * deliberately with PostHog's `ph-no-mask` class if a replay is unreadable.
 *
 * Events go straight to the PostHog ingest host. A same-origin reverse proxy
 * would dodge ad blockers, but it needs a real server route — production is
 * served by Nitro, not the Vite dev server — so do that once blocked-event
 * volume is measured, not before.
 */
import posthog from "posthog-js";
import { config } from "./config";

const token = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
const apiHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

let enabled = false;

/** Idempotent. A no-op on the server and without a token. */
export function initTelemetry(): void {
	if (enabled || typeof window === "undefined" || !token) return;

	posthog.init(token, {
		api_host: apiHost,
		ui_host: "https://us.posthog.com",
		defaults: "2025-05-24",
		capture_exceptions: true,
		session_recording: {
			maskAllInputs: true,
			maskTextSelector: "*",
		},
	});
	// Super-properties ride on every event, so a spike can be filtered to one
	// environment and pinned to the exact build that shipped it.
	posthog.register({ environment: config.nodeEnv, release: config.gitSha });
	enabled = true;
}

type Properties = Record<string, string | number | boolean | null | undefined>;

/** Product event. Properties are ids, counts and amounts — never PII. */
export function track(event: string, properties?: Properties): void {
	if (!enabled) return;
	posthog.capture(event, properties);
}

/**
 * Report a caught error. Uncaught errors and rejections are captured
 * automatically; this is for the boundaries (`ErrorBoundary`,
 * `RouteErrorComponent`) and any `catch` that would otherwise swallow
 * something it should not.
 */
export function reportError(error: unknown, context?: Properties): void {
	if (!enabled) return;
	posthog.captureException(error, context);
}

/** Clerk user id only — never email or name (ADR-006). */
export function identifyUser(userId: string): void {
	if (!enabled) return;
	posthog.identify(userId);
}

/**
 * Forget the identified user and start a fresh anonymous session. Runs on
 * sign-out: staff share tablets, and without it the next person's events are
 * attributed to whoever just signed out.
 */
export function resetUser(): void {
	if (!enabled) return;
	posthog.reset();
}
