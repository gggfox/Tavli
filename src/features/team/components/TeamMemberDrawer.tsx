/**
 * `TeamMemberDrawer` — informational side panel opened by clicking a row in
 * the team directory table. Shows a Rendimiento section (paid orders,
 * attributed revenue, hours worked) and a Propinas section (tip-pool share
 * total + per-day breakdown) for the selected member, both driven by a
 * shared Today / This week / This month range toggle.
 *
 * Owner rows (`restaurantOwner`/`orgOwner`) render the drawer with
 * owner-specific empty states; pending invite rows are filtered out by the
 * parent and never open the drawer.
 */
import type { TeamDirectoryRow } from "@/features/team/teamDirectoryColumns";
import { DialogHeader, Drawer } from "@/global/components";
import { useIsNarrowViewport } from "@/global/hooks";
import { AdminStaffKeys } from "@/global/i18n";
import { getMondayYmdOfWeek, startOfDayMs, utcMsToYmdInTimezone } from "@/features/schedule/timezone";
import { unwrapResult } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { TIP_POOL_STATUS } from "convex/constants";
import type { TFunction } from "i18next";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type TeamMemberDrawerRow = Exclude<TeamDirectoryRow, { rowType: "invite" }>;

interface TeamMemberDrawerProps {
	readonly isOpen: boolean;
	readonly row: TeamMemberDrawerRow | null;
	readonly restaurantId: Id<"restaurants"> | null;
	readonly restaurantTimezone: string;
	readonly restaurantCurrency: string;
	readonly staffRoleLabel: (role: string) => string;
	readonly onClose: () => void;
}

type RangeKey = "today" | "week" | "month";

interface RangeBounds {
	readonly fromYmd: string;
	readonly toYmd: string;
	readonly fromMs: number;
	readonly toMs: number;
}

function computeRangeBounds(now: number, timezone: string, range: RangeKey): RangeBounds {
	const toYmd = utcMsToYmdInTimezone(now, timezone);
	let fromYmd = toYmd;
	if (range === "week") {
		fromYmd = getMondayYmdOfWeek(now, timezone);
	} else if (range === "month") {
		fromYmd = `${toYmd.slice(0, 7)}-01`;
	}
	return { fromYmd, toYmd, fromMs: startOfDayMs(fromYmd, timezone), toMs: now };
}

function rowMemberId(row: TeamMemberDrawerRow): Id<"restaurantMembers"> | null {
	return row.rowType === "member" ? row._id : null;
}

function rowDisplayLabel(row: TeamMemberDrawerRow): string {
	const trimmed = row.email?.trim();
	if (trimmed) return trimmed;
	return row.userId;
}

function isOwnerRowType(row: TeamMemberDrawerRow): boolean {
	return row.rowType === "restaurantOwner" || row.rowType === "orgOwner";
}

function computeSubtitle(
	row: TeamMemberDrawerRow,
	t: TFunction,
	staffRoleLabel: (role: string) => string
): string {
	if (isOwnerRowType(row)) return t(AdminStaffKeys.TEAM_DRAWER_SUBTITLE_OWNER);
	return staffRoleLabel(row.role);
}

function poolStatusLabel(status: string, t: TFunction): string {
	if (status === TIP_POOL_STATUS.FINALIZED) return t(AdminStaffKeys.TEAM_DRAWER_TIPS_POOL_STATUS_FINALIZED);
	if (status === TIP_POOL_STATUS.PAID) return t(AdminStaffKeys.TEAM_DRAWER_TIPS_POOL_STATUS_PAID);
	if (status === TIP_POOL_STATUS.OPEN) return t(AdminStaffKeys.TEAM_DRAWER_TIPS_POOL_STATUS_OPEN);
	return status;
}

function fmtMoney(cents: number): string {
	return (cents / 100).toFixed(2);
}

