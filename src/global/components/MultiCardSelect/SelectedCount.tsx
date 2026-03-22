type SelectedCountProps = Readonly<{
	selectedIds: string[];
}>;
export function SelectedCount({ selectedIds }: SelectedCountProps) {
	if (selectedIds.length === 0) {
		return <div className="hidden"></div>;
	}
	return (
		<div className="pt-2 border-t" style={{ borderColor: "var(--border-default)" }}>
			<p className="text-xs" style={{ color: "var(--text-muted)" }}>
				{selectedIds.length} {selectedIds.length === 1 ? "item" : "items"} selected
			</p>
		</div>
	);
}
