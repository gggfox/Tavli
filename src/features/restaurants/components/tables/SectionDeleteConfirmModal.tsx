import { Modal } from "@/global/components";
import { RestaurantsKeys } from "@/global/i18n";
import type { Doc } from "convex/_generated/dataModel";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface SectionDeleteConfirmModalProps {
	section: Doc<"sections"> | undefined;
	sectionDisplayName: string;
	confirmDeleteBody: string;
	onClose: () => void;
	onConfirm: () => void;
}

export function SectionDeleteConfirmModal({
	section,
	sectionDisplayName,
	confirmDeleteBody,
	onClose,
	onConfirm,
}: Readonly<SectionDeleteConfirmModalProps>) {
	const { t } = useTranslation();

	return (
		<Modal
			isOpen={section !== undefined}
			onClose={onClose}
			ariaLabel={t(RestaurantsKeys.SECTIONS_CONFIRM_DELETE_HEADING)}
			size="md"
		>
			{section && (
				<div className="p-6 rounded-xl bg-background border border-border">
					<div className="flex items-center justify-between mb-4">
						<h2 className="text-lg font-semibold text-foreground">
							{t(RestaurantsKeys.SECTIONS_CONFIRM_DELETE_HEADING)}
						</h2>
						<button
							type="button"
							onClick={onClose}
							className="p-1.5 rounded-md hover:bg-hover text-faint-foreground"
						>
							<X size={20} />
						</button>
					</div>
					<p className="text-sm text-muted-foreground mb-2">{sectionDisplayName}</p>
					<p className="text-sm text-foreground mb-6">{confirmDeleteBody}</p>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={onClose}
							className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-hover"
						>
							{t(RestaurantsKeys.SECTIONS_CONFIRM_DELETE_CANCEL)}
						</button>
						<button
							type="button"
							onClick={onConfirm}
							className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:opacity-90"
						>
							{t(RestaurantsKeys.SECTIONS_CONFIRM_DELETE_CONFIRM)}
						</button>
					</div>
				</div>
			)}
		</Modal>
	);
}
