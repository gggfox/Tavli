import { useCurrentUserRoles } from "@/features/users/hooks";
import { AdminTable } from "@/global/components";
import { useAdminTable } from "@/global/hooks";
import { OrganizationsKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { OrganizationDoc } from "convex/constants";
import { USER_ROLES } from "convex/constants";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { buildOrganizationColumns } from "./Columns";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { OrganizationFormDialog } from "./OrganizationFormDialog";

type ModalState =
	| { kind: "closed" }
	| { kind: "create" }
	| { kind: "edit"; organization: OrganizationDoc }
	| { kind: "delete"; organization: OrganizationDoc };

export function OrganizationsTable() {
	const { t, i18n } = useTranslation();
	const dateLocale = i18n.language?.startsWith("es") ? "es-MX" : "en-US";
	const tableState = useAdminTable<OrganizationDoc>({
		queryOptions: convexQuery(api.organizations.getAllOrganizations, {}),
		columns: buildOrganizationColumns(t, dateLocale),
	});
	// `getAllOrganizations` now also serves owners (scoped to their own org) so
	// the create-restaurant picker works, but every organization *mutation*
	// stays admin-only. Only offer the affordances the viewer can actually
	// complete -- otherwise an owner sees buttons that fail on submit.
	const { roles } = useCurrentUserRoles();
	const canManageOrganizations = roles.includes(USER_ROLES.ADMIN);

	const [modal, setModal] = useState<ModalState>({ kind: "closed" });

	const closeModal = () => setModal({ kind: "closed" });

	return (
		<>
			<AdminTable
				tableState={tableState}
				searchPlaceholder={t(OrganizationsKeys.SEARCH_PLACEHOLDER)}
				getResultCountText={(count) => t(OrganizationsKeys.RESULT_COUNT, { count })}
				emptyIcon={Building2}
				emptyTitle={t(OrganizationsKeys.EMPTY_TITLE)}
				emptyDescription={t(OrganizationsKeys.EMPTY_DESCRIPTION)}
				filteredEmptyTitle={t(OrganizationsKeys.FILTERED_EMPTY_TITLE)}
				notAuthenticatedMessage={t(OrganizationsKeys.NOT_AUTHENTICATED)}
				actions={
					canManageOrganizations ? (
						<button
							onClick={() => setModal({ kind: "create" })}
							className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-primary text-primary-foreground"
						>
							<Plus size={16} />
							{t(OrganizationsKeys.NEW)}
						</button>
					) : undefined
				}
				renderRowActions={
					canManageOrganizations
						? (org) => (
								<div className="flex justify-end gap-2">
									<button
										onClick={() => setModal({ kind: "edit", organization: org })}
										className="p-1.5 rounded-md transition-colors hover:opacity-80 text-muted-foreground"
										title={t(OrganizationsKeys.EDIT)}
										aria-label={t(OrganizationsKeys.EDIT)}
									>
										<Pencil size={15} />
									</button>
									<button
										onClick={() => setModal({ kind: "delete", organization: org })}
										className="p-1.5 rounded-md transition-colors hover:opacity-80 text-destructive"
										title={t(OrganizationsKeys.DELETE)}
										aria-label={t(OrganizationsKeys.DELETE)}
									>
										<Trash2 size={15} />
									</button>
								</div>
							)
						: undefined
				}
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