export function TeamMemberDrawer({
	isOpen,
	row,
	restaurantId,
	restaurantTimezone,
	restaurantCurrency,
	staffRoleLabel,
	onClose,
}: Readonly<TeamMemberDrawerProps>) {
	const { t } = useTranslation();
	const isNarrow = useIsNarrowViewport();
	const [range, setRange] = useState<RangeKey>("today");

	const memberId = row ? rowMemberId(row) : null;
	const isOwner = row ? isOwnerRowType(row) : false;

	const bounds = useMemo<RangeBounds | null>(() => {
		if (!row) return null;
		return computeRangeBounds(Date.now(), restaurantTimezone, range);
		// We intentionally pin to Date.now() at render time so the displayed
		// window snaps to the current moment when the user changes range or
		// reopens the drawer, instead of ticking once per second.
	}, [row, restaurantTimezone, range]);

	const perfArgs =
		bounds && restaurantId && !isOwner
			? { restaurantId, fromMs: bounds.fromMs, toMs: bounds.toMs }
			: "skip";

	const { data: perf } = useQuery({
		...convexQuery(api.performance.getRestaurantPerformance, perfArgs),
		select: unwrapResult,
	});

	const tipsArgs =
		bounds && restaurantId && memberId && !isOwner
			? {
					restaurantId,
					memberId,
					fromBusinessDate: bounds.fromYmd,
					toBusinessDate: bounds.toYmd,
				}
			: "skip";

	const { data: tips } = useQuery({
		...convexQuery(api.tips.getTipSharesForMemberRange, tipsArgs),
		select: unwrapResult,
	});

	const memberPerfRow = useMemo(() => {
		if (!perf || !memberId) return null;
		return perf.rows.find((r) => r.memberId === String(memberId)) ?? null;
	}, [perf, memberId]);

	const headerTitle = row ? rowDisplayLabel(row) : "";
	const headerSubtitle = row ? computeSubtitle(row, t, staffRoleLabel) : "";

	return (
		<Drawer
			isOpen={isOpen}
			onClose={onClose}
			ariaLabel={headerTitle || t(AdminStaffKeys.TEAM_DRAWER_PERFORMANCE_TITLE)}
			side={isNarrow ? "bottom" : "right"}
			size={isNarrow ? "92dvh" : "min(520px, 90vw)"}
			swipeToClose={isNarrow}
			swipeHandleAriaLabel={t(AdminStaffKeys.TEAM_DRAWER_SWIPE_HANDLE)}
			panelClassName="bg-background border border-border overflow-hidden"
		>
			<DialogHeader title={headerTitle} subtitle={headerSubtitle} onClose={onClose} />

			<div className="flex-1 min-h-0 overflow-y-auto">
				<div className="px-5 pt-4">
					<RangeToggle value={range} onChange={setRange} />
				</div>

				<PerformanceSection
					isOwner={isOwner}
					row={memberPerfRow}
					currency={restaurantCurrency}
				/>

				<TipsSection
					isOwner={isOwner}
					totalCents={tips?.totalCents ?? 0}
					perDay={tips?.perDay ?? []}
					currency={restaurantCurrency}
				/>
			</div>
		</Drawer>
	);
}

interface PerformanceSectionProps {
	readonly isOwner: boolean;
	readonly row: {
		paidOrders: number;
		attributedRevenue: number;
		hoursWorked: number;
	} | null;
	readonly currency: string;
}

function PerformanceSection({ isOwner, row, currency }: Readonly<PerformanceSectionProps>) {
	const { t } = useTranslation();
	return (
		<section className="px-5 py-4 border-t border-border mt-4">
			<h3 className="text-sm font-semibold text-foreground mb-3">
				{t(AdminStaffKeys.TEAM_DRAWER_PERFORMANCE_TITLE)}
			</h3>
			<PerformanceBody isOwner={isOwner} row={row} currency={currency} />
		</section>
	);
}

function PerformanceBody({ isOwner, row, currency }: Readonly<PerformanceSectionProps>) {
	const { t } = useTranslation();
	if (isOwner) {
		return (
			<p className="text-sm text-faint-foreground">
				{t(AdminStaffKeys.TEAM_DRAWER_PERFORMANCE_EMPTY_OWNER)}
			</p>
		);
	}
	if (!row) {
		return (
			<p className="text-sm text-faint-foreground">
				{t(AdminStaffKeys.TEAM_DRAWER_PERFORMANCE_EMPTY)}
			</p>
		);
	}
	return (
		<div className="grid grid-cols-3 gap-3">
			<KpiCard
				label={t(AdminStaffKeys.TEAM_DRAWER_PERFORMANCE_PAID_ORDERS)}
				value={String(row.paidOrders)}
			/>
			<KpiCard
				label={t(AdminStaffKeys.TEAM_DRAWER_PERFORMANCE_REVENUE)}
				value={`${row.attributedRevenue.toFixed(2)} ${currency}`}
			/>
			<KpiCard
				label={t(AdminStaffKeys.TEAM_DRAWER_PERFORMANCE_HOURS)}
				value={row.hoursWorked.toFixed(2)}
			/>
		</div>
	);
}

