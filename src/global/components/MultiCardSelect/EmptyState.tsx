type EmptyStateProps = Readonly<{
	isEmpty: boolean;
}>;
export function EmptyState({ isEmpty }: EmptyStateProps) {
	if (isEmpty) {
		return <div className="hidden"></div>;
	}
	return (
		<div
			className="p-6 rounded-lg text-center bg-background border border-border"
			
		>
			<p className="text-sm text-faint-foreground" >
				No options found
			</p>
		</div>
	);
}
