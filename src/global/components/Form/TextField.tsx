import { FieldLabel } from "./FieldLabel";
import { formInputClasses, formInputStyle } from "./styles";

export interface TextFieldProps {
	readonly id: string;
	readonly label: string;
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly description?: string;
	readonly placeholder?: string;
}

/**
 * Single-line text input with a label-on-top layout. For more advanced
 * cases (icons, validation, multi-line), reach for `TextInput` or build
 * a custom field.
 */
export function TextField({
	id,
	label,
	value,
	onChange,
	description,
	placeholder,
}: TextFieldProps) {
	return (
		<div className="flex flex-col gap-1 text-xs">
			<FieldLabel htmlFor={id} label={label} description={description} />
			<input
				id={id}
				type="text"
				value={value}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				className={formInputClasses}
				style={formInputStyle}
			/>
		</div>
	);
}
