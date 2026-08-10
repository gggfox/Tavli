import type { ReactNode } from "react";

interface SettingsSectionProps {
	readonly title: string;
	readonly hint?: string;
	/** Stable hook for tests and for deep-linking a section later. */
	readonly testId?: string;
	readonly children: ReactNode;
	/** Save affordance / status row. Sections without their own save omit it. */
	readonly footer?: ReactNode;
}

/**
 * Card shell for one section of the full-canvas restaurant settings view.
 * Purely presentational -- every section owns its own form state and save.
 */
export function SettingsSection({
	title,
	hint,
	testId,
	children,
	footer,
}: Readonly<SettingsSectionProps>) {
	return (
		<section
			data-testid={testId}
			className="rounded-xl border border-border bg-muted/30 p-4 sm:p-6 space-y-4"
		>
			<header className="space-y-1">
				<h3 className="text-sm font-semibold text-foreground">{title}</h3>
				{hint ? <p className="text-xs text-faint-foreground max-w-2xl">{hint}</p> : null}
			</header>
			<div className="space-y-4 max-w-2xl">{children}</div>
			{footer ? <div className="pt-1">{footer}</div> : null}
		</section>
	);
}
