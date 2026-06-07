import { Minus, Plus } from "lucide-react";

interface NumberStepperProps {
	id: string;
	label: string;
	value: number;
	min: number;
	max: number;
	onChange: (value: number) => void;
}

export function NumberStepper({
	id,
	label,
	value,
	min,
	max,
	onChange,
}: Readonly<NumberStepperProps>) {
	const clamp = (next: number) => Math.min(max, Math.max(min, next));

	return (
		<div>
			<label htmlFor={id} className="block text-xs font-medium mb-1 text-muted-foreground">
				{label}
			</label>
			<div className="flex items-center rounded-lg border border-border bg-muted">
				<button
					type="button"
					onClick={() => onChange(clamp(value - 1))}
					disabled={value <= min}
					className="px-2 py-2 text-muted-foreground hover:text-foreground disabled:opacity-40"
					aria-label={`${label} decrease`}
				>
					<Minus size={16} />
				</button>
				<input
					id={id}
					type="number"
					value={value}
					min={min}
					max={max}
					onChange={(e) => {
						const parsed = Number.parseInt(e.target.value, 10);
						if (!Number.isNaN(parsed)) onChange(clamp(parsed));
					}}
					className="w-12 bg-transparent text-center text-sm text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
				/>
				<button
					type="button"
					onClick={() => onChange(clamp(value + 1))}
					disabled={value >= max}
					className="px-2 py-2 text-muted-foreground hover:text-foreground disabled:opacity-40"
					aria-label={`${label} increase`}
				>
					<Plus size={16} />
				</button>
			</div>
		</div>
	);
}
