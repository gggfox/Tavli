/**
 * Menu export button. Menu is reference data with no monthly dimension, so
 * the button just triggers an immediate snapshot download — no year picker,
 * no modal.
 */
import { Button, pushToast } from "@/global/components";
import { ExportsKeys } from "@/global/i18n";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useConvex } from "convex/react";
import { Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { downloadBase64Xlsx } from "../lib/downloadBase64Xlsx";

interface ExportMenuButtonProps {
	readonly restaurantId: Id<"restaurants">;
}

export function ExportMenuButton({ restaurantId }: ExportMenuButtonProps) {
	const { t } = useTranslation();
	const convex = useConvex();
	const [isSubmitting, setIsSubmitting] = useState(false);

	const handleExport = async () => {
		setIsSubmitting(true);
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
			setIsSubmitting(false);
		}
	};

	return (
		<Button
			variant="secondary"
			size="md"
			leadingIcon={<Download size={14} />}
			onClick={handleExport}
			disabled={isSubmitting}
			loadingLabel={<span className="sr-only">{t(ExportsKeys.STATUS_PREPARING)}</span>}
			aria-label={t(ExportsKeys.BUTTON_ARIA)}
		>
			{t(ExportsKeys.BUTTON)}
		</Button>
	);
}
