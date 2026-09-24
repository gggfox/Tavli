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
 * Card shell for one section of the restaurant settings view. Purely
 * presentational -- every section owns its own form state and save.
 *
 * It is the container `SettingsRow` queries (`@container`), so a section's
 * rows go side-by-side only when the section itself has room.
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
			className="@container rounded-xl border border-border bg-muted/30 px-4 pt-4 @xl:px-6 @xl:pt-5"
		>
			<header className="mb-4 space-y-1">
				<h3 className="text-sm font-semibold text-foreground">{title}</h3>
				{hint ? <p className="text-xs text-faint-foreground max-w-2xl">{hint}</p> : null}
			</header>
			<div className="pb-4 @xl:pb-5">{children}</div>
			{footer}
		</section>
	);
}
