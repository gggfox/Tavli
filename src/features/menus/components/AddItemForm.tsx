import { MenusKeys } from "@/global/i18n";
import { parseDollarsToCents } from "@/global/utils/money";
import { useForm } from "@tanstack/react-form";
import type { Id } from "convex/_generated/dataModel";
import { ClipboardPaste, ImagePlus, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
	const { t } = useTranslation();
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
							placeholder={t(MenusKeys.FORM_ITEM_NAME_PLACEHOLDER)}
							required
							className="flex-1 px-2 py-1.5 rounded text-sm bg-muted border border-border text-foreground"
							
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
							placeholder={t(MenusKeys.FORM_ITEM_PRICE_PLACEHOLDER)}
							required
							step="0.01"
							min="0"
							className="w-24 px-2 py-1.5 rounded text-sm bg-muted border border-border text-foreground"
							
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
						placeholder={t(MenusKeys.FORM_ITEM_DESCRIPTION_PLACEHOLDER)}
						className="w-full px-2 py-1.5 rounded text-sm bg-muted border border-border text-foreground"
						
					/>
				)}
			/>
			<div className="flex items-center gap-3">
				<label
					className="flex items-center gap-1.5 px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-hover border border-border text-muted-foreground"
					
				>
					<ImagePlus size={14} />
					{selectedImage ? t(MenusKeys.FORM_CHANGE_IMAGE) : t(MenusKeys.FORM_ADD_IMAGE)}
					<input
						ref={fileInputRef}
						type="file"
						accept="image/*"
						onChange={handleImageSelect}
						className="hidden"
					/>
				</label>
				{!imagePreview && (
					<span className="flex items-center gap-1 text-xs text-faint-foreground" >
						<ClipboardPaste size={12} /> {t(MenusKeys.FORM_PASTE_HINT)}
					</span>
				)}
				{imagePreview && (
					<div className="relative">
						<img src={imagePreview} alt="Preview" className="w-10 h-10 rounded object-cover" />
						<button
							type="button"
							onClick={clearSelectedImage}
							className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center bg-destructive"
							style={{color: "white"}}
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
							{isSubmitting ? t(MenusKeys.FORM_UPLOADING) : t(MenusKeys.FORM_ADD)}
						</button>
					)}
				/>
				<button
					type="button"
					onClick={onCancel}
					className="px-3 py-1.5 rounded text-sm hover-btn-secondary"
				>
					{t(MenusKeys.FORM_CANCEL)}
				</button>
			</div>
		</form>
	);
}
