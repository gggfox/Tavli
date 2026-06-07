import { Modal } from "@/global/components";
import { RestaurantsKeys } from "@/global/i18n";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface BulkDeleteConfirmModalProps {
	isOpen: boolean;
	selectedCount: number;
	isPending: boolean;
	onClose: () => void;
	onConfirm: () => void;
}

export function BulkDeleteConfirmModal({
	isOpen,
	selectedCount,
	isPending,
	onClose,
	onConfirm,
}: Readonly<BulkDeleteConfirmModalProps>) {
	const { t } = useTranslation();

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			ariaLabel={t(RestaurantsKeys.TABLES_BULK_CONFIRM_HEADING)}
			size="md"
		>
			<div className="p-6 rounded-xl bg-background border border-border">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-lg font-semibold text-foreground">
						{t(RestaurantsKeys.TABLES_BULK_CONFIRM_HEADING)}
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="p-1.5 rounded-md hover:bg-hover text-faint-foreground"
					>
						<X size={20} />
					</button>
				</div>
				<p className="text-sm text-foreground mb-6">
					{t(RestaurantsKeys.TABLES_BULK_CONFIRM_BODY, { count: selectedCount })}
				</p>
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-hover"
					>
						{t(RestaurantsKeys.TABLES_CANCEL)}
					</button>
					<button
						type="button"
						onClick={onConfirm}
						disabled={isPending}
						className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50"
					>
						{t(RestaurantsKeys.TABLES_BULK_CONFIRM_REMOVE)}
					</button>
				</div>
			</div>
		</Modal>
	);
}
