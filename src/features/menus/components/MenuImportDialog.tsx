import { Modal } from "@/global/components/Modal";
import { MenusKeys } from "@/global/i18n";
import type { Doc, Id } from "convex/_generated/dataModel";
import { FileUp, Loader2, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMenuImport } from "../hooks/useMenuImport";

const ACCEPTED_EXTENSIONS = ".pdf,.docx,.doc,.txt,.csv";

interface MenuImportDialogProps {
	isOpen: boolean;
	onClose: () => void;
	restaurantId: Id<"restaurants"> | undefined;
	menus: Doc<"menus">[];
}

export function MenuImportDialog({
	isOpen,
	onClose,
	restaurantId,
	menus,
}: Readonly<MenuImportDialogProps>) {
	const { t } = useTranslation();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [targetMenuId, setTargetMenuId] = useState<Id<"menus"> | "__new__">(
		menus[0]?._id ?? "__new__"
	);
	const [newMenuName, setNewMenuName] = useState("");

	const { step, extraction, error, result, uploadAndExtract, confirmImport, reset } = useMenuImport(
		{ restaurantId }
	);

	const handleClose = useCallback(() => {
		reset();
		setTargetMenuId(menus[0]?._id ?? "__new__");
		setNewMenuName("");
		onClose();
	}, [reset, onClose, menus]);

	const handleFileSelect = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (file) uploadAndExtract(file);
		},
		[uploadAndExtract]
	);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			const file = e.dataTransfer.files[0];
			if (file) uploadAndExtract(file);
		},
		[uploadAndExtract]
	);

	const handleConfirm = useCallback(() => {
		if (!extraction) return;

		if (targetMenuId === "__new__") {
			const name = newMenuName.trim() || "Imported Menu";
			const fallbackMenuId = menus[0]?._id;
			if (fallbackMenuId) {
				confirmImport(fallbackMenuId, name);
			}
		} else {
			confirmImport(targetMenuId);
		}
	}, [extraction, targetMenuId, newMenuName, menus, confirmImport]);

	const formatPrice = (cents: number) => {
		if (cents === 0) return "—";
		return `$${(cents / 100).toFixed(2)}`;
	};

	const totalItems = extraction?.categories.reduce((sum, cat) => sum + cat.items.length, 0) ?? 0;

	return (
		<Modal
			isOpen={isOpen}
			onClose={handleClose}
			ariaLabel={t(MenusKeys.IMPORT_MODAL_ARIA)}
			size="3xl"
		>
			<div className="p-6 bg-surface rounded-xl space-y-6">
				<h2 className="text-lg font-semibold text-foreground">{t(MenusKeys.IMPORT_MODAL_TITLE)}</h2>

				{(step === "idle" || step === "error") && (
					<>
						{/* Menu target selector */}
						<div className="space-y-2">
							<label className="text-sm font-medium text-foreground">
								{t(MenusKeys.IMPORT_TARGET_LABEL)}
							</label>
							<select
								className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm"
								value={targetMenuId}
								onChange={(e) => setTargetMenuId(e.target.value as Id<"menus"> | "__new__")}
							>
								{menus.map((menu) => (
									<option key={menu._id} value={menu._id}>
										{menu.name}
									</option>
								))}
								<option value="__new__">{t(MenusKeys.IMPORT_TARGET_NEW)}</option>
							</select>
							{targetMenuId === "__new__" && (
								<input
									type="text"
									className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm"
									placeholder={t(MenusKeys.IMPORT_NEW_MENU_PLACEHOLDER)}
									value={newMenuName}
									onChange={(e) => setNewMenuName(e.target.value)}
								/>
							)}
						</div>

						{/* Dropzone */}
						<button
							type="button"
							className="w-full border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary hover:bg-hover transition-colors"
							onClick={() => fileInputRef.current?.click()}
							onDragOver={(e) => e.preventDefault()}
							onDrop={handleDrop}
						>
							<Upload className="mx-auto mb-3 text-muted-foreground" size={32} />
							<p className="text-sm font-medium text-foreground">
								{t(MenusKeys.IMPORT_DROPZONE_LABEL)}
							</p>
							<p className="text-xs text-muted-foreground mt-1">
								{t(MenusKeys.IMPORT_DROPZONE_HINT)}
							</p>
							<input
								ref={fileInputRef}
								type="file"
								className="hidden"
								accept={ACCEPTED_EXTENSIONS}
								onChange={handleFileSelect}
							/>
						</button>

						{error && (
							<p className="text-sm text-error">{t(MenusKeys.IMPORT_ERROR, { message: error })}</p>
						)}
					</>
				)}

				{(step === "uploading" || step === "extracting") && (
					<div className="flex flex-col items-center justify-center py-12 gap-3">
						<Loader2 className="animate-spin text-primary" size={32} />
						<p className="text-sm text-muted-foreground">
							{step === "uploading"
								? t(MenusKeys.IMPORT_UPLOADING)
								: t(MenusKeys.IMPORT_EXTRACTING)}
						</p>
					</div>
				)}

				{step === "preview" && extraction && (
					<>
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-medium text-foreground">
								{t(MenusKeys.IMPORT_PREVIEW_TITLE)}
							</h3>
							<span className="text-xs text-muted-foreground">
								{extraction.categories.length} categories · {totalItems} items
							</span>
						</div>

						<div className="max-h-96 overflow-y-auto border border-border rounded-lg">
							<table className="w-full text-sm">
								<thead className="bg-muted sticky top-0">
									<tr>
										<th className="text-left px-3 py-2 font-medium text-foreground">
											{t(MenusKeys.IMPORT_PREVIEW_CATEGORY)}
										</th>
										<th className="text-left px-3 py-2 font-medium text-foreground">
											{t(MenusKeys.IMPORT_PREVIEW_ITEM)}
										</th>
										<th className="text-right px-3 py-2 font-medium text-foreground">
											{t(MenusKeys.IMPORT_PREVIEW_PRICE)}
										</th>
									</tr>
								</thead>
								<tbody>
									{extraction.categories.map((cat, ci) =>
										cat.items.map((item, ii) => (
											<tr key={`${ci}-${ii}`} className="border-t border-border hover:bg-hover">
												<td className="px-3 py-2 text-muted-foreground">
													{ii === 0 ? cat.name : ""}
												</td>
												<td className="px-3 py-2 text-foreground">
													<span>{item.name}</span>
													{item.description && (
														<span className="block text-xs text-muted-foreground mt-0.5">
															{item.description}
														</span>
													)}
												</td>
												<td className="px-3 py-2 text-right text-foreground tabular-nums">
													{formatPrice(item.priceInCents)}
												</td>
											</tr>
										))
									)}
								</tbody>
							</table>
						</div>

						<div className="flex justify-end gap-3">
							<button
								onClick={handleClose}
								className="px-4 py-2 text-sm rounded-md border border-border text-foreground hover:bg-hover"
							>
								{t(MenusKeys.IMPORT_CANCEL)}
							</button>
							<button
								onClick={handleConfirm}
								className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
							>
								{t(MenusKeys.IMPORT_CONFIRM)}
							</button>
						</div>
					</>
				)}

				{step === "inserting" && (
					<div className="flex flex-col items-center justify-center py-12 gap-3">
						<Loader2 className="animate-spin text-primary" size={32} />
						<p className="text-sm text-muted-foreground">{t(MenusKeys.IMPORT_INSERTING)}</p>
					</div>
				)}

				{step === "done" && result && (
					<div className="flex flex-col items-center justify-center py-12 gap-4">
						<FileUp className="text-success" size={32} />
						<p className="text-sm text-foreground text-center">
							{t(MenusKeys.IMPORT_SUCCESS, {
								itemsCreated: result.itemsCreated,
								categoriesCreated: result.categoriesCreated,
								categoriesMerged: result.categoriesMerged,
							})}
						</p>
						<button
							onClick={handleClose}
							className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
						>
							{t(MenusKeys.FORM_CANCEL) /* "Done" effectively */}
						</button>
					</div>
				)}
			</div>
		</Modal>
	);
}
