import { useForm } from "@tanstack/react-form";
import { KEY } from "@/global/utils/keyboard";

interface InlineTranslationInputProps {
	value: string;
	placeholder: string;
	onSave: (value: string) => Promise<unknown>;
}

export function InlineTranslationInput({
	value,
	placeholder,
	onSave,
}: Readonly<InlineTranslationInputProps>) {
	const form = useForm({
		defaultValues: { draft: value },
		onSubmit: async ({ value: formValue }) => {
			if (formValue.draft !== value) {
				await onSave(formValue.draft);
			}
		},
	});

	return (
		<form.Field
			name="draft"
			children={(field) => (
				<input
					type="text"
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
					className="flex-1 min-w-0 px-2 py-1 rounded text-sm bg-muted border border-border text-foreground"
					
				/>
			)}
		/>
	);
}
