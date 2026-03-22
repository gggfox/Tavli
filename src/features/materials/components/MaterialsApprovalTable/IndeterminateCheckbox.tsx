import { useEffect, useRef } from "react";

interface IndeterminateCheckboxProps {
	readonly checked: boolean;
	readonly indeterminate?: boolean;
	readonly disabled?: boolean;
	readonly onChange: (checked: boolean) => void;
	readonly className?: string;
	readonly "aria-label"?: string;
}

export function IndeterminateCheckbox({
	checked,
	indeterminate = false,
	disabled = false,
	onChange,
	className = "",
	"aria-label": ariaLabel,
}: IndeterminateCheckboxProps) {
	const checkboxRef = useRef<HTMLInputElement>(null);

	// Set indeterminate state via ref since it's a DOM property, not an HTML attribute
	useEffect(() => {
		if (checkboxRef.current) {
			checkboxRef.current.indeterminate = indeterminate && !checked;
		}
	}, [indeterminate, checked]);

	return (
		<input
			ref={checkboxRef}
			type="checkbox"
			checked={checked}
			disabled={disabled}
			onChange={(e) => onChange(e.target.checked)}
			className={className}
			aria-label={ariaLabel}
		/>
	);
}
