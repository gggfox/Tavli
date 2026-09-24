import { pushToast } from "@/global/components";
import { ExportsKeys } from "@/global/i18n";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useConvex } from "convex/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { downloadBase64Xlsx } from "../lib/downloadBase64Xlsx";

/**
 * Downloads the restaurant's menu as .xlsx, with success / failure toasts.
 * Shared by `ExportMenuButton` and menus that offer export as one item.
 */
export function useMenuExport(restaurantId: Id<"restaurants">) {
	const { t } = useTranslation();
	const convex = useConvex();
	const [isExporting, setIsExporting] = useState(false);

	const exportMenu = async () => {
		setIsExporting(true);
		try {
			const result = await convex.action(api.exports.exportMenuXlsx, { restaurantId });
			downloadBase64Xlsx(result.base64, result.filename, result.mimeType);
			pushToast({
				id: `export-menu-${Date.now()}`,
				kind: "success",
				title: t(ExportsKeys.STATUS_SUCCESS),
			});
		} catch (e) {
			const message =
				e instanceof Error && /too large/i.test(e.message)
					? t(ExportsKeys.STATUS_TOO_LARGE)
					: t(ExportsKeys.STATUS_ERROR);
			pushToast({
				id: `export-menu-err-${Date.now()}`,
				kind: "error",
				title: message,
			});
		} finally {
			setIsExporting(false);
		}
	};

	return { exportMenu, isExporting };
}
