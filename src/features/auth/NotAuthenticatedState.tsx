import type { LucideIcon } from "lucide-react";
import { ShieldAlert } from "lucide-react";

interface NotAuthenticatedStateProps {
	readonly icon?: LucideIcon;
	readonly message?: string;
}

export function NotAuthenticatedState({
	icon: Icon = ShieldAlert,
	message = "Please sign in to manage your restaurants.",
}: NotAuthenticatedStateProps = {}) {
	return (
		<div
			className="flex flex-col items-center justify-center py-12 rounded-lg bg-muted"
			
		>
			<div
				className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-hover"
				
			>
				<Icon size={24} className="text-faint-foreground"  />
			</div>
			<p className="text-lg font-medium text-foreground" >
				Authentication required
			</p>
			<p className="text-sm mt-1 text-muted-foreground" >
				{message}
			</p>
		</div>
	);
}
