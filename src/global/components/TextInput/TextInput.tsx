import { forwardRef } from "react";

interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
	readonly label?: string;
	readonly error?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
	{ label, error, id, className = "", ...props },
	ref
) {
	return (
		<div>
			{label && (
				<label
					htmlFor={id}
					className="block text-xs font-medium mb-1"
					style={{ color: "var(--text-secondary)" }}
				>
					{label}
				</label>
			)}
			<input
				ref={ref}
				id={id}
				className={`w-full px-3 py-2 rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-(--btn-primary-bg) focus:border-transparent ${className}`}
				style={{
					backgroundColor: "var(--bg-secondary)",
					border: "1px solid var(--border-default)",
					color: "var(--text-primary)",
				}}
				{...props}
			/>
			{error && (
				<p className="text-xs mt-1" style={{ color: "var(--accent-danger, #e53e3e)" }}>
					{error}
				</p>
			)}
		</div>
	);
});
