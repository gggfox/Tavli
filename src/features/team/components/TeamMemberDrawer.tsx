/**
 * `TeamMemberDrawer` — informational side panel opened by clicking a row in
 * the team directory table. Shows identity info, management actions (for
 * employee accounts: reset PIN, upload photo, remove), a Rendimiento section,
 * and a Propinas section, all driven by a shared range toggle.
 *
 * Owner rows render with owner-specific empty states; pending invite rows
 * are filtered out by the parent and never open the drawer.
 */
import type { TeamDirectoryRow } from "@/features/team/teamDirectoryColumns";
import { DialogHeader, Drawer } from "@/global/components";
import { useIsNarrowViewport } from "@/global/hooks";
import { AdminStaffKeys } from "@/global/i18n";
import { getMondayYmdOfWeek, startOfDayMs, utcMsToYmdInTimezone } from "@/global/utils/timezone";
import { unwrapResult } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { TIP_POOL_STATUS } from "convex/constants";
import { uploadImage } from "@/features/menus/utils/imageUtils";
import type { TFunction } from "i18next";
import { Camera } from "lucide-react";
import { useMemo, useRef, useState } from "react";
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
	const parts = [row.firstName, row.paternalLastname, row.maternalLastname].filter(Boolean);
	if (parts.length > 0) return parts.join(" ");
	const trimmed = row.email?.trim();
	if (trimmed) return trimmed;
	if ("userId" in row && row.userId) return row.userId;
	return "";
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
	if (status === TIP_POOL_STATUS.FINALIZED)
		return t(AdminStaffKeys.TEAM_DRAWER_TIPS_POOL_STATUS_FINALIZED);
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
	const isEmployeeAccount = row?.rowType === "member" && row.kind === "employeeAccount";

	const resetPinMutation = useMutation({
		mutationFn: useConvexMutation(api.employeeAccounts.resetEmployeePin),
	});
	const removeMemberMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurantMembers.removeMember),
	});
	const updateEmployeeAccountMutation = useConvexMutation(
		api.employeeAccounts.updateEmployeeAccount
	);
	const generateEaUploadUrlMutation = useConvexMutation(
		api.employeeAccounts.getEmployeePhotoUploadUrl
	);
	const generateUserUploadUrlMutation = useConvexMutation(
		api.userSettings.generateUserPhotoUploadUrl
	);
	const setUserPhotoMutation = useConvexMutation(api.userSettings.setUserPhoto);
	const [resetPinResult, setResetPinResult] = useState<string | null>(null);
	const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
	const photoInputRef = useRef<HTMLInputElement>(null);
	const isClerkBacked =
		row != null &&
		((row.rowType === "member" && row.kind === "user") ||
			row.rowType === "restaurantOwner" ||
			row.rowType === "orgOwner");
	const canEditPhoto =
		row != null &&
		((isEmployeeAccount && row.rowType === "member" && row.removedAt == null) || isClerkBacked);

	const bounds = useMemo<RangeBounds | null>(() => {
		if (!row) return null;
		return computeRangeBounds(Date.now(), restaurantTimezone, range);
	}, [row, restaurantTimezone, range]);

	const perfArgs =
		bounds && restaurantId && !isOwner
			? { restaurantId, fromMs: bounds.fromMs, toMs: bounds.toMs }
			: "skip";

	type PerfData = {
		rows: Array<{
			memberId: string;
			paidOrders: number;
			attributedRevenue: number;
			hoursWorked: number;
		}>;
	};
	const { data: perf } = useQuery({
		...convexQuery(api.performance.getRestaurantPerformance, perfArgs),
		select: unwrapResult<PerfData>,
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
		select: unwrapResult<{ totalCents: number; perDay: Array<PerDayShare> }>,
	});

	const memberPerfRow = useMemo(() => {
		if (!perf || !memberId) return null;
		return perf.rows.find((r) => r.memberId === String(memberId)) ?? null;
	}, [perf, memberId]);

	const headerTitle = row ? rowDisplayLabel(row) : "";
	const headerSubtitle = row ? computeSubtitle(row, t, staffRoleLabel) : "";

	const handleResetPin = async () => {
		const eaId = row?.rowType === "member" ? row.employeeAccountId : null;
		if (!isEmployeeAccount || !eaId) return;
		if (!confirm(t(AdminStaffKeys.TEAM_DRAWER_RESET_PIN_CONFIRM))) return;
		const result = unwrapResult<{ pin: string }>(
			await resetPinMutation.mutateAsync({ employeeAccountId: eaId })
		);
		setResetPinResult(result.pin);
	};

	const handleRemove = async () => {
		if (!memberId) return;
		if (!confirm(t(AdminStaffKeys.TEAM_DRAWER_REMOVE_CONFIRM))) return;
		unwrapResult(await removeMemberMutation.mutateAsync({ memberId }));
		onClose();
	};

	const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file || !row) return;
		setIsUploadingPhoto(true);
		try {
			if (row.rowType === "member" && row.kind === "employeeAccount" && row.employeeAccountId) {
				const generateUploadUrl = () =>
					generateEaUploadUrlMutation({}) as Promise<[string, null] | [null, Error]>;
				const storageId = await uploadImage(generateUploadUrl, file);
				unwrapResult(
					await updateEmployeeAccountMutation({
						employeeAccountId: row.employeeAccountId,
						photoStorageId: storageId,
					})
				);
			} else {
				const uid = "userId" in row ? row.userId : null;
				if (!uid) return;
				const generateUploadUrl = async (): Promise<[string, null] | [null, Error]> => [
					await generateUserUploadUrlMutation({}),
					null,
				];
				const storageId = await uploadImage(generateUploadUrl, file);
				await setUserPhotoMutation({ photoStorageId: storageId, targetUserId: uid });
			}
		} finally {
			setIsUploadingPhoto(false);
			if (photoInputRef.current) photoInputRef.current.value = "";
		}
	};

	const handleCloseDrawer = () => {
		setResetPinResult(null);
		onClose();
	};

	return (
		<Drawer
			isOpen={isOpen}
			onClose={handleCloseDrawer}
			ariaLabel={headerTitle || t(AdminStaffKeys.TEAM_DRAWER_PERFORMANCE_TITLE)}
			side={isNarrow ? "bottom" : "right"}
			size={isNarrow ? "92dvh" : "min(520px, 90vw)"}
			swipeToClose={isNarrow}
			swipeHandleAriaLabel={t(AdminStaffKeys.TEAM_DRAWER_SWIPE_HANDLE)}
			panelClassName="bg-background border border-border overflow-hidden"
		>
			<DialogHeader title={headerTitle} subtitle={headerSubtitle} onClose={handleCloseDrawer} />

			<div className="flex-1 min-h-0 overflow-y-auto">
				{/* Avatar + identity info */}
				{row && (
					<div className="px-5 pt-4 flex items-start gap-3">
						<div className="relative shrink-0">
							{row.photoUrl ? (
								<img src={row.photoUrl} alt="" className="w-12 h-12 rounded-full object-cover" />
							) : (
								<span className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-lg font-medium text-muted-foreground">
									{(row.firstName?.charAt(0) ?? "") + (row.paternalLastname?.charAt(0) ?? "")}
								</span>
							)}
							{canEditPhoto && (
								<>
									<input
										ref={photoInputRef}
										type="file"
										accept="image/*"
										className="hidden"
										onChange={(e) => void handlePhotoChange(e)}
									/>
									<button
										type="button"
										onClick={() => photoInputRef.current?.click()}
										disabled={isUploadingPhoto}
										className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 disabled:opacity-50"
										aria-label={t(AdminStaffKeys.TEAM_DRAWER_CHANGE_PHOTO)}
									>
										<Camera className="w-3 h-3" />
									</button>
								</>
							)}
						</div>
						<div className="min-w-0 flex-1 space-y-1">
							{row.email && (
								<div className="text-xs text-muted-foreground">
									<span className="font-medium">{t(AdminStaffKeys.TEAM_DRAWER_EMAIL_LABEL)}:</span>{" "}
									{row.email}
								</div>
							)}
							{row.addedByEmail && (
								<div className="text-xs text-muted-foreground">
									<span className="font-medium">
										{t(AdminStaffKeys.TEAM_DRAWER_ADDED_BY_LABEL)}:
									</span>{" "}
									{row.addedByEmail}
								</div>
							)}
						</div>
					</div>
				)}

				{/* Management actions for employee accounts */}
				{isEmployeeAccount && row?.rowType === "member" && row.removedAt == null && (
					<div className="px-5 pt-3 flex flex-wrap gap-2">
						<button
							type="button"
							onClick={() => void handleResetPin()}
							disabled={resetPinMutation.isPending}
							className="text-xs font-medium px-2.5 py-1 rounded border border-border text-foreground hover:bg-muted disabled:opacity-50"
						>
							{t(AdminStaffKeys.TEAM_DRAWER_RESET_PIN)}
						</button>
						<button
							type="button"
							onClick={() => void handleRemove()}
							disabled={removeMemberMutation.isPending}
							className="text-xs font-medium px-2.5 py-1 rounded border border-destructive text-destructive hover:bg-destructive/10 disabled:opacity-50"
						>
							{t(AdminStaffKeys.TEAM_DRAWER_REMOVE)}
						</button>
					</div>
				)}

				{/* Reset PIN result */}
				{resetPinResult && (
					<div className="mx-5 mt-3 p-3 rounded-lg bg-muted border border-border space-y-2">
						<p className="text-xs font-semibold text-foreground">
							{t(AdminStaffKeys.TEAM_EMPLOYEE_PIN_TITLE)}
						</p>
						<p className="text-2xl font-mono font-bold tracking-[0.3em] text-foreground text-center">
							{resetPinResult}
						</p>
						<p className="text-xs text-destructive text-center">
							{t(AdminStaffKeys.TEAM_EMPLOYEE_PIN_WARNING)}
						</p>
					</div>
				)}

				{/* Non-removed member actions for Clerk-backed */}
				{!isEmployeeAccount && row?.rowType === "member" && row.removedAt == null && (
					<div className="px-5 pt-3 flex flex-wrap gap-2">
						<button
							type="button"
							onClick={() => void handleRemove()}
							disabled={removeMemberMutation.isPending}
							className="text-xs font-medium px-2.5 py-1 rounded border border-destructive text-destructive hover:bg-destructive/10 disabled:opacity-50"
						>
							{t(AdminStaffKeys.TEAM_DRAWER_REMOVE)}
						</button>
					</div>
				)}

				<div className="px-5 pt-4">
					<RangeToggle value={range} onChange={setRange} />
				</div>

				<PerformanceSection isOwner={isOwner} row={memberPerfRow} currency={restaurantCurrency} />

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
			<TipsBody isOwner={isOwner} totalCents={totalCents} perDay={perDay} currency={currency} />
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
			<p className="text-sm text-faint-foreground">{t(AdminStaffKeys.TEAM_DRAWER_TIPS_EMPTY)}</p>
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
					<li key={d.businessDate} className="flex items-center justify-between px-3 py-2 gap-2">
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
			<div className="text-base font-semibold text-foreground tabular-nums truncate">{value}</div>
		</div>
	);
}

export type { TeamMemberDrawerRow };