interface PerDayShare {
	readonly businessDate: string;
	readonly amountCents: number;
	readonly sharePercent: number;
	readonly poolStatus: string;
}

interface TipsSectionProps {
	readonly isOwner: boolean;
	readonly totalCents: number;
	readonly perDay: ReadonlyArray<PerDayShare>;
	readonly currency: string;
}

function TipsSection({ isOwner, totalCents, perDay, currency }: Readonly<TipsSectionProps>) {
	const { t } = useTranslation();
	return (
		<section className="px-5 py-4 border-t border-border">
			<h3 className="text-sm font-semibold text-foreground mb-3">
				{t(AdminStaffKeys.TEAM_DRAWER_TIPS_TITLE)}
			</h3>
			<TipsBody
				isOwner={isOwner}
				totalCents={totalCents}
				perDay={perDay}
				currency={currency}
			/>
		</section>
	);
}

function TipsBody({ isOwner, totalCents, perDay, currency }: Readonly<TipsSectionProps>) {
	const { t } = useTranslation();
	if (isOwner) {
		return (
			<p className="text-sm text-faint-foreground">
				{t(AdminStaffKeys.TEAM_DRAWER_TIPS_EMPTY_OWNER)}
			</p>
		);
	}
	if (perDay.length === 0) {
		return (
			<p className="text-sm text-faint-foreground">
				{t(AdminStaffKeys.TEAM_DRAWER_TIPS_EMPTY)}
			</p>
		);
	}
	return (
		<>
			<div className="flex items-baseline justify-between mb-3">
				<span className="text-xs text-faint-foreground">
					{t(AdminStaffKeys.TEAM_DRAWER_TIPS_TOTAL)}
				</span>
				<span className="text-base font-semibold text-foreground">
					{fmtMoney(totalCents)} {currency}
				</span>
			</div>
			<div className="text-xs text-faint-foreground mb-2">
				{t(AdminStaffKeys.TEAM_DRAWER_TIPS_PER_DAY)}
			</div>
			<ul className="text-sm divide-y divide-border rounded border border-border">
				{perDay.map((d) => (
					<li
						key={d.businessDate}
						className="flex items-center justify-between px-3 py-2 gap-2"
					>
						<div className="flex flex-col min-w-0">
							<span className="text-sm text-foreground">{d.businessDate}</span>
							<span className="text-xs text-faint-foreground">
								{poolStatusLabel(d.poolStatus, t)} · {(d.sharePercent * 100).toFixed(1)}%
							</span>
						</div>
						<span className="text-sm font-medium text-foreground tabular-nums shrink-0">
							{fmtMoney(d.amountCents)} {currency}
						</span>
					</li>
				))}
			</ul>
		</>
	);
}

interface RangeToggleProps {
	readonly value: RangeKey;
	readonly onChange: (next: RangeKey) => void;
}

const RANGE_OPTIONS: ReadonlyArray<{ key: RangeKey; labelKey: string }> = [
	{ key: "today", labelKey: AdminStaffKeys.TEAM_DRAWER_RANGE_TODAY },
	{ key: "week", labelKey: AdminStaffKeys.TEAM_DRAWER_RANGE_WEEK },
	{ key: "month", labelKey: AdminStaffKeys.TEAM_DRAWER_RANGE_MONTH },
];

function RangeToggle({ value, onChange }: Readonly<RangeToggleProps>) {
	const { t } = useTranslation();
	return (
		<div className="inline-flex rounded-md border border-border bg-muted p-0.5 text-xs">
			{RANGE_OPTIONS.map((opt) => {
				const active = opt.key === value;
				const className = active
					? "px-3 py-1 rounded-sm bg-background text-foreground font-medium"
					: "px-3 py-1 rounded-sm text-muted-foreground hover:text-foreground";
				return (
					<button
						key={opt.key}
						type="button"
						onClick={() => onChange(opt.key)}
						className={className}
						aria-pressed={active}
					>
						{t(opt.labelKey)}
					</button>
				);
			})}
		</div>
	);
}

interface KpiCardProps {
	readonly label: string;
	readonly value: string;
}

function KpiCard({ label, value }: Readonly<KpiCardProps>) {
	return (
		<div className="rounded border border-border bg-muted/40 px-3 py-2 min-w-0">
			<div className="text-[10px] uppercase tracking-wide text-faint-foreground truncate">
				{label}
			</div>
			<div className="text-base font-semibold text-foreground tabular-nums truncate">
				{value}
			</div>
		</div>
	);
}

export type { TeamMemberDrawerRow };
