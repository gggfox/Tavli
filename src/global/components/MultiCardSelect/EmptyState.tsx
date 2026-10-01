import { CommonKeys } from "@/global/i18n";
import { useTranslation } from "react-i18next";

type EmptyStateProps = Readonly<{
	isEmpty: boolean;
}>;
export function EmptyState({ isEmpty }: EmptyStateProps) {
	const { t } = useTranslation();
	if (isEmpty) {
		return <div className="hidden"></div>;
	}
	return (
		<div className="p-6 rounded-lg text-center bg-background border border-border">
			<p className="text-sm text-faint-foreground">{t(CommonKeys.SELECT_NO_OPTIONS)}</p>
		</div>
	);
}
