import { LanguageTabBar } from "@/global/components";
import { Languages } from "@/global/i18n/locales";
import { formatCents, parseDollarsToCents } from "@/global/utils/money";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import {
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	ClipboardPaste,
	Eye,
	EyeOff,
	Globe,
	ImagePlus,
	ListChecks,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useCategories, useMenuItems, useMenus } from "../hooks/useMenus";

const LANGUAGE_LABELS: Record<string, string> = {
	en: "English",
	es: "Español",
};

const ALL_LANGUAGES = Object.values(Languages);

interface MenuEditorProps {
	menuId: Id<"menus">;
	restaurantId: Id<"restaurants">;
}

export function MenuEditor({ menuId, restaurantId }: Readonly<MenuEditorProps>) {
	const { data: menu } = useQuery(convexQuery(api.menus.getMenuById, { menuId }));
	const { categories } = useCategories(menuId);
	const { createCategory, deleteCategory, updateMenu } = useMenus(restaurantId);

	const defaultLang = menu?.defaultLanguage ?? Languages.EN;
	const supportedLangs = menu?.supportedLanguages ?? [defaultLang];
	const [selectedLang, setSelectedLang] = useState(defaultLang);
	const isTranslationMode = selectedLang !== defaultLang;

	const [newCatName, setNewCatName] = useState("");
	const [langSettingsOpen, setLangSettingsOpen] = useState(false);

	const sorted = [...categories].sort((a, b) => a.displayOrder - b.displayOrder);

	const handleAddCategory = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!newCatName.trim()) return;
		await createCategory({ menuId, restaurantId, name: newCatName.trim() });
		setNewCatName("");
	};

	const handleDefaultLangChange = async (lang: string) => {
		const newSupported = supportedLangs.includes(lang) ? supportedLangs : [...supportedLangs, lang];
		await updateMenu({ menuId, defaultLanguage: lang, supportedLanguages: newSupported });
		if (selectedLang === defaultLang) setSelectedLang(lang);
	};

	const handleToggleLanguage = async (lang: string) => {
		if (lang === defaultLang) return;
		const newSupported = supportedLangs.includes(lang)
			? supportedLangs.filter((l) => l !== lang)
			: [...supportedLangs, lang];
		await updateMenu({ menuId, supportedLanguages: newSupported });
		if (!newSupported.includes(selectedLang)) setSelectedLang(defaultLang);
	};

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-3">
				<LanguageTabBar
					languages={supportedLangs}
					defaultLanguage={defaultLang}
					selectedLanguage={selectedLang}
					onSelect={setSelectedLang}
				/>
				<button
					type="button"
					onClick={() => setLangSettingsOpen((prev) => !prev)}
					className="p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
					title="Configure languages"
				>
					<Globe
						size={16}
						style={{ color: langSettingsOpen ? "var(--btn-primary-bg)" : "var(--text-muted)" }}
					/>
				</button>
			</div>

			{langSettingsOpen && (
				<MenuLanguageSettings
					defaultLanguage={defaultLang}
					supportedLanguages={supportedLangs}
					onDefaultChange={handleDefaultLangChange}
					onToggleLanguage={handleToggleLanguage}
				/>
			)}

			{!isTranslationMode && (
				<form onSubmit={handleAddCategory} className="flex gap-3">
					<input
						type="text"
						value={newCatName}
						onChange={(e) => setNewCatName(e.target.value)}
						placeholder="New category (e.g. Appetizers)"
						className="flex-1 px-3 py-2 rounded-lg text-sm"
						style={{
							backgroundColor: "var(--bg-secondary)",
							border: "1px solid var(--border-default)",
							color: "var(--text-primary)",
						}}
					/>
					<button
						type="submit"
						className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
					>
						<Plus size={16} /> Add Category
					</button>
				</form>
			)}

			{isTranslationMode && (
				<p className="text-xs" style={{ color: "var(--text-muted)" }}>
					Translating names and descriptions. Prices, images, and options are shared across all
					languages.
				</p>
			)}

			{sorted.map((cat) => (
				<CategorySection
					key={cat._id}
					category={cat}
					restaurantId={restaurantId}
					onDeleteCategory={() => deleteCategory({ categoryId: cat._id })}
					selectedLang={isTranslationMode ? selectedLang : undefined}
				/>
			))}
			{sorted.length === 0 && (
				<p className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>
					No categories yet. Add your first category above.
				</p>
			)}
		</div>
	);
}

