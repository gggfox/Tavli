/**
 * Per-widget "Export CSV" control (TAVLI-2). Downloads the widget's
 * already-loaded rows client-side via `downloadCsv` — no backend round-trip.
 * Disabled when there is nothing to export.
 */
import { DashboardKeys } from "@/global/i18n";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { downloadCsv } from "../utils/csv";

interface WidgetExportButtonProps {
	filename: string;
	rows: ReadonlyArray<Record<string, unknown>>;
	disabled?: boolean;
}

export function WidgetExportButton({ filename, rows, disabled }: WidgetExportButtonProps) {
	const { t } = useTranslation();
	const label = t(DashboardKeys.WIDGET_EXPORT_CSV);
	return (
		<button
			type="button"
			onClick={() => downloadCsv(filename, rows)}
			disabled={disabled || rows.length === 0}
			aria-label={label}
			title={label}
			className="text-faint-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-faint-foreground"
		>
			<Download size={13} />
		</button>
	);
}
