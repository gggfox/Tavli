import { AdminTable } from "@/global/components";
import { useAdminTable } from "@/global/hooks";
import { UserOnboardingKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import { USER_ROLES, type UserRoleDoc } from "convex/constants";
import { Search, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCurrentUserRoles } from "../../hooks/useCurrentUserRoles";
import { BulkInviteDialog, InviteUserDialog } from "../invites";
import { columns } from "./Columns";

const ACTION_CLASS =
	"inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md border border-border text-foreground hover:bg-hover";

export function UsersTable() {
	const { t } = useTranslation();
	const tableState = useAdminTable<UserRoleDoc>({
		queryOptions: convexQuery(api.admin.getAllUsers, {}),
		columns,
	});

	// The onboarding endpoints are platform-admin only and say so server-side;
	// this only avoids showing an operator a control that could never work.
	// `/admin/*` itself is reachable by any staff member (the route guard asks
	// for STAFF, not ADMIN), so the check has to live here rather than relying
	// on the sidebar having hidden the tab.
	const { roles, isLoading: rolesLoading } = useCurrentUserRoles();
	const isAdmin = !rolesLoading && roles.includes(USER_ROLES.ADMIN);

	const [inviteOpen, setInviteOpen] = useState(false);
	const [bulkOpen, setBulkOpen] = useState(false);

	return (
		<>
			<AdminTable
				tableState={tableState}
				entityName="users"
				searchPlaceholder="Search users..."
				emptyIcon={Search}
				emptyTitle="No users found"
				emptyDescription="There are no users with roles assigned yet."
				notAuthenticatedMessage="Please sign in to view user management."
				actions={
					isAdmin ? (
						<>
							<button type="button" className={ACTION_CLASS} onClick={() => setInviteOpen(true)}>
								<UserPlus size={16} aria-hidden />
								{t(UserOnboardingKeys.INVITE_ACTION)}
							</button>
							<button type="button" className={ACTION_CLASS} onClick={() => setBulkOpen(true)}>
								<Users size={16} aria-hidden />
								{t(UserOnboardingKeys.BULK_ACTION)}
							</button>
						</>
					) : undefined
				}
			/>

			{isAdmin && (
				<>
					<InviteUserDialog isOpen={inviteOpen} onClose={() => setInviteOpen(false)} />
					<BulkInviteDialog isOpen={bulkOpen} onClose={() => setBulkOpen(false)} />
				</>
			)}
		</>
	);
}
