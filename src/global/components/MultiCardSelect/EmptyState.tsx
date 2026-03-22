type EmptyStateProps = Readonly<{
	isEmpty: boolean;
}>;
export function EmptyState({ isEmpty }: EmptyStateProps) {
	if (isEmpty) {
		return <div className="hidden"></div>;
	}
	return (
		<div
			className="p-6 rounded-lg text-center"
			style={{
				backgroundColor: "var(--bg-primary)",
				border: "1px solid var(--border-default)",
			}}
		>
			<p className="text-sm" style={{ color: "var(--text-muted)" }}>
				No options found
			</p>
		</div>
	);
}
