/**
 * Menu export button. Menu is reference data with no monthly dimension, so
 * the button just triggers an immediate snapshot download — no year picker,
 * no modal.
 */
import { Button } from "@/global/components";
import { ExportsKeys } from "@/global/i18n";
import type { Id } from "convex/_generated/dataModel";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMenuExport } from "../hooks/useMenuExport";

interface ExportMenuButtonProps {
	readonly restaurantId: Id<"restaurants">;
}

export function ExportMenuButton({ restaurantId }: ExportMenuButtonProps) {
	const { t } = useTranslation();
	const { exportMenu, isExporting } = useMenuExport(restaurantId);

	return (
		<Button
			variant="secondary"
			size="md"
			leadingIcon={<Download size={14} />}
			onClick={() => void exportMenu()}
			disabled={isExporting}
			loadingLabel={<span className="sr-only">{t(ExportsKeys.STATUS_PREPARING)}</span>}
			aria-label={t(ExportsKeys.BUTTON_ARIA)}
		>
			{t(ExportsKeys.BUTTON)}
		</Button>
	);
}
