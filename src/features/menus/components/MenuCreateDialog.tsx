/**
 * "Start from scratch" menu creation (TAVLI-78).
 *
 * The menus admin used to be import-only: the sole way to get a `menus` row
 * was uploading a document. This dialog is the document-free path — name the
 * menu, create it, and land in its editor to add categories and items.
 */
import { Button, Modal, TextInput } from "@/global/components";
import { MenusKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { unwrapResult } from "@/global/utils/unwrapResult";
import type { Id } from "convex/_generated/dataModel";
import { Plus, X } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMenus } from "../hooks/useMenus";

interface MenuCreateDialogProps {
	isOpen: boolean;
	onClose: () => void;
	restaurantId: Id<"restaurants">;
	onCreated: (menuId: Id<"menus">) => void;
}

export function MenuCreateDialog({
	isOpen,
	onClose,
	restaurantId,
	onCreated,
}: Readonly<MenuCreateDialogProps>) {
	const { t } = useTranslation();
	const { createMenu } = useMenus(restaurantId);
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);

	const handleClose = useCallback(() => {
		setName("");
		setError(null);
		onClose();
	}, [onClose]);

	const trimmedName = name.trim();

	const handleSubmit = async () => {
		if (!trimmedName) return;
		setError(null);
		try {
			const menuId = unwrapResult<Id<"menus">>(
				await createMenu({ restaurantId, name: trimmedName })
			);
			setName("");
			onClose();
			onCreated(menuId);
		} catch (err) {
			setError(getErrorMessage(err, t, MenusKeys.LIST_CREATE_ERROR));
		}
	};

	return (
		<Modal
			isOpen={isOpen}
			onClose={handleClose}
			ariaLabel={t(MenusKeys.LIST_CREATE_MODAL_ARIA)}
			size="md"
		>
			<form
				className="rounded-xl overflow-hidden bg-background border border-border"
				onSubmit={(e) => {
					e.preventDefault();
					void handleSubmit();
				}}
			>
				<div className="flex items-center justify-between px-6 py-4 border-b border-border">
					<div>
						<h2 className="text-lg font-semibold text-foreground">
							{t(MenusKeys.LIST_CREATE_MODAL_TITLE)}
						</h2>
						<p className="text-xs mt-1 text-muted-foreground">
							{t(MenusKeys.LIST_CREATE_MODAL_DESCRIPTION)}
						</p>
					</div>
					<button
						type="button"
						onClick={handleClose}
						className="p-1.5 rounded-lg hover:bg-hover text-faint-foreground"
						aria-label={t(MenusKeys.FORM_CANCEL)}
					>
						<X size={18} />
					</button>
				</div>
				<div className="p-6 space-y-4">
					<TextInput
						id="menu-name"
						autoFocus
						value={name}
						maxLength={120}
						onChange={(e) => {
							setName(e.target.value);
							if (error) setError(null);
						}}
						placeholder={t(MenusKeys.LIST_NEW_PLACEHOLDER)}
						error={error ?? undefined}
					/>
					<div className="flex justify-end gap-2">
						<Button variant="secondary" size="md" type="button" onClick={handleClose}>
							{t(MenusKeys.FORM_CANCEL)}
						</Button>
						<Button
							variant="primary"
							size="md"
							type="submit"
							leadingIcon={<Plus size={14} />}
							disabled={!trimmedName}
						>
							{t(MenusKeys.LIST_ADD_BUTTON)}
						</Button>
					</div>
				</div>
			</form>
		</Modal>
	);
}
