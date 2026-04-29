import { FieldLabel } from "./FieldLabel";
import { formInputClasses, formInputStyle } from "./styles";

export interface NumberFieldProps {
	readonly id: string;
	readonly label: string;
	readonly value: number;
	readonly onChange: (value: number) => void;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly description?: string;
}

export function NumberField({
	id,
	label,
	value,
	onChange,
	min,
	max,
	step,
	description,
}: NumberFieldProps) {
	return (
		<div className="flex flex-col gap-1 text-xs">
			<FieldLabel htmlFor={id} label={label} description={description} />
			<input
				id={id}
				type="number"
				value={value}
				min={min}
				max={max}
				step={step}
				onChange={(e) => onChange(Number.parseInt(e.target.value, 10) || 0)}
				className={formInputClasses}
				style={formInputStyle}
			/>
		</div>
	);
}
