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
				className="rounded-xl p-6"
				style={{
					backgroundColor: "var(--bg-primary)",
					border: "1px solid var(--border-default)",
				}}
			>
				<div className="flex items-center justify-between mb-4">
					<div className="flex items-center gap-2">
						<AlertTriangle size={20} style={{ color: "var(--accent-danger, #e53e3e)" }} />
						<h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
							Delete Organization
						</h2>
					</div>
					<button
						onClick={onClose}
						className="p-1 rounded-md transition-colors hover:opacity-80"
						style={{ color: "var(--text-muted)" }}
					>
						<X size={18} />
					</button>
				</div>

				<p className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>
					Are you sure you want to delete{" "}
					<strong style={{ color: "var(--text-primary)" }}>{organization?.name}</strong>?
				</p>
				<p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
					This action cannot be undone.
				</p>

				{error && (
					<p className="text-xs mb-4" style={{ color: "var(--accent-danger, #e53e3e)" }}>
						{error}
					</p>
				)}

				<div className="flex justify-end gap-3">
					<button
						type="button"
						onClick={onClose}
						className="px-4 py-2 rounded-lg text-sm transition-colors"
						style={{
							backgroundColor: "var(--bg-secondary)",
							color: "var(--text-primary)",
							border: "1px solid var(--border-default)",
						}}
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleDelete}
						disabled={deleteMutation.isPending}
						className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
						style={{
							backgroundColor: "var(--accent-danger, #e53e3e)",
							color: "#fff",
						}}
					>
						{deleteMutation.isPending ? "Deleting..." : "Delete"}
					</button>
				</div>
			</div>
		</Modal>
	);
}
