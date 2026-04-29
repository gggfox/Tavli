import { FieldLabel } from "./FieldLabel";
import { formInputClasses, formInputStyle } from "./styles";

export interface DateTimeFieldProps {
	readonly id: string;
	readonly label: string;
	/** Value in milliseconds since the epoch. */
	readonly valueMs: number;
	/** Called with the new value in milliseconds since the epoch. */
	readonly onChangeMs: (value: number) => void;
	readonly description?: string;
}

/**
 * Build a `<input type="datetime-local">`-compatible string from a UTC ms.
 * The browser interprets the value as local time when round-tripping.
 */
function toDateTimeLocalValue(ms: number): string {
	const d = new Date(ms);
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateTimeLocalValue(value: string): number {
	return new Date(value).getTime();
}

export function DateTimeField({
	id,
	label,
	valueMs,
	onChangeMs,
	description,
}: DateTimeFieldProps) {
	return (
		<div className="flex flex-col gap-1 text-xs">
			<FieldLabel htmlFor={id} label={label} description={description} />
			<input
				id={id}
				type="datetime-local"
				value={toDateTimeLocalValue(valueMs)}
				onChange={(e) => onChangeMs(fromDateTimeLocalValue(e.target.value))}
				className={formInputClasses}
				style={formInputStyle}
			/>
		</div>
	);
}
