import { AdminTable } from "@/global/components";
import { useAdminTable } from "@/global/hooks";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { OrganizationDoc } from "convex/constants";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { columns } from "./Columns";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { OrganizationFormDialog } from "./OrganizationFormDialog";

type ModalState =
	| { kind: "closed" }
	| { kind: "create" }
	| { kind: "edit"; organization: OrganizationDoc }
	| { kind: "delete"; organization: OrganizationDoc };

export function OrganizationsTable() {
	const tableState = useAdminTable<OrganizationDoc>({
		queryOptions: convexQuery(api.organizations.getAllOrganizations, {}),
		columns,
	});

	const [modal, setModal] = useState<ModalState>({ kind: "closed" });

	const closeModal = () => setModal({ kind: "closed" });

	return (
		<>
			<AdminTable
				tableState={tableState}
				entityName="organizations"
				searchPlaceholder="Search organizations..."
				emptyIcon={Building2}
				emptyTitle="No organizations yet"
				emptyDescription="Create your first organization to get started."
				notAuthenticatedMessage="Please sign in to view organizations."
				actions={
					<button
						onClick={() => setModal({ kind: "create" })}
						className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-primary text-primary-foreground"
						
					>
						<Plus size={16} />
						New Organization
					</button>
				}
				renderRowActions={(org) => (
					<div className="flex justify-end gap-2">
						<button
							onClick={() => setModal({ kind: "edit", organization: org })}
							className="p-1.5 rounded-md transition-colors hover:opacity-80 text-muted-foreground"
							
							title="Edit"
						>
							<Pencil size={15} />
						</button>
						<button
							onClick={() => setModal({ kind: "delete", organization: org })}
							className="p-1.5 rounded-md transition-colors hover:opacity-80 text-destructive"
							
							title="Delete"
						>
							<Trash2 size={15} />
						</button>
					</div>
				)}
			/>

			<OrganizationFormDialog
				isOpen={modal.kind === "create" || modal.kind === "edit"}
				onClose={closeModal}
				organization={modal.kind === "edit" ? modal.organization : null}
				onSuccess={() => tableState.refetch()}
			/>

			<DeleteConfirmDialog
				isOpen={modal.kind === "delete"}
				onClose={closeModal}
				organization={modal.kind === "delete" ? modal.organization : null}
				onSuccess={() => tableState.refetch()}
			/>
		</>
	);
}
