import type { ReactNode } from "react";

interface AdminPageLayoutProps {
	readonly title?: string;
	readonly description?: string;
	/** Rendered on the same row as the title (e.g. primary action buttons). */
	readonly actions?: ReactNode;
	readonly children: ReactNode;
}

export function AdminPageLayout({ title, description, actions, children }: AdminPageLayoutProps) {
	const showHeader = Boolean(title || description || actions);

	return (
		<div className="p-6 flex flex-col h-full">
			{showHeader && (
				<div className="mb-6">
					{(title || actions) && (
						<div className="flex flex-wrap items-start justify-between gap-3 gap-y-2">
							{title ? (
								<h1 className="text-2xl font-semibold text-foreground">{title}</h1>
							) : (
								<span />
							)}
							{actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
						</div>
					)}
					{description && (
						<p className="mt-2 text-sm text-muted-foreground">{description}</p>
					)}
				</div>
			)}
			<div className="flex-1 overflow-y-auto">{children}</div>
		</div>
	);
}
