import { DialogHeader, Drawer } from "@/global/components";
import {
	ReservationSettingsPanel,
	ReservationsDashboard,
	ReservationsDashboardSkeleton,
	TableLocksManager,
} from "@/features/reservations";
import { useRestaurant } from "@/features/restaurants";
import type { ReservationStatus } from "@/features/reservations/statusConfig";
import { RESERVATION_STATUS_CONFIG } from "@/features/reservations/statusConfig";
import { ORDERED_RANGES, type ReservationRange } from "@/features/reservations/utils";
import { isValidYmd } from "@/global/utils/calendarMonth";
import { ReservationsKeys } from "@/global/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { Lock, Settings } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const STATUS_SET = new Set(RESERVATION_STATUS_CONFIG.map((s) => s.value)) as ReadonlySet<ReservationStatus>;

function validateReservationsSearch(search: Record<string, unknown>) {
	const focus = typeof search.focus === "string" ? search.focus : undefined;
	const range =
		typeof search.range === "string" && ORDERED_RANGES.includes(search.range as ReservationRange)
			? (search.range as ReservationRange)
			: undefined;
	const dayRaw = typeof search.day === "string" ? search.day : undefined;
	const day = dayRaw && isValidYmd(dayRaw) ? dayRaw : undefined;
	const view = search.view === "cards" || search.view === "table" ? search.view : undefined;
	let status: string | undefined;
	if (typeof search.status === "string" && search.status.trim()) {
		const parts = search.status.split(",").map((s) => s.trim()).filter(Boolean);
		const ok = parts.filter((p): p is ReservationStatus =>
			STATUS_SET.has(p as ReservationStatus)
		);
		status = ok.length ? [...new Set(ok)].sort((a, b) => a.localeCompare(b)).join(",") : undefined;
	}
	return { focus, range, day, view, status };
}

export const Route = createFileRoute("/admin/reservations/")({
	component: ReservationsPage,
	validateSearch: validateReservationsSearch,
});

function ReservationsPage() {
	const { t } = useTranslation();
	const { restaurant, isLoading } = useRestaurant();
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [isLocksOpen, setIsLocksOpen] = useState(false);

	const triggerStyle = {
		border: "1px solid var(--border-default)",
		color: "var(--text-secondary)",
	} as const;

	return (
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6 flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold text-foreground" >
						{t(ReservationsKeys.PAGE_TITLE)}
					</h1>
					<p className="mt-2 text-sm text-muted-foreground" >
						{t(ReservationsKeys.PAGE_DESCRIPTION)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setIsLocksOpen(true)}
						className="flex items-center gap-1 text-sm px-3 py-2 rounded-md"
						style={triggerStyle}
					>
						<Lock size={14} /> {t(ReservationsKeys.PAGE_LOCKS_BUTTON)}
					</button>
					<button
						type="button"
						onClick={() => setIsSettingsOpen(true)}
						className="flex items-center gap-1 text-sm px-3 py-2 rounded-md"
						style={triggerStyle}
					>
						<Settings size={14} /> {t(ReservationsKeys.PAGE_SETTINGS_BUTTON)}
					</button>
				</div>
			</div>
			<div className="flex-1 overflow-y-auto">
				<ReservationsContent hasRestaurant={Boolean(restaurant?._id)} isLoading={isLoading} />
			</div>

			<Drawer
				isOpen={isSettingsOpen}
				onClose={() => setIsSettingsOpen(false)}
				ariaLabel={t(ReservationsKeys.SETTINGS_DRAWER_ARIA)}
			>
				<DialogHeader
					title={t(ReservationsKeys.SETTINGS_DRAWER_TITLE)}
					subtitle={t(ReservationsKeys.SETTINGS_DRAWER_DESCRIPTION)}
					onClose={() => setIsSettingsOpen(false)}
					closeAriaLabel={t(ReservationsKeys.ARIA_DETAIL_DRAWER_CLOSE)}
				/>
				<div className="flex-1 overflow-y-auto px-6 py-4">
					{restaurant ? (
						<ReservationSettingsPanel restaurantId={restaurant._id} />
					) : (
						<p className="text-sm text-faint-foreground" >
							Please set up your restaurant first.
						</p>
					)}
				</div>
			</Drawer>

			<Drawer
				isOpen={isLocksOpen}
				onClose={() => setIsLocksOpen(false)}
				ariaLabel={t(ReservationsKeys.LOCKS_DRAWER_ARIA)}
			>
				<DialogHeader
					title={t(ReservationsKeys.LOCKS_DRAWER_TITLE)}
					subtitle={t(ReservationsKeys.LOCKS_DRAWER_DESCRIPTION)}
					onClose={() => setIsLocksOpen(false)}
					closeAriaLabel={t(ReservationsKeys.ARIA_DETAIL_DRAWER_CLOSE)}
				/>
				<div className="flex-1 overflow-y-auto px-6 py-4">
					{restaurant ? (
						<TableLocksManager restaurantId={restaurant._id} />
					) : (
						<p className="text-sm text-faint-foreground" >
							Please set up your restaurant first.
						</p>
					)}
				</div>
			</Drawer>
		</div>
	);
}

function ReservationsContent({
	hasRestaurant,
	isLoading,
}: Readonly<{ hasRestaurant: boolean; isLoading: boolean }>) {
	if (isLoading) return <ReservationsDashboardSkeleton />;
	if (!hasRestaurant) {
		return (
			<p className="text-sm text-faint-foreground" >
				Please set up your restaurant first.
			</p>
		);
	}
	return <ReservationsDashboard />;
}
