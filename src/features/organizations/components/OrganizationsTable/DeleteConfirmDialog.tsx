import { Modal } from "@/global/components";
import { unwrapResult } from "@/global/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { OrganizationDoc } from "convex/constants";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";

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
			setError(err instanceof Error ? err.message : "Failed to delete organization");
		}
	}

	return (
		<Modal isOpen={isOpen} onClose={onClose} ariaLabel="Delete Organization" size="sm">
			<div
				className="rounded-xl p-6 bg-background border border-border"
				
			>
				<div className="flex items-center justify-between mb-4">
					<div className="flex items-center gap-2 text-destructive">
						<AlertTriangle size={20}  />
						<h2 className="text-lg font-semibold text-foreground" >
							Delete Organization
						</h2>
					</div>
					<button
						onClick={onClose}
						className="p-1 rounded-md transition-colors hover:opacity-80 text-faint-foreground"
						
					>
						<X size={18} />
					</button>
				</div>

				<p className="text-sm mb-1 text-muted-foreground" >
					Are you sure you want to delete{" "}
					<strong className="text-foreground" >{organization?.name}</strong>?
				</p>
				<p className="text-xs mb-4 text-faint-foreground" >
					This action cannot be undone.
				</p>

				{error && (
					<p className="text-xs mb-4 text-destructive" >
						{error}
					</p>
				)}

				<div className="flex justify-end gap-3">
					<button
						type="button"
						onClick={onClose}
						className="px-4 py-2 rounded-lg text-sm transition-colors bg-muted text-foreground border border-border"
						
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleDelete}
						disabled={deleteMutation.isPending}
						className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 bg-destructive"
						style={{color: "#fff"}}
					>
						{deleteMutation.isPending ? "Deleting..." : "Delete"}
					</button>
				</div>
			</div>
		</Modal>
	);
}
