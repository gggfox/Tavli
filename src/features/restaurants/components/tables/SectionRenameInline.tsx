import { TextInput } from "@/global/components";
import { Check, X } from "lucide-react";
import { useState } from "react";

interface SectionRenameInlineProps {
	initialValue: string;
	placeholder: string;
	saveLabel: string;
	cancelLabel: string;
	onSubmit: (name: string) => void;
	onCancel: () => void;
}

/**
 * Inline section rename input. Owns its own local state, mounted only while
 * editing (parent passes a key tied to the section id), so each session starts
 * pre-filled with the section's displayed label.
 */
export function SectionRenameInline({
	initialValue,
	placeholder,
	saveLabel,
	cancelLabel,
	onSubmit,
	onCancel,
}: Readonly<SectionRenameInlineProps>) {
	const [value, setValue] = useState(initialValue);
	return (
		<div className="flex items-center gap-2 flex-1 min-w-0">
			<TextInput
				type="text"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder={placeholder}
				className="w-full"
				autoFocus
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						onSubmit(value);
					} else if (e.key === "Escape") {
						e.preventDefault();
						onCancel();
					}
				}}
			/>
			<button
				onClick={() => onSubmit(value)}
				className="p-1.5 rounded-md hover:bg-hover text-success shrink-0"
				title={saveLabel}
				type="button"
			>
				<Check size={16} />
			</button>
			<button
				onClick={onCancel}
				className="p-1.5 rounded-md hover:bg-hover text-faint-foreground shrink-0"
				title={cancelLabel}
				type="button"
			>
				<X size={16} />
			</button>
		</div>
	);
}
