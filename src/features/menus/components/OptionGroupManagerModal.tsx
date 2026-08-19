import { OptionGroupManager } from "@/features/options";
import { Modal } from "@/global/components";
import { MenusKeys } from "@/global/i18n";
import type { Id } from "convex/_generated/dataModel";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface OptionGroupManagerModalProps {
	restaurantId: Id<"restaurants">;
	isOpen: boolean;
	onClose: () => void;
}

/**
 * Full option-group editor in a modal.
 *
 * Reached from two places on purpose: the menu editor toolbar (manage every
 * group for the restaurant) and the item edit panel (the manager is already
 * looking at one item and needs to add the actual choices to a group). Linking
 * a group to an item happens in `ItemOptionGroupPicker`; this is where the
 * groups and their options are authored.
 */
export function OptionGroupManagerModal({
	restaurantId,
	isOpen,
	onClose,
}: Readonly<OptionGroupManagerModalProps>) {
	const { t } = useTranslation();

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			ariaLabel={t(MenusKeys.EDITOR_OPTION_GROUPS_MODAL_ARIA)}
			size="3xl"
		>
			<div className="rounded-xl overflow-hidden bg-background border border-border">
				<div className="flex items-center justify-between px-6 py-4 border-b border-border">
					<div>
						<h2 className="text-lg font-semibold text-foreground">
							{t(MenusKeys.EDITOR_OPTION_GROUPS_HEADING)}
						</h2>
						<p className="text-xs mt-1 text-muted-foreground">
							{t(MenusKeys.EDITOR_OPTION_GROUPS_DESCRIPTION)}
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="p-1.5 rounded-lg hover:bg-hover text-faint-foreground"
					>
						<X size={18} />
					</button>
				</div>
				<div className="p-6 max-h-[70vh] overflow-y-auto">
					<OptionGroupManager restaurantId={restaurantId} />
				</div>
			</div>
		</Modal>
	);
}
