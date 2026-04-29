import { Loader2 } from "lucide-react";

interface AuthLoadingStateProps {
	readonly message?: string;
}

export function AuthLoadingState({
	message = "Verifying authentication...",
}: AuthLoadingStateProps = {}) {
	return (
		<div
			className="flex flex-col items-center justify-center py-12 rounded-lg bg-muted"
			
		>
			<Loader2 size={32} className="animate-spin mb-4 text-faint-foreground"  />
			<p className="text-lg font-medium text-foreground" >
				{message}
			</p>
		</div>
	);
}
