import type { ReactNode } from "react";

interface AdminPageLayoutProps {
	readonly title?: string;
	readonly description?: string;
	readonly children: ReactNode;
}

export function AdminPageLayout({ title, description, children }: AdminPageLayoutProps) {
	const showHeader = Boolean(title || description);

	return (
		<div className="p-6 flex flex-col h-full">
			{showHeader && (
				<div className="mb-6">
					{title && (
						<h1 className="text-2xl font-semibold text-foreground">{title}</h1>
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
