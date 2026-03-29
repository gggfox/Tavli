import { parseDollarsToCents } from "@/global/utils/money";
import { useForm } from "@tanstack/react-form";
import type { Id } from "convex/_generated/dataModel";
import { ClipboardPaste, ImagePlus, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { getImageFromClipboard, uploadImage } from "../utils/imageUtils";

interface AddItemFormProps {
	categoryId: Id<"menuCategories">;
	restaurantId: Id<"restaurants">;
	generateUploadUrl: () => Promise<[string, null] | [null, any]>;
	onCreateItem: (args: {
		categoryId: Id<"menuCategories">;
		restaurantId: Id<"restaurants">;
		name: string;
		description?: string;
		basePrice: number;
		imageStorageId?: Id<"_storage">;
	}) => Promise<unknown>;
	onCancel: () => void;
}

export function AddItemForm({
	categoryId,
	restaurantId,
	generateUploadUrl,
	onCreateItem,
	onCancel,
}: Readonly<AddItemFormProps>) {
	const [selectedImage, setSelectedImage] = useState<File | null>(null);
	const [imagePreview, setImagePreview] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const clearSelectedImage = () => {
		setSelectedImage(null);
		setImagePreview(null);
		if (fileInputRef.current) fileInputRef.current.value = "";
	};

	const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0] ?? null;
		setSelectedImage(file);
		if (file) {
			setImagePreview(URL.createObjectURL(file));
		} else {
			setImagePreview(null);
		}
	};

	const handleFormPaste = useCallback((e: React.ClipboardEvent) => {
		const file = getImageFromClipboard(e);
		if (file) {
			e.preventDefault();
			setSelectedImage(file);
			setImagePreview(URL.createObjectURL(file));
		}
	}, []);

	const form = useForm({
		defaultValues: { name: "", price: "", description: "" },
		onSubmit: async ({ value }) => {
			const price = parseDollarsToCents(value.price);
			if (Number.isNaN(price) || !value.name.trim()) return;

			let imageStorageId: Id<"_storage"> | undefined;
			if (selectedImage) {
				imageStorageId = await uploadImage(generateUploadUrl, selectedImage);
			}

			await onCreateItem({
				categoryId,
				restaurantId,
				name: value.name.trim(),
				description: value.description || undefined,
				basePrice: price,
				imageStorageId,
			});

			form.reset();
			clearSelectedImage();
			onCancel();
		},
	});

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit();
			}}
			onPaste={handleFormPaste}
			className="space-y-2 pt-2"
		>
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
								backgroundColor: "var(--bg-secondary)",
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
								backgroundColor: "var(--bg-secondary)",
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
							backgroundColor: "var(--bg-secondary)",
							border: "1px solid var(--border-default)",
							color: "var(--text-primary)",
						}}
					/>
				)}
			/>
			<div className="flex items-center gap-3">
				<label
					className="flex items-center gap-1.5 px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-[var(--bg-hover)]"
					style={{
						border: "1px solid var(--border-default)",
						color: "var(--text-secondary)",
					}}
				>
					<ImagePlus size={14} />
					{selectedImage ? "Change image" : "Add image"}
					<input
						ref={fileInputRef}
						type="file"
						accept="image/*"
						onChange={handleImageSelect}
						className="hidden"
					/>
				</label>
				{!imagePreview && (
					<span className="flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
						<ClipboardPaste size={12} /> or paste from clipboard
					</span>
				)}
				{imagePreview && (
					<div className="relative">
						<img src={imagePreview} alt="Preview" className="w-10 h-10 rounded object-cover" />
						<button
							type="button"
							onClick={clearSelectedImage}
							className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center"
							style={{
								backgroundColor: "var(--accent-danger)",
								color: "white",
							}}
						>
							<X size={10} />
						</button>
					</div>
				)}
			</div>
			<div className="flex gap-2">
				<form.Subscribe
					selector={(state) => state.isSubmitting}
					children={(isSubmitting) => (
						<button
							type="submit"
							disabled={isSubmitting}
							className="px-3 py-1.5 rounded text-sm font-medium hover-btn-primary disabled:opacity-50"
						>
							{isSubmitting ? "Uploading..." : "Add"}
						</button>
					)}
				/>
				<button
					type="button"
					onClick={onCancel}
					className="px-3 py-1.5 rounded text-sm hover-btn-secondary"
				>
					Cancel
				</button>
			</div>
		</form>
	);
}
