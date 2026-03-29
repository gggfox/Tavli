import type { ReactNode } from "react";

interface AdminPageLayoutProps {
	readonly title: string;
	readonly description: string;
	readonly children: ReactNode;
}

export function AdminPageLayout({ title, description, children }: AdminPageLayoutProps) {
	return (
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6">
				<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
					{title}
				</h1>
				<p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
					{description}
				</p>
			</div>
			<div className="flex-1 overflow-y-auto">{children}</div>
		</div>
	);
}
