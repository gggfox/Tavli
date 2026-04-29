/**
 * Reusable Button primitive with built-in state-machine animation.
 *
 * The component owns the visual feedback for `idle | loading | success
 * | error` so save flows can show a persistent in-button confirmation
 * instead of a transient banner that shifts the layout (see
 * docs/tech-debt/0003 for the broader migration plan).
 *
 * Two complementary APIs share the same animation pipeline:
 *   - **Uncontrolled (default):** pass an `onClick` that returns a
 *     `Promise`. Button auto-drives `loading` → `success`/`error` and
 *     auto-resets to `idle` after `successDuration`/`errorDuration`.
 *   - **Controlled (opt-in):** pass `state` directly. The component
 *     mirrors the prop, runs the same animation timing, and calls
 *     `onStateReset` when its internal reset timer fires so the
 *     parent can clear its own state.
 *
 * Visuals:
 *   - Variants reuse the existing `hover-btn-*` utility classes so
 *     theming stays centralized. `success`/`error` override the
 *     background via `data-state` selectors in `Button.css`.
 *   - All state labels are rendered into the same CSS grid cell so the
 *     button width is fixed to the widest label and never re-flows.
 *   - Honors `prefers-reduced-motion` (animations zero out).
 */
import { AlertCircle, Check } from "lucide-react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ButtonHTMLAttributes,
	type MouseEvent,
	type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { CommonKeys } from "@/global/i18n";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";
export type ButtonState = "idle" | "loading" | "success" | "error";

export interface ButtonProps
	extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
	readonly variant?: ButtonVariant;
	readonly size?: ButtonSize;
	/**
	 * When provided, the button is controlled and reflects the value
	 * exactly. Otherwise, state is auto-driven from the `onClick`
	 * promise return value.
	 */
	readonly state?: ButtonState;
	readonly successDuration?: number;
	readonly errorDuration?: number;
	readonly successLabel?: ReactNode;
	readonly errorLabel?: ReactNode;
	readonly loadingLabel?: ReactNode;
	readonly leadingIcon?: ReactNode;
	readonly trailingIcon?: ReactNode;
	readonly fullWidth?: boolean;
	/** Fires when the success/error state auto-resets to idle. */
	readonly onStateReset?: () => void;
	/**
	 * Click handler. If it returns a `Promise`, the button drives its
	 * own loading → success/error animation from the resolution.
	 * Synchronous handlers (or those returning `undefined`) keep the
	 * button in its current state.
	 */
	readonly onClick?: (
		event: MouseEvent<HTMLButtonElement>
	) => void | Promise<unknown>;
}

const DEFAULT_SUCCESS_MS = 1500;
const DEFAULT_ERROR_MS = 2200;

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
	primary: "hover-btn-primary",
	secondary: "hover-btn-secondary",
	danger: "hover-btn-danger",
	ghost: "hover-btn-ghost",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
	sm: "px-3 py-1.5 text-xs gap-1.5",
	md: "px-4 py-2 text-sm gap-2",
	lg: "px-6 py-3 text-base gap-2",
};

const ICON_SIZE: Record<ButtonSize, number> = {
	sm: 12,
	md: 14,
	lg: 16,
};

