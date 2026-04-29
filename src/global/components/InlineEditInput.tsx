import { useForm } from "@tanstack/react-form";
import { KEY } from "@/global/utils/keyboard";

interface InlineEditInputProps {
	readonly value: string;
	readonly placeholder: string;
	readonly onSave: (value: string) => Promise<unknown>;
	readonly className?: string;
	readonly inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
	readonly prefix?: string;
	readonly autoFocus?: boolean;
}

export function InlineEditInput({
	value,
	placeholder,
	onSave,
	className,
	inputMode,
	prefix,
	autoFocus,
}: InlineEditInputProps) {
	const form = useForm({
		defaultValues: { draft: value },
		onSubmit: async ({ value: formValue }) => {
			if (formValue.draft !== value) {
				await onSave(formValue.draft);
			}
		},
	});

	const input = (
		<form.Field
			name="draft"
			children={(field) => (
				<input
					type="text"
					inputMode={inputMode}
					value={field.state.value}
					onChange={(e) => field.handleChange(e.target.value)}
					onBlur={() => form.handleSubmit()}
					onKeyDown={(e) => {
						if (e.key === KEY.Enter) {
							e.preventDefault();
							(e.target as HTMLInputElement).blur();
						}
					}}
					onClick={(e) => e.stopPropagation()}
					placeholder={placeholder}
					autoFocus={autoFocus}
					className={`${`flex-1 min-w-0 px-2 py-1 rounded ${className ?? "text-sm"}`} bg-background border border-border text-foreground`}
				/>
			)}
		/>
	);

	if (prefix) {
		return (
			<div className={`flex items-center gap-1 ${className ?? ""}`}>
				<span className="text-xs shrink-0 text-faint-foreground" >
					{prefix}
				</span>
				{input}
			</div>
		);
	}

	return input;
}
