import { CheckCircle2, LucideIcon } from "lucide-react";

type OptionCardProps<T extends { _id: string; name: string; icon?: string }> = Readonly<{
	globalIndex: number;
	cardRefs: React.RefObject<(HTMLButtonElement | null)[]>;
	toggleOption: (id: string) => void;
	handleKeyDown: (e: React.KeyboardEvent, currentIndex: number) => void;
	opt: T;
	isSelected: boolean;
	Icon: LucideIcon;
}>;

export function OptionCard<T extends { _id: string; name: string; icon?: string }>({
	globalIndex,
	cardRefs,
	toggleOption,
	handleKeyDown,
	opt,
	isSelected,
	Icon,
}: OptionCardProps<T>) {
	return (
		<button
			key={opt._id}
			type="button"
			ref={(el) => {
				if (globalIndex >= 0 && cardRefs.current) {
					// Ensure array is large enough
					if (globalIndex >= cardRefs.current.length) {
						cardRefs.current.length = globalIndex + 1;
					}
					cardRefs.current[globalIndex] = el;
				}
			}}
			onClick={() => toggleOption(opt._id)}
			onKeyDown={(e) => {
				if (globalIndex >= 0) {
					handleKeyDown(e, globalIndex);
				}
			}}
			className="relative flex flex-col items-center justify-start gap-2 px-4 pt-4 rounded-lg border-2 transition-all text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 h-36 w-28 text-foreground"
			style={{backgroundColor: isSelected ? "rgba(59, 130, 246, 0.1)" : "var(--bg-primary)",
				borderColor: isSelected ? "rgb(59, 130, 246)" : "var(--border-default)"}}
			aria-label={`${opt.name.replaceAll("_", " ")}${isSelected ? " (selected)" : ""}`}
		>
			{/* Icon */}
			<div
				className="flex items-center justify-center w-10 h-10 rounded-lg"
				style={{backgroundColor: isSelected ? "rgba(59, 130, 246, 0.2)" : "var(--bg-tertiary)"}}
			>
				<Icon
					size={20}
					className="w-5 h-5 shrink-0"
					style={{color: isSelected ? "rgb(59, 130, 246)" : "var(--text-secondary)",
				width: "20px",
				height: "20px",
				minWidth: "20px",
				minHeight: "20px"}}
				/>
			</div>

			{/* Name */}
			<span className="text-sm font-medium text-center">{opt.name.replaceAll("_", " ")}</span>

			{/* Selection Indicator */}
			{isSelected && (
				<div className="absolute top-2 right-2">
					<CheckCircle2
						size={16}
						className="text-blue-500"
						style={{color: "rgb(59, 130, 246)"}}
					/>
				</div>
			)}
		</button>
	);
}
