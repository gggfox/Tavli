type LabelProps = Readonly<{
	label: string;
	required: boolean;
}>;
export function Label({ label, required }: LabelProps) {
	return (
		<label className="block text-sm font-medium uppercase" style={{color: "white"}}>
			{label}
			{required && <span className="text-red-400 ml-1">*</span>}
		</label>
	);
}