function isPromiseLike(value: unknown): value is Promise<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
	{
		variant = "primary",
		size = "md",
		state: controlledState,
		successDuration = DEFAULT_SUCCESS_MS,
		errorDuration = DEFAULT_ERROR_MS,
		successLabel,
		errorLabel,
		loadingLabel,
		leadingIcon,
		trailingIcon,
		fullWidth = false,
		onStateReset,
		onClick,
		children,
		className = "",
		disabled,
		type = "button",
		"aria-label": ariaLabel,
		...rest
	},
	ref
) {
	const { t } = useTranslation();
	const [internalState, setInternalState] = useState<ButtonState>("idle");
	const resetTimerRef = useRef<number | null>(null);

	const isControlled = controlledState !== undefined;
	const state = isControlled ? controlledState : internalState;

	const clearResetTimer = useCallback(() => {
		if (resetTimerRef.current !== null) {
			globalThis.window.clearTimeout(resetTimerRef.current);
			resetTimerRef.current = null;
		}
	}, []);

	const scheduleReset = useCallback(
		(ms: number) => {
			clearResetTimer();
			resetTimerRef.current = globalThis.window.setTimeout(() => {
				resetTimerRef.current = null;
				if (!isControlled) setInternalState("idle");
				onStateReset?.();
			}, ms);
		},
		[clearResetTimer, isControlled, onStateReset]
	);

	useEffect(() => clearResetTimer, [clearResetTimer]);

	useEffect(() => {
		if (state === "success") scheduleReset(successDuration);
		else if (state === "error") scheduleReset(errorDuration);
		else clearResetTimer();
	}, [state, successDuration, errorDuration, scheduleReset, clearResetTimer]);

	const handleClick = useCallback(
		(event: MouseEvent<HTMLButtonElement>) => {
			if (state === "loading") return;
			const result = onClick?.(event);
			if (!isControlled && isPromiseLike(result)) {
				setInternalState("loading");
				result.then(
					() => setInternalState("success"),
					() => setInternalState("error")
				);
			}
		},
		[state, onClick, isControlled]
	);

	const resolvedSuccessLabel = successLabel ?? t(CommonKeys.BUTTON_SAVED);
	const resolvedErrorLabel = errorLabel ?? t(CommonKeys.BUTTON_FAILED);
	const resolvedLoadingLabel = loadingLabel ?? children;

	const idleContent = useMemo(
		() => (
			<span className="tavli-button-layer" data-active={state === "idle"}>
				{leadingIcon}
				<span>{children}</span>
				{trailingIcon}
			</span>
		),
		[children, leadingIcon, trailingIcon, state]
	);

	const loadingContent = useMemo(
		() => (
			<span className="tavli-button-layer" data-active={state === "loading"}>
				<span className="tavli-button-spinner" aria-hidden="true" />
				<span>{resolvedLoadingLabel}</span>
			</span>
		),
		[resolvedLoadingLabel, state]
	);

	const successContent = useMemo(
		() => (
			<span className="tavli-button-layer" data-active={state === "success"}>
				<span className="tavli-button-state-icon" aria-hidden="true">
					<Check size={ICON_SIZE[size]} />
				</span>
				<span>{resolvedSuccessLabel}</span>
			</span>
		),
		[resolvedSuccessLabel, size, state]
	);

	const errorContent = useMemo(
		() => (
			<span className="tavli-button-layer" data-active={state === "error"}>
				<span className="tavli-button-state-icon" aria-hidden="true">
					<AlertCircle size={ICON_SIZE[size]} />
				</span>
				<span>{resolvedErrorLabel}</span>
			</span>
		),
		[resolvedErrorLabel, size, state]
	);

	const liveAnnouncement =
		state === "success"
			? typeof resolvedSuccessLabel === "string"
				? resolvedSuccessLabel
				: t(CommonKeys.BUTTON_SAVED)
			: state === "error"
				? typeof resolvedErrorLabel === "string"
					? resolvedErrorLabel
					: t(CommonKeys.BUTTON_FAILED)
				: "";

	const classes = [
		"tavli-button",
		VARIANT_CLASSES[variant],
		SIZE_CLASSES[size],
		fullWidth ? "w-full" : "",
		className,
	]
		.filter(Boolean)
		.join(" ");

	const isLoading = state === "loading";

	return (
		<button
			ref={ref}
			type={type}
			className={classes}
			data-state={state}
			data-variant={variant}
			data-size={size}
			disabled={disabled || isLoading}
			aria-busy={isLoading || undefined}
			aria-label={ariaLabel}
			onClick={handleClick}
			{...rest}
		>
			<span className="tavli-button-stack">
				{idleContent}
				{loadingContent}
				{successContent}
				{errorContent}
			</span>
			<span aria-live="polite" className="sr-only">
				{liveAnnouncement}
			</span>
		</button>
	);
});
