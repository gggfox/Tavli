import { EmptyState as GlobalEmptyState } from "@/global/components";
import { Search } from "lucide-react";

export function EmptyState() {
	return (
		<GlobalEmptyState
			icon={Search}
			title="No users found"
			description="There are no users with roles assigned yet."
		/>
	);
}
