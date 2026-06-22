/**
 * Export button for orders / payments / reservations dashboards.
 *
 * Two modes, picked from the year list returned by
 * `api.exports.getRestaurantExportYears`:
 *
 *   - **Single year** — clicking the button starts the download immediately,
 *     no menu opens. The button shows a Download icon only.
 *   - **Multiple years** — clicking the button toggles a popover anchored to
 *     it; clicking a year in the popover starts the download for that year.
 *     The button shows a trailing chevron so the menu affordance is visible.
 *
 * The button stays disabled while the year list is loading so we never have
 * to guess which mode applies.
 */
import { Button, pushToast } from "@/global/components";
import { useClickOutside, useEscapeKey } from "@/global/hooks";
import { ExportsKeys } from "@/global/i18n";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useConvex } from "convex/react";
import { ChevronDown, Download } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useExportYears } from "../hooks/useExportYears";
import { downloadBase64Xlsx } from "../lib/downloadBase64Xlsx";

export type ExportButtonKind = "orders" | "payments" | "reservations";

interface ExportButtonProps {
	readonly restaurantId: Id<"restaurants">;
	readonly kind: ExportButtonKind;
}

export function ExportButton({ restaurantId, kind }: ExportButtonProps) {
	const { t, i18n } = useTranslation();
	const convex = useConvex();
	const { years, isLoading: yearsLoading } = useExportYears(restaurantId);
	const [open, setOpen] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const listId = useId();
	const close = useCallback(() => setOpen(false), []);
	useClickOutside([triggerRef, panelRef], close, { enabled: open });
	useEscapeKey(close, { enabled: open });

	const hasMultipleYears = years.length > 1;
	const noYears = !yearsLoading && years.length === 0;
	const disabled = yearsLoading || isSubmitting || noYears;

	const runExport = async (year: number) => {
		setIsSubmitting(true);
		try {
			let result: { base64: string; filename: string; mimeType: string };
			const args = { restaurantId, year, locale: i18n.language };
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

	const handleTriggerClick = () => {
		if (disabled) return;
		if (hasMultipleYears) {
			setOpen((o) => !o);
			return;
		}
		if (years.length === 1) {
			void runExport(years[0]);
		}
	};

	const handlePickYear = (year: number) => {
		setOpen(false);
		void runExport(year);
	};

	return (
		<div className="relative inline-block">
			<Button
				ref={triggerRef}
				variant="secondary"
				size="md"
				leadingIcon={<Download size={14} />}
				trailingIcon={hasMultipleYears ? <ChevronDown size={14} /> : undefined}
				onClick={handleTriggerClick}
				disabled={disabled}
				loadingLabel={<span className="sr-only">{t(ExportsKeys.STATUS_PREPARING)}</span>}
				state={isSubmitting ? "loading" : undefined}
				aria-label={t(ExportsKeys.BUTTON_ARIA)}
				aria-haspopup={hasMultipleYears ? "listbox" : undefined}
				aria-expanded={hasMultipleYears ? open : undefined}
				aria-controls={hasMultipleYears && open ? listId : undefined}
			>
				{t(ExportsKeys.BUTTON)}
			</Button>
			{open && hasMultipleYears ? (
				<div
					ref={panelRef}
					id={listId}
					role="listbox"
					aria-label={t(ExportsKeys.BUTTON_ARIA)}
					className="absolute right-0 mt-1 z-50 min-w-32 overflow-hidden rounded-md border border-border bg-card py-1 shadow-md"
				>
					{years.map((year) => (
						<button
							key={year}
							type="button"
							role="option"
							aria-selected={false}
							disabled={isSubmitting}
							onClick={() => handlePickYear(year)}
							className="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-sm hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{year}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