function MenuLanguageSettings({
	defaultLanguage,
	supportedLanguages,
	onDefaultChange,
	onToggleLanguage,
}: Readonly<{
	defaultLanguage: string;
	supportedLanguages: string[];
	onDefaultChange: (lang: string) => void;
	onToggleLanguage: (lang: string) => void;
}>) {
	return (
		<div
			className="space-y-3 p-4 rounded-lg"
			style={{
				backgroundColor: "var(--bg-secondary)",
				border: "1px solid var(--border-default)",
			}}
		>
			<div>
				<label
					htmlFor="menu-default-language"
					className="block text-xs mb-1"
					style={{ color: "var(--text-muted)" }}
				>
					Default language (used for main item names)
				</label>
				<select
					id="menu-default-language"
					value={defaultLanguage}
					onChange={(e) => onDefaultChange(e.target.value)}
					className="w-full px-3 py-2 rounded-lg text-sm"
					style={{
						backgroundColor: "var(--bg-primary)",
						border: "1px solid var(--border-default)",
						color: "var(--text-primary)",
					}}
				>
					{ALL_LANGUAGES.map((lang) => (
						<option key={lang} value={lang}>
							{LANGUAGE_LABELS[lang] ?? lang}
						</option>
					))}
				</select>
			</div>
			<div>
				<span className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>
					Additional languages for translations
				</span>
				<div className="flex flex-wrap gap-2">
					{ALL_LANGUAGES.filter((l) => l !== defaultLanguage).map((lang) => (
						<button
							key={lang}
							type="button"
							onClick={() => onToggleLanguage(lang)}
							className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
							style={{
								backgroundColor: supportedLanguages.includes(lang)
									? "var(--accent-primary)"
									: "var(--bg-tertiary)",
								color: supportedLanguages.includes(lang) ? "white" : "var(--text-secondary)",
								border: "1px solid var(--border-default)",
							}}
						>
							{LANGUAGE_LABELS[lang] ?? lang}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}

async function uploadImage(
	generateUploadUrl: () => Promise<[string, null] | [null, any]>,
	file: File
): Promise<Id<"_storage">> {
	const url = unwrapResult(await generateUploadUrl()) as string;
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": file.type },
		body: file,
	});
	const { storageId } = await response.json();
	return storageId as Id<"_storage">;
}

function getImageFromClipboard(e: React.ClipboardEvent): File | null {
	const items = e.clipboardData?.items;
	if (!items) return null;
	for (const item of items) {
		if (item.type.startsWith("image/")) {
			return item.getAsFile();
		}
	}
	return null;
}

function CategorySection({
	category,
	restaurantId,
	onDeleteCategory,
	selectedLang,
}: Readonly<{
	category: Doc<"menuCategories">;
	restaurantId: Id<"restaurants">;
	onDeleteCategory: () => void;
	selectedLang?: string;
}>) {
	const isTranslating = !!selectedLang;
	const [expanded, setExpanded] = useState(true);
	const {
		items,
		createItem,
		removeItem,
		toggleAvailability: toggleAvail,
		generateUploadUrl,
	} = useMenuItems(category._id);

	const setCategoryTranslation = useMutation({
		mutationFn: useConvexMutation(api.menus.setCategoryTranslation),
	});
	const setItemTranslation = useMutation({
		mutationFn: useConvexMutation(api.menuItems.setTranslation),
	});

	const [showAddForm, setShowAddForm] = useState(false);
	const [itemName, setItemName] = useState("");
	const [itemPrice, setItemPrice] = useState("");
	const [itemDesc, setItemDesc] = useState("");
	const [selectedImage, setSelectedImage] = useState<File | null>(null);
	const [imagePreview, setImagePreview] = useState<string | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [optionsExpandedFor, setOptionsExpandedFor] = useState<Id<"menuItems"> | null>(null);
	const [imageExpandedFor, setImageExpandedFor] = useState<Id<"menuItems"> | null>(null);

	const sorted = [...items].sort((a, b) => a.displayOrder - b.displayOrder);

	const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0] ?? null;
		setSelectedImage(file);
		if (file) {
			const url = URL.createObjectURL(file);
			setImagePreview(url);
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

	const clearSelectedImage = () => {
		setSelectedImage(null);
		setImagePreview(null);
		if (fileInputRef.current) fileInputRef.current.value = "";
	};

	const handleAddItem = async (e: React.FormEvent) => {
		e.preventDefault();
		const price = parseDollarsToCents(itemPrice);
		if (Number.isNaN(price) || !itemName.trim()) return;

		setIsUploading(true);
		try {
			let imageStorageId: Id<"_storage"> | undefined;
			if (selectedImage) {
				imageStorageId = await uploadImage(generateUploadUrl, selectedImage);
			}

			await createItem({
				categoryId: category._id,
				restaurantId,
				name: itemName.trim(),
				description: itemDesc || undefined,
				basePrice: price,
				imageStorageId,
			});

			setItemName("");
			setItemPrice("");
			setItemDesc("");
			clearSelectedImage();
			setShowAddForm(false);
		} finally {
			setIsUploading(false);
		}
	};

	return (
		<div
			className="rounded-lg overflow-hidden"
			style={{ border: "1px solid var(--border-default)" }}
		>
			<div
				className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--bg-hover)]"
				style={{ backgroundColor: "var(--bg-secondary)" }}
				onClick={() => setExpanded(!expanded)}
			>
				<div className="flex items-center gap-2 flex-1 min-w-0">
					{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
					{isTranslating ? (
						<div className="flex items-center gap-2 flex-1 min-w-0">
							<span className="text-sm shrink-0" style={{ color: "var(--text-muted)" }}>
								{category.name} &rarr;
							</span>
							<InlineTranslationInput
								value={category.translations?.[selectedLang]?.name ?? ""}
								placeholder={`${category.name} translation...`}
								onSave={(val) =>
									setCategoryTranslation.mutateAsync({
										categoryId: category._id,
										lang: selectedLang,
										name: val,
									})
								}
							/>
							{!category.translations?.[selectedLang]?.name && (
								<AlertTriangle size={14} style={{ color: "var(--accent-warning)" }} />
							)}
						</div>
					) : (
						<>
							<span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
								{category.name}
							</span>
							<span className="text-xs" style={{ color: "var(--text-muted)" }}>
								({sorted.length} items)
							</span>
						</>
					)}
				</div>
				{!isTranslating && (
					<button
						onClick={(e) => {
							e.stopPropagation();
							onDeleteCategory();
						}}
						className="p-1 rounded hover:bg-[var(--bg-hover)]"
						title="Delete category"
					>
						<Trash2 size={14} style={{ color: "var(--accent-danger)" }} />
					</button>
				)}
			</div>

			{expanded && (
				<div className="p-4 space-y-3">
					{sorted.map((item) => {
						if (isTranslating) {
							const translatedName = item.translations?.[selectedLang]?.name ?? "";
							const translatedDesc = item.translations?.[selectedLang]?.description ?? "";
							const isMissing = !translatedName;
							return (
								<div
									key={item._id}
									className="px-3 py-2.5 rounded-lg space-y-2"
									style={{
										backgroundColor: "var(--bg-primary)",
										border: isMissing
											? "1px solid var(--accent-warning)"
											: "1px solid var(--border-default)",
									}}
								>
									<div className="flex items-center gap-2.5">
										{item.imageUrl ? (
											<img
												src={item.imageUrl}
												alt={item.name}
												className="w-8 h-8 rounded object-cover flex-shrink-0 opacity-60"
											/>
										) : (
											<div
												className="w-8 h-8 rounded flex-shrink-0"
												style={{ backgroundColor: "var(--bg-secondary)" }}
											/>
										)}
										<div className="flex-1 min-w-0 space-y-1.5">
											<div className="flex items-center gap-2">
												<span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
													{item.name} &rarr;
												</span>
												<InlineTranslationInput
													value={translatedName}
													placeholder={`${item.name} translation...`}
													onSave={(val) =>
														setItemTranslation.mutateAsync({
															itemId: item._id,
															lang: selectedLang,
															name: val,
														})
													}
												/>
												{isMissing && (
													<AlertTriangle
														size={14}
														className="shrink-0"
														style={{ color: "var(--accent-warning)" }}
													/>
												)}
											</div>
											{(item.description || translatedDesc) && (
												<div className="flex items-center gap-2">
													<span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
														desc &rarr;
													</span>
													<InlineTranslationInput
														value={translatedDesc}
														placeholder="Description translation..."
														onSave={(val) =>
															setItemTranslation.mutateAsync({
																itemId: item._id,
																lang: selectedLang,
																description: val,
															})
														}
													/>
												</div>
											)}
										</div>
										<span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
											${formatCents(item.basePrice)}
										</span>
									</div>
								</div>
							);
						}

						const isExpanded = optionsExpandedFor === item._id || imageExpandedFor === item._id;
						return (
							<div key={item._id} className="space-y-0">
								<div
									className="flex items-center justify-between px-3 py-2 rounded-lg"
									style={{
										backgroundColor: "var(--bg-primary)",
										border: "1px solid var(--border-default)",
										borderBottomLeftRadius: isExpanded ? 0 : undefined,
										borderBottomRightRadius: isExpanded ? 0 : undefined,
									}}
								>
									<div className="flex items-center gap-2.5">
										{item.imageUrl ? (
											<img
												src={item.imageUrl}
												alt={item.name}
												className="w-10 h-10 rounded object-cover flex-shrink-0"
											/>
										) : (
											<div
												className="w-10 h-10 rounded flex-shrink-0 flex items-center justify-center"
												style={{
													backgroundColor: "var(--bg-secondary)",
													border: "1px dashed var(--border-default)",
												}}
											>
												<ImagePlus size={14} style={{ color: "var(--text-muted)" }} />
											</div>
										)}
										<div>
											<span
												className="text-sm font-medium"
												style={{
													color: item.isAvailable ? "var(--text-primary)" : "var(--text-muted)",
												}}
											>
												{item.name}
											</span>
											{!item.isAvailable && item.unavailableReason && (
												<span className="text-xs ml-2" style={{ color: "var(--accent-warning)" }}>
													({item.unavailableReason})
												</span>
											)}
											<span className="text-sm ml-3" style={{ color: "var(--text-secondary)" }}>
												${formatCents(item.basePrice)}
											</span>
										</div>
									</div>
									<div className="flex items-center gap-1">
										<button
											onClick={() => {
												setImageExpandedFor((prev) => (prev === item._id ? null : item._id));
												if (optionsExpandedFor === item._id) setOptionsExpandedFor(null);
											}}
											className="p-1 rounded hover:bg-[var(--bg-hover)]"
											title="Manage image"
										>
											<ImagePlus
												size={16}
												style={{
													color:
														imageExpandedFor === item._id
															? "var(--btn-primary-bg)"
															: item.imageUrl
																? "var(--accent-success)"
																: "var(--text-muted)",
												}}
											/>
										</button>
										<button
											onClick={() => {
												setOptionsExpandedFor((prev) => (prev === item._id ? null : item._id));
												if (imageExpandedFor === item._id) setImageExpandedFor(null);
											}}
											className="p-1 rounded hover:bg-[var(--bg-hover)]"
											title="Link option groups"
										>
											<ItemOptionsIcon
												itemId={item._id}
												isActive={optionsExpandedFor === item._id}
											/>
										</button>
										<button
											onClick={() => toggleAvail({ itemId: item._id })}
											className="p-1 rounded hover:bg-[var(--bg-hover)]"
											title={item.isAvailable ? "Mark unavailable" : "Mark available"}
										>
											{item.isAvailable ? (
												<Eye size={16} style={{ color: "var(--accent-success)" }} />
											) : (
												<EyeOff size={16} style={{ color: "var(--text-muted)" }} />
											)}
										</button>
										<button
											onClick={() => removeItem({ itemId: item._id })}
											className="p-1 rounded hover:bg-[var(--bg-hover)]"
											title="Remove item"
										>
											<Trash2 size={14} style={{ color: "var(--accent-danger)" }} />
										</button>
									</div>
								</div>
								{optionsExpandedFor === item._id && (
									<ItemOptionGroupPicker itemId={item._id} restaurantId={restaurantId} />
								)}
								{imageExpandedFor === item._id && (
									<ItemImageManager itemId={item._id} currentImageUrl={item.imageUrl ?? null} />
								)}
							</div>
						);
					})}

					{isTranslating ? null : showAddForm ? (
						<form onSubmit={handleAddItem} onPaste={handleFormPaste} className="space-y-2 pt-2">
							<div className="flex gap-2">
								<input
									type="text"
									value={itemName}
									onChange={(e) => setItemName(e.target.value)}
									placeholder="Item name"
									required
									className="flex-1 px-2 py-1.5 rounded text-sm"
									style={{
										backgroundColor: "var(--bg-secondary)",
										border: "1px solid var(--border-default)",
										color: "var(--text-primary)",
									}}
								/>
								<input
									type="number"
									value={itemPrice}
									onChange={(e) => setItemPrice(e.target.value)}
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
							</div>
							<input
								type="text"
								value={itemDesc}
								onChange={(e) => setItemDesc(e.target.value)}
								placeholder="Description (optional)"
								className="w-full px-2 py-1.5 rounded text-sm"
								style={{
									backgroundColor: "var(--bg-secondary)",
									border: "1px solid var(--border-default)",
									color: "var(--text-primary)",
								}}
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
									<span
										className="flex items-center gap-1 text-xs"
										style={{ color: "var(--text-muted)" }}
									>
										<ClipboardPaste size={12} /> or paste from clipboard
									</span>
								)}
								{imagePreview && (
									<div className="relative">
										<img
											src={imagePreview}
											alt="Preview"
											className="w-10 h-10 rounded object-cover"
										/>
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
								<button
									type="submit"
									disabled={isUploading}
									className="px-3 py-1.5 rounded text-sm font-medium hover-btn-primary disabled:opacity-50"
								>
									{isUploading ? "Uploading..." : "Add"}
								</button>
								<button
									type="button"
									onClick={() => {
										setShowAddForm(false);
										clearSelectedImage();
									}}
									className="px-3 py-1.5 rounded text-sm hover-btn-secondary"
								>
									Cancel
								</button>
							</div>
						</form>
					) : (
						<button
							onClick={() => setShowAddForm(true)}
							className="flex items-center gap-1 text-sm py-2 hover:underline"
							style={{ color: "var(--btn-primary-bg)" }}
						>
							<Plus size={14} /> Add item
						</button>
					)}
				</div>
			)}
		</div>
	);
}

function InlineTranslationInput({
	value,
	placeholder,
	onSave,
}: Readonly<{
	value: string;
	placeholder: string;
	onSave: (value: string) => Promise<unknown>;
}>) {
	const [draft, setDraft] = useState(value);
	const [dirty, setDirty] = useState(false);

	const save = async () => {
		if (draft !== value) {
			await onSave(draft);
			setDirty(false);
		}
	};

	return (
		<input
			type="text"
			value={dirty ? draft : value}
			onChange={(e) => {
				setDraft(e.target.value);
				setDirty(true);
			}}
			onBlur={save}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					(e.target as HTMLInputElement).blur();
				}
			}}
			onClick={(e) => e.stopPropagation()}
			placeholder={placeholder}
			className="flex-1 min-w-0 px-2 py-1 rounded text-sm"
			style={{
				backgroundColor: "var(--bg-secondary)",
				border: "1px solid var(--border-default)",
				color: "var(--text-primary)",
			}}
		/>
	);
}

