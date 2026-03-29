import { AdminTable } from "@/global/components";
import { useAdminTable } from "@/global/hooks";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { UserRoleDoc } from "convex/constants";
import { Search } from "lucide-react";
import { columns } from "./Columns";

export function UsersTable() {
	const tableState = useAdminTable<UserRoleDoc>({
		queryOptions: convexQuery(api.admin.getAllUsers, {}),
		columns,
	});

	return (
		<AdminTable
			tableState={tableState}
			entityName="users"
			searchPlaceholder="Search users..."
			emptyIcon={Search}
			emptyTitle="No users found"
			emptyDescription="There are no users with roles assigned yet."
			notAuthenticatedMessage="Please sign in to view user management."
		/>
	);
}
