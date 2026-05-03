import { Skeleton } from "@/global/components";
import { MenusKeys } from "@/global/i18n";
import { useTranslation } from "react-i18next";

const ROWS = 4;

export function MenuListSkeleton() {
	const { t } = useTranslation();
	return (
		<div className="space-y-4" aria-label={t(MenusKeys.LIST_LOADING_ARIA)} aria-busy="true">
			<div className="space-y-2">
				<Skeleton.Repeat count={ROWS} keyPrefix="menu-row">
					{(i) => (
						<Skeleton.Card className="flex items-center justify-between px-4 py-3">
							<Skeleton className="h-4" style={{ width: `${30 + (i % 3) * 12}%` }} />
							<div className="flex items-center gap-2">
								<Skeleton rounded="md" className="h-7 w-7" />
								<Skeleton rounded="md" className="h-7 w-7" />
							</div>
						</Skeleton.Card>
					)}
				</Skeleton.Repeat>
			</div>
		</div>
	);
}
