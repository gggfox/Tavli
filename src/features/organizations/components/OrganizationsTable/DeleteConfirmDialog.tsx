import { Modal } from "@/global/components";
import { OrganizationsKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { extractErrorCode, getErrorMessage } from "@/global/utils/errorMessages";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { OrganizationDoc } from "convex/constants";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";

interface DeleteConfirmDialogProps {
	isOpen: boolean;
	onClose: () => void;
	organization: OrganizationDoc | null;
	onSuccess: () => void;
}

export function DeleteConfirmDialog({
	isOpen,
	onClose,
	organization,
	onSuccess,
}: Readonly<DeleteConfirmDialogProps>) {
	const { t } = useTranslation();
	const [error, setError] = useState<string | null>(null);

	const deleteMutation = useMutation({
		mutationFn: useConvexMutation(api.organizations.deleteOrganization),
	});

	async function handleDelete() {
		if (!organization) return;
		setError(null);

		try {
			const result = await deleteMutation.mutateAsync({ id: organization._id });
			unwrapResult(result);
			onSuccess();
			onClose();
		} catch (err) {
			// The only validation failure delete has is "users are still assigned",
			// sent as English prose — the category is the stable part to branch on.
			setError(
				extractErrorCode(err) === "VALIDATION_ERROR"
					? t(OrganizationsKeys.DELETE_HAS_USERS)
					: getErrorMessage(err, t, OrganizationsKeys.DELETE_FAILED)
			);
		}
	}

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			ariaLabel={t(OrganizationsKeys.DELETE_TITLE)}
			size="sm"
		>
			<div className="rounded-xl p-6 bg-background border border-border">
				<div className="flex items-center justify-between mb-4">
					<div className="flex items-center gap-2 text-destructive">
						<AlertTriangle size={20} />
						<h2 className="text-lg font-semibold text-foreground">
							{t(OrganizationsKeys.DELETE_TITLE)}
						</h2>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label={t(OrganizationsKeys.FORM_CLOSE)}
						className="p-1 rounded-md transition-colors hover:opacity-80 text-faint-foreground"
					>
						<X size={18} />
					</button>
				</div>

				<p className="text-sm mb-1 text-muted-foreground">
					{/* The name is a component child, not an interpolated value: Trans
					    parses the translated string for tags, and an organization's
					    name is data, never markup. */}
					<Trans
						i18nKey={OrganizationsKeys.DELETE_CONFIRM}
						components={{ name: <strong className="text-foreground">{organization?.name}</strong> }}
					/>
				</p>
				<p className="text-xs mb-4 text-faint-foreground">
					{t(OrganizationsKeys.DELETE_IRREVERSIBLE)}
				</p>

				{error && <p className="text-xs mb-4 text-destructive">{error}</p>}

				<div className="flex justify-end gap-3">
					<button
						type="button"
						onClick={onClose}
						className="px-4 py-2 rounded-lg text-sm transition-colors bg-muted text-foreground border border-border"
					>
						{t(OrganizationsKeys.DELETE_CANCEL)}
					</button>
					<button
						type="button"
						onClick={handleDelete}
						disabled={deleteMutation.isPending}
						className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 bg-destructive"
						style={{ color: "#fff" }}
					>
						{deleteMutation.isPending
							? t(OrganizationsKeys.DELETE_DELETING)
							: t(OrganizationsKeys.DELETE_BUTTON)}
					</button>
				</div>
			</div>
		</Modal>
	);
}
