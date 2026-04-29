import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

interface CollapsibleCardProps {
	readonly expanded: boolean;
	readonly onToggle: () => void;
	readonly headerContent: ReactNode;
	readonly headerActions?: ReactNode;
	readonly children: ReactNode;
}

export function CollapsibleCard({
	expanded,
	onToggle,
	headerContent,
	headerActions,
	children,
}: CollapsibleCardProps) {
	return (
		<div
			className="rounded-lg overflow-hidden border border-border"
			
		>
			<button
				type="button"
				className="flex w-full items-center justify-between px-4 py-3 cursor-pointer hover:bg-(--bg-hover) bg-muted"
				
				onClick={onToggle}
			>
				<div className="flex items-center gap-2 flex-1 min-w-0">
					{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
					{headerContent}
				</div>
				{headerActions}
			</button>

			{expanded && <div className="p-4 space-y-2">{children}</div>}
		</div>
	);
}
