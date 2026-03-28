import { NotAuthenticatedState as BaseNotAuthenticatedState } from "@/features/auth";
import { Search } from "lucide-react";

export function NotAuthenticatedState() {
	return (
		<BaseNotAuthenticatedState icon={Search} message="Please sign in to view user management." />
	);
}