function ItemImageManager({
	itemId,
	currentImageUrl,
}: Readonly<{ itemId: Id<"menuItems">; currentImageUrl: string | null }>) {
	const generateUploadUrl = useConvexMutation(api.menuItems.generateUploadUrl);
	const updateItem = useMutation({ mutationFn: useConvexMutation(api.menuItems.update) });
	const removeImageMut = useMutation({
		mutationFn: useConvexMutation(api.menuItems.removeImage),
	});

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

function ItemOptionsIcon({
	itemId,
	isActive,
}: Readonly<{ itemId: Id<"menuItems">; isActive: boolean }>) {
	const { data: linkedGroups } = useQuery(
		convexQuery(api.optionGroups.getGroupsForMenuItem, { menuItemId: itemId })
	);
	const hasLinks = (linkedGroups ?? []).length > 0;

	return (
		<div className="relative">
			<ListChecks
				size={16}
				style={{ color: isActive ? "var(--btn-primary-bg)" : "var(--text-muted)" }}
			/>
			{hasLinks && (
				<div
					className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
					style={{ backgroundColor: "var(--btn-primary-bg)" }}
				/>
			)}
		</div>
	);
}

function ItemOptionGroupPicker({
	itemId,
	restaurantId,
}: Readonly<{ itemId: Id<"menuItems">; restaurantId: Id<"restaurants"> }>) {
	const { data: allGroups } = useQuery(
		convexQuery(api.optionGroups.getGroupsByRestaurant, { restaurantId })
	);
	const { data: linkedGroups } = useQuery(
		convexQuery(api.optionGroups.getGroupsForMenuItem, { menuItemId: itemId })
	);

	const linkMutation = useMutation({
		mutationFn: useConvexMutation(api.optionGroups.linkToMenuItem),
	});
	const unlinkMutation = useMutation({
		mutationFn: useConvexMutation(api.optionGroups.unlinkFromMenuItem),
	});

	const linkedIds = new Set((linkedGroups ?? []).map((g: any) => g._id as string));
	const sorted = [...(allGroups ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);

	const handleToggle = async (groupId: Id<"optionGroups">) => {
		if (linkedIds.has(groupId)) {
			unwrapResult(
				await unlinkMutation.mutateAsync({ menuItemId: itemId, optionGroupId: groupId })
			);
		} else {
			unwrapResult(
				await linkMutation.mutateAsync({ menuItemId: itemId, optionGroupId: groupId, restaurantId })
			);
		}
	};

	if (sorted.length === 0) {
		return (
			<div
				className="px-3 py-3 text-xs rounded-b-lg"
				style={{
					backgroundColor: "var(--bg-secondary)",
					borderLeft: "1px solid var(--border-default)",
					borderRight: "1px solid var(--border-default)",
					borderBottom: "1px solid var(--border-default)",
					color: "var(--text-muted)",
				}}
			>
				No option groups yet. Create them in the Options page first.
			</div>
		);
	}

	return (
		<div
			className="px-3 py-3 rounded-b-lg space-y-2"
			style={{
				backgroundColor: "var(--bg-secondary)",
				borderLeft: "1px solid var(--border-default)",
				borderRight: "1px solid var(--border-default)",
				borderBottom: "1px solid var(--border-default)",
			}}
		>
			<span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
				Linked Option Groups
			</span>
			<div className="flex flex-wrap gap-2">
				{sorted.map((group) => {
					const isLinked = linkedIds.has(group._id);
					return (
						<button
							key={group._id}
							onClick={() => handleToggle(group._id)}
							disabled={linkMutation.isPending || unlinkMutation.isPending}
							className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-50"
							style={{
								backgroundColor: isLinked ? "var(--btn-primary-bg)" : "var(--bg-primary)",
								color: isLinked ? "var(--btn-primary-text)" : "var(--text-secondary)",
								border: isLinked ? "1px solid transparent" : "1px solid var(--border-default)",
							}}
						>
							{group.name}
							<span className="ml-1 opacity-70">
								{group.selectionType === "single" ? "· Single" : "· Multi"}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
