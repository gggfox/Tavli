import { useMenus } from "@/features/menus/hooks/useMenus";
import { Button, Modal } from "@/global/components";
import { MenusKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import type { Id } from "convex/_generated/dataModel";
import { Plus, X } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

function parseCategoryNames(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

interface AddCategoriesModalProps {
	isOpen: boolean;
	onClose: () => void;
	menuId: Id<"menus">;
	restaurantId: Id<"restaurants">;
}

export function AddCategoriesModal({
	isOpen,
	onClose,
	menuId,
	restaurantId,
}: Readonly<AddCategoriesModalProps>) {
	const { t } = useTranslation();
	const { createCategories } = useMenus(restaurantId);
	const [text, setText] = useState("");
	const [validationError, setValidationError] = useState<string | null>(null);

	const handleClose = useCallback(() => {
		setText("");
		setValidationError(null);
		onClose();
	}, [onClose]);

	const handleSubmit = async () => {
		const names = parseCategoryNames(text);
		if (names.length === 0) {
			setValidationError(t(MenusKeys.ADD_CATEGORIES_VALIDATION));
			return;
		}

		setValidationError(null);
		unwrapResult(await createCategories({ menuId, restaurantId, names }));
		handleClose();
	};

	return (
		<Modal
			isOpen={isOpen}
			onClose={handleClose}
			ariaLabel={t(MenusKeys.ADD_CATEGORIES_MODAL_ARIA)}
			size="md"
		>
			<div className="rounded-xl overflow-hidden bg-background border border-border">
				<div className="flex items-center justify-between px-6 py-4 border-b border-border">
					<div>
						<h2 className="text-lg font-semibold text-foreground">
							{t(MenusKeys.ADD_CATEGORIES_HEADING)}
						</h2>
						<p className="text-xs mt-1 text-muted-foreground">
							{t(MenusKeys.ADD_CATEGORIES_DESCRIPTION)}
						</p>
					</div>
					<button
						type="button"
						onClick={handleClose}
						className="p-1.5 rounded-lg hover:bg-hover text-faint-foreground"
					>
						<X size={18} />
					</button>
				</div>
				<div className="p-6 space-y-4">
					<textarea
						value={text}
						onChange={(e) => {
							setText(e.target.value);
							if (validationError) setValidationError(null);
						}}
						placeholder={t(MenusKeys.ADD_CATEGORIES_PLACEHOLDER)}
						rows={6}
						className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground resize-y min-h-[8rem]"
					/>
					{validationError ? <p className="text-xs text-destructive">{validationError}</p> : null}
					<div className="flex justify-end gap-2">
						<Button variant="secondary" size="md" onClick={handleClose}>
							{t(MenusKeys.FORM_CANCEL)}
						</Button>
						<Button
							variant="primary"
							size="md"
							leadingIcon={<Plus size={14} />}
							onClick={handleSubmit}
							disabled={parseCategoryNames(text).length === 0}
						>
							{t(MenusKeys.ADD_CATEGORIES_SUBMIT)}
						</Button>
					</div>
				</div>
			</div>
		</Modal>
	);
}
