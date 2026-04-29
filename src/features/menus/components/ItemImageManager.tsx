import { useConvexMutate } from "@/global/hooks";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ClipboardPaste, ImagePlus, Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { getImageFromClipboard, uploadImage } from "../utils/imageUtils";

interface ItemImageManagerProps {
	itemId: Id<"menuItems">;
	currentImageUrl: string | null;
}

export function ItemImageManager({ itemId, currentImageUrl }: Readonly<ItemImageManagerProps>) {
	// Upload URL generation runs imperatively inside `handleUpload`, not as a
	// React Query mutation, so it stays on the lower-level convex hook.
	const generateUploadUrl = useConvexMutation(api.menuItems.generateUploadUrl);
	const updateItem = useConvexMutate(api.menuItems.update);
	const removeImageMut = useConvexMutate(api.menuItems.removeImage);

	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [preview, setPreview] = useState<string | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const applyFile = useCallback((file: File | null) => {
		setSelectedFile(file);
		setPreview(file ? URL.createObjectURL(file) : null);
	}, []);

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		applyFile(e.target.files?.[0] ?? null);
	};

	const handlePaste = useCallback(
		(e: React.ClipboardEvent) => {
			const file = getImageFromClipboard(e);
			if (file) {
				e.preventDefault();
				applyFile(file);
			}
		},
		[applyFile]
	);

	const handleUpload = async () => {
		if (!selectedFile) return;
		setIsUploading(true);
		try {
			const storageId = await uploadImage(generateUploadUrl, selectedFile);
			unwrapResult(await updateItem.mutateAsync({ itemId, imageStorageId: storageId }));
			setSelectedFile(null);
			setPreview(null);
			if (fileRef.current) fileRef.current.value = "";
		} finally {
			setIsUploading(false);
		}
	};

	const handleRemove = async () => {
		unwrapResult(await removeImageMut.mutateAsync({ itemId }));
	};

	return (
		<div
			className="px-3 py-3 rounded-b-lg space-y-3 outline-none"
			tabIndex={0}
			onPaste={handlePaste}
			style={{
				backgroundColor: "var(--bg-secondary)",
				borderLeft: "1px solid var(--border-default)",
				borderRight: "1px solid var(--border-default)",
				borderBottom: "1px solid var(--border-default)",
			}}
		>
			<span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
				Item Image
			</span>

			{currentImageUrl && (
				<div className="flex items-start gap-3">
					<img src={currentImageUrl} alt="Current" className="w-24 h-24 rounded-lg object-cover" />
					<button
						onClick={handleRemove}
						disabled={removeImageMut.isPending}
						className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium disabled:opacity-50"
						style={{
							border: "1px solid var(--accent-danger)",
							color: "var(--accent-danger)",
						}}
					>
						<Trash2 size={12} /> Remove
					</button>
				</div>
			)}

			<div className="flex items-center gap-3">
				<label
					className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs cursor-pointer hover:bg-[var(--bg-hover)]"
					style={{
						border: "1px solid var(--border-default)",
						color: "var(--text-secondary)",
					}}
				>
					<ImagePlus size={14} />
					{currentImageUrl ? "Replace image" : "Upload image"}
					<input
						ref={fileRef}
						type="file"
						accept="image/*"
						onChange={handleFileChange}
						className="hidden"
					/>
				</label>
				{!preview && (
					<span className="flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
						<ClipboardPaste size={12} /> or paste from clipboard
					</span>
				)}
				{preview && (
					<div className="flex items-center gap-2">
						<img src={preview} alt="Preview" className="w-10 h-10 rounded object-cover" />
						<button
							onClick={handleUpload}
							disabled={isUploading || updateItem.isPending}
							className="px-2 py-1 rounded text-xs font-medium hover-btn-primary disabled:opacity-50"
						>
							{isUploading ? "Uploading..." : "Save"}
						</button>
						<button
							onClick={() => {
								setSelectedFile(null);
								setPreview(null);
								if (fileRef.current) fileRef.current.value = "";
							}}
							className="px-2 py-1 rounded text-xs hover-btn-secondary"
						>
							Cancel
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
