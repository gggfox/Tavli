import { AdminAccessKeys } from "@/global/i18n";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface AuthLoadingStateProps {
	readonly message?: string;
}

export function AuthLoadingState({ message }: AuthLoadingStateProps = {}) {
	const { t } = useTranslation();
	return (
		<div className="flex flex-col items-center justify-center py-12 rounded-lg bg-muted">
			<Loader2 size={32} className="animate-spin mb-4 text-faint-foreground" />
			<p className="text-lg font-medium text-foreground">
				{message ?? t(AdminAccessKeys.AUTH_LOADING)}
			</p>
		</div>
	);
}
