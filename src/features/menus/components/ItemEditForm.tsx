import { formatCents, parseDollarsToCents } from "@/global/utils/money";
import { useForm } from "@tanstack/react-form";
import type { Id } from "convex/_generated/dataModel";

interface ItemEditFormProps {
	itemId: Id<"menuItems">;
	currentName: string;
	currentDescription: string;
	currentPrice: number;
	onSave: (args: {
		itemId: Id<"menuItems">;
		name?: string;
		description?: string;
		basePrice?: number;
	}) => Promise<unknown>;
	onClose: () => void;
}

export function ItemEditForm({
	itemId,
	currentName,
	currentDescription,
	currentPrice,
	onSave,
	onClose,
}: Readonly<ItemEditFormProps>) {
	const form = useForm({
		defaultValues: {
			name: currentName,
			description: currentDescription,
			price: formatCents(currentPrice),
		},
		onSubmit: async ({ value }) => {
			const parsedPrice = parseDollarsToCents(value.price);
			if (!value.name.trim() || Number.isNaN(parsedPrice)) return;
			await onSave({
				itemId,
				name: value.name.trim(),
				description: value.description || undefined,
				basePrice: parsedPrice,
			});
			onClose();
		},
	});

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit();
			}}
			className="px-3 py-3 rounded-b-lg space-y-2"
			style={{
				backgroundColor: "var(--bg-secondary)",
				borderLeft: "1px solid var(--border-default)",
				borderRight: "1px solid var(--border-default)",
				borderBottom: "1px solid var(--border-default)",
			}}
		>
			<span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
				Edit Item
			</span>
			<div className="flex gap-2">
				<form.Field
					name="name"
					children={(field) => (
						<input
							type="text"
							value={field.state.value}
							onChange={(e) => field.handleChange(e.target.value)}
							onBlur={field.handleBlur}
							placeholder="Item name"
							required
							className="flex-1 px-2 py-1.5 rounded text-sm"
							style={{
								backgroundColor: "var(--bg-primary)",
								border: "1px solid var(--border-default)",
								color: "var(--text-primary)",
							}}
						/>
					)}
				/>
				<form.Field
					name="price"
					children={(field) => (
						<input
							type="number"
							value={field.state.value}
							onChange={(e) => field.handleChange(e.target.value)}
							onBlur={field.handleBlur}
							placeholder="Price"
							required
							step="0.01"
							min="0"
							className="w-24 px-2 py-1.5 rounded text-sm"
							style={{
								backgroundColor: "var(--bg-primary)",
								border: "1px solid var(--border-default)",
								color: "var(--text-primary)",
							}}
						/>
					)}
				/>
			</div>
			<form.Field
				name="description"
				children={(field) => (
					<input
						type="text"
						value={field.state.value}
						onChange={(e) => field.handleChange(e.target.value)}
						onBlur={field.handleBlur}
						placeholder="Description (optional)"
						className="w-full px-2 py-1.5 rounded text-sm"
						style={{
							backgroundColor: "var(--bg-primary)",
							border: "1px solid var(--border-default)",
							color: "var(--text-primary)",
						}}
					/>
				)}
			/>
			<div className="flex gap-2">
				<form.Subscribe
					selector={(state) => state.isSubmitting}
					children={(isSubmitting) => (
						<button
							type="submit"
							disabled={isSubmitting}
							className="px-3 py-1.5 rounded text-sm font-medium hover-btn-primary disabled:opacity-50"
						>
							{isSubmitting ? "Saving..." : "Save"}
						</button>
					)}
				/>
				<button
					type="button"
					onClick={onClose}
					className="px-3 py-1.5 rounded text-sm hover-btn-secondary"
				>
					Cancel
				</button>
			</div>
		</form>
	);
}
