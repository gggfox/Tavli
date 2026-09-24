import type { ReactNode } from "react";

interface SettingsRowProps {
	readonly label: ReactNode;
	/** One line under the label: what the setting does, not how to fill it. */
	readonly hint?: ReactNode;
	/** The control's id, so clicking the label focuses it. Omit for groups of controls. */
	readonly htmlFor?: string;
	readonly testId?: string;
	readonly children: ReactNode;
}

/**
 * One setting: label and hint on the left, the control on the right. Stacks
 * to label-over-control when the *section* is narrow — a container query on
 * `SettingsSection`, not a viewport breakpoint, so a section in the tablet
 * detail pane stacks even though the viewport is wide.
 */
export function SettingsRow({
	label,
	hint,
	htmlFor,
	testId,
	children,
}: Readonly<SettingsRowProps>) {
	return (
		<div
			data-testid={testId}
			className="flex flex-col gap-2 border-b border-border py-4 first:pt-0 last:border-b-0 last:pb-0 @xl:grid @xl:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] @xl:gap-8"
		>
			<div className="min-w-0">
				{htmlFor ? (
					<label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
						{label}
					</label>
				) : (
					<p className="text-sm font-medium text-foreground">{label}</p>
				)}
				{hint ? <p className="mt-0.5 text-xs leading-snug text-faint-foreground">{hint}</p> : null}
			</div>
			<div className="min-w-0">{children}</div>
		</div>
	);
}

/**
 * Shared input look for settings controls. Pass the width (`w-full max-w-md`,
 * `w-32`…) as `size`; `invalid` swaps the border rather than stacking a second
 * border colour that would fight this one.
 */
export function settingsInputClass(size: string, invalid = false): string {
	return `px-3 py-2 rounded-lg text-sm bg-muted border text-foreground ${
		invalid ? "border-destructive" : "border-border"
	} ${size}`;
}
