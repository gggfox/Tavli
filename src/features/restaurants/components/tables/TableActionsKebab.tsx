import { MoreVertical } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

interface TableActionsKebabProps {
	isOpen: boolean;
	onOpen: () => void;
	onClose: () => void;
	ariaLabel: string;
	items: ReactNode;
}

export function TableActionsKebab(props: Readonly<TableActionsKebabProps>) {
	const { isOpen, onOpen, onClose, ariaLabel, items } = props;
	const wrapperRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!isOpen) return;
		const onDown = (e: MouseEvent) => {
			if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
				onClose();
			}
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [isOpen, onClose]);

	return (
		<div ref={wrapperRef} className="relative">
			<button
				type="button"
				onClick={() => (isOpen ? onClose() : onOpen())}
				className="p-1.5 rounded-md hover:bg-hover text-muted-foreground"
				title={ariaLabel}
				aria-label={ariaLabel}
				aria-haspopup="menu"
				aria-expanded={isOpen}
			>
				<MoreVertical size={16} />
			</button>
			{isOpen && (
				<div
					role="menu"
					className="absolute right-0 top-full mt-1 z-30 min-w-40 rounded-md border border-border bg-background shadow-md p-1 flex flex-col gap-0.5"
				>
					{items}
				</div>
			)}
		</div>
	);
}
