import type { ReactNode } from "react";
import { InfoTooltip } from "./InfoTooltip";

export interface FieldLabelProps {
	readonly htmlFor: string;
	readonly label: ReactNode;
	readonly description?: string;
}

/**
 * Form field label with an optional info tooltip. Renders a small
 * secondary-toned label that pairs with the Form/* input components.
 */
export function FieldLabel({ htmlFor, label, description }: FieldLabelProps) {
	return (
		<span className="flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
			<label htmlFor={htmlFor}>{label}</label>
			{description ? <InfoTooltip description={description} /> : null}
		</span>
	);
}
