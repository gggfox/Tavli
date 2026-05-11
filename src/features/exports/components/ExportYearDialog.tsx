/**
 * Year-picker dialog used by orders / payments / reservations dashboards.
 *
 * Rendered as a click-controlled component:
 *   <ExportYearDialog kind="orders" restaurantId={id} />
 *
 * The component owns the button trigger, the modal, year fetching, action
 * call, base64 → download, and toasts.
 */
import { Button, DialogHeader, Modal, pushToast } from "@/global/components";
import { ExportsKeys } from "@/global/i18n";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useConvex } from "convex/react";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useExportYears } from "../hooks/useExportYears";
import { downloadBase64Xlsx } from "../lib/downloadBase64Xlsx";

export type ExportYearDialogKind = "orders" | "payments" | "reservations";

interface ExportYearDialogProps {
	readonly restaurantId: Id<"restaurants">;
	readonly kind: ExportYearDialogKind;
}

const TITLE_KEY: Record<ExportYearDialogKind, string> = {
	orders: ExportsKeys.DIALOG_TITLE_ORDERS,
	payments: ExportsKeys.DIALOG_TITLE_PAYMENTS,
	reservations: ExportsKeys.DIALOG_TITLE_RESERVATIONS,
};

export function ExportYearDialog({ restaurantId, kind }: ExportYearDialogProps) {
	const { t, i18n } = useTranslation();
	const convex = useConvex();
	const [open, setOpen] = useState(false);
	const { years, currentYear, isLoading: yearsLoading } = useExportYears(restaurantId);
	const [selectedYear, setSelectedYear] = useState<number>(currentYear);
	const [isSubmitting, setIsSubmitting] = useState(false);

	useEffect(() => {
		if (!yearsLoading && years.length > 0) {
			setSelectedYear((prev) => (years.includes(prev) ? prev : years[0]));
		}
	}, [yearsLoading, years]);

	const handleExport = async () => {
		setIsSubmitting(true);
		try {
			let result: { base64: string; filename: string; mimeType: string };
			const args = { restaurantId, year: selectedYear, locale: i18n.language };
			if (kind === "orders") {
				result = await convex.action(api.exports.exportOrdersXlsx, args);
			} else if (kind === "payments") {
				result = await convex.action(api.exports.exportPaymentsXlsx, args);
			} else {
				result = await convex.action(api.exports.exportReservationsXlsx, args);
			}
			downloadBase64Xlsx(result.base64, result.filename, result.mimeType);
			pushToast({
				id: `export-${kind}-${Date.now()}`,
				kind: "success",
				title: t(ExportsKeys.STATUS_SUCCESS),
			});
			setOpen(false);
		} catch (e) {
			const message =
				e instanceof Error && /too large/i.test(e.message)
					? t(ExportsKeys.STATUS_TOO_LARGE)
					: t(ExportsKeys.STATUS_ERROR);
			pushToast({
				id: `export-${kind}-err-${Date.now()}`,
				kind: "error",
				title: message,
			});
		} finally {
			setIsSubmitting(false);
		}
	};

	const noYears = !yearsLoading && years.length === 0;

	return (
		<>
			<Button
				variant="secondary"
				size="md"
				leadingIcon={<Download size={14} />}
				onClick={() => setOpen(true)}
				aria-label={t(ExportsKeys.BUTTON_ARIA)}
			>
				{t(ExportsKeys.BUTTON)}
			</Button>
			<Modal
				isOpen={open}
				onClose={() => (isSubmitting ? null : setOpen(false))}
				size="sm"
				ariaLabel={t(TITLE_KEY[kind])}
			>
				<div className="flex flex-col">
					<DialogHeader
						title={t(TITLE_KEY[kind])}
						subtitle={t(ExportsKeys.DIALOG_DESCRIPTION)}
						onClose={() => setOpen(false)}
						closeAriaLabel={t(ExportsKeys.DIALOG_CANCEL)}
					/>
					<div className="px-6 py-4 flex flex-col gap-4">
						{noYears ? (
							<p className="text-sm text-muted-foreground">
								{t(ExportsKeys.NO_YEARS)}
							</p>
						) : (
							<label className="flex flex-col gap-1 text-sm">
								<span className="text-foreground">
									{t(ExportsKeys.DIALOG_YEAR_LABEL)}
								</span>
								<select
									className="rounded border border-border bg-background px-2 py-1 text-sm"
									value={selectedYear}
									onChange={(e) => setSelectedYear(Number(e.target.value))}
									disabled={yearsLoading || isSubmitting}
								>
									{years.map((y) => (
										<option key={y} value={y}>
											{y}
										</option>
									))}
								</select>
							</label>
						)}
					</div>
					<div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
						<Button
							variant="ghost"
							size="md"
							onClick={() => setOpen(false)}
							disabled={isSubmitting}
						>
							{t(ExportsKeys.DIALOG_CANCEL)}
						</Button>
						<Button
							variant="primary"
							size="md"
							onClick={handleExport}
							disabled={noYears || yearsLoading || isSubmitting}
							loadingLabel={t(ExportsKeys.STATUS_PREPARING)}
						>
							{t(ExportsKeys.DIALOG_CONFIRM)}
						</Button>
					</div>
				</div>
			</Modal>
		</>
	);
}
