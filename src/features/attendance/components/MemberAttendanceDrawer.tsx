/**
 * Per-member attendance drawer opened from the Schedule grid (manager view
 * can click any row; employee view can click their own single row).
 *
 * Sections rendered are scoped to the viewer's relationship with the target
 * member:
 *   - `canViewAsManager` → A `PendingApprovalBanner` (only when there is at
 *     least one pending absence for this member) with per-row + bulk
 *     Approve/Deny buttons backed by `api.attendance.decideAbsence`, then the
 *     read-only Clock events + Absences history tables. `correctClockEvent`
 *     remains backend-only.
 *   - `isSelf` → My absences + "Request time off" form, backed by the
 *     existing `requestAbsence` mutation.
 *
 * Manager-on-own-row sees both groups stacked. Time window defaults to the
 * currently-viewed grid week and can be expanded to a rolling 7/30-day window
 * via the in-drawer range selector. The banner ignores the range selector —
 * pending requests are always actionable regardless of which window the
 * manager is browsing in the history tables.
 */
import {
	AppDatePicker,
	DialogHeader,
	Drawer,
} from "@/global/components";
import { useIsNarrowViewport } from "@/global/hooks";
import { AdminStaffKeys } from "@/global/i18n";
import { todayLocalYmd } from "@/global/utils/calendarMonth";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import {
	ABSENCE_REQUEST_STATUS,
	ABSENCE_TYPE,
	type AbsenceType,
} from "convex/constants";
import type { TFunction } from "i18next";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const SELF_SERVICE_ABSENCE_TYPES = [
	ABSENCE_TYPE.VACATION,
	ABSENCE_TYPE.SICK,
	ABSENCE_TYPE.OTHER,
] as const satisfies readonly AbsenceType[];

type SelfServiceAbsenceType = (typeof SELF_SERVICE_ABSENCE_TYPES)[number];

type RangeMode = "week" | "7d" | "30d";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface MemberAttendanceDrawerProps {
	readonly isOpen: boolean;
	readonly onClose: () => void;
	readonly restaurantId: Id<"restaurants">;
	readonly memberId: Id<"restaurantMembers">;
	readonly memberLabel: string;
	readonly isSelf: boolean;
	readonly canViewAsManager: boolean;
	readonly weekStartMs: number;
	readonly weekEndMs: number;
	readonly localeTag: string;
}

function absenceTypeLabel(type: string, t: TFunction): string {
	if (type === ABSENCE_TYPE.VACATION) return t(AdminStaffKeys.ATTENDANCE_TYPE_VACATION);
	if (type === ABSENCE_TYPE.SICK) return t(AdminStaffKeys.ATTENDANCE_TYPE_SICK);
	if (type === ABSENCE_TYPE.OTHER) return t(AdminStaffKeys.ATTENDANCE_TYPE_OTHER);
	return type;
}

function absenceStatusLabel(status: string, t: TFunction): string {
	if (status === ABSENCE_REQUEST_STATUS.PENDING) return t(AdminStaffKeys.ATTENDANCE_STATUS_PENDING);
	if (status === ABSENCE_REQUEST_STATUS.APPROVED) return t(AdminStaffKeys.ATTENDANCE_STATUS_APPROVED);
	if (status === ABSENCE_REQUEST_STATUS.DENIED) return t(AdminStaffKeys.ATTENDANCE_STATUS_DENIED);
	return status;
}

export function MemberAttendanceDrawer({
	isOpen,
	onClose,
	restaurantId,
	memberId,
	memberLabel,
	isSelf,
	canViewAsManager,
	weekStartMs,
	weekEndMs,
	localeTag,
}: Readonly<MemberAttendanceDrawerProps>) {
	const { t } = useTranslation();
	const isNarrowViewport = useIsNarrowViewport();

	const [rangeMode, setRangeMode] = useState<RangeMode>("week");

	useEffect(() => {
		if (isOpen) setRangeMode("week");
	}, [isOpen, memberId]);

	const { fromMs, toMs } = useMemo(() => {
		if (rangeMode === "week") return { fromMs: weekStartMs, toMs: weekEndMs };
		const days = rangeMode === "7d" ? 7 : 30;
		const end = Date.now();
		return { fromMs: end - days * MS_PER_DAY, toMs: end };
	}, [rangeMode, weekStartMs, weekEndMs]);

	const enableManagerQueries = isOpen && canViewAsManager;

	const { data: allEvents } = useQuery({
		...convexQuery(
			api.attendance.listClockEventsForRestaurant,
			enableManagerQueries ? { restaurantId, fromMs, toMs } : "skip"
		),
		select: unwrapResult<Doc<"clockEvents">[]>,
	});

	const { data: allAbsences, refetch: refetchAllAbsences } = useQuery({
		...convexQuery(
			api.attendance.listAbsencesForRestaurant,
			enableManagerQueries ? { restaurantId } : "skip"
		),
		select: unwrapResult<Doc<"absences">[]>,
	});

	const { data: myAbsences, refetch: refetchMyAbsences } = useQuery({
		...convexQuery(
			api.attendance.listMyAbsencesForRestaurant,
			isOpen && isSelf ? { restaurantId, limit: 60 } : "skip"
		),
		select: unwrapResult<Doc<"absences">[]>,
	});

	const memberEvents = useMemo(() => {
		if (!allEvents) return [];
		return allEvents
			.filter((e) => e.memberId === memberId)
			.slice()
			.sort((a, b) => b.at - a.at);
	}, [allEvents, memberId]);

	const memberAbsences = useMemo(() => {
		if (!allAbsences) return [];
		return allAbsences
			.filter((a) => a.memberId === memberId)
			.slice()
			.sort((a, b) => (a.date < b.date ? 1 : -1));
	}, [allAbsences, memberId]);

	const subtitle = isSelf
		? t(AdminStaffKeys.ATTENDANCE_DRAWER_SUBTITLE_SELF)
		: memberLabel;

	return (
		<Drawer
			isOpen={isOpen}
			onClose={onClose}
			ariaLabel={t(AdminStaffKeys.ATTENDANCE_DRAWER_TITLE)}
			side={isNarrowViewport ? "bottom" : "right"}
			size={isNarrowViewport ? "90dvh" : "48%"}
			swipeToClose={isNarrowViewport}
			swipeHandleAriaLabel={t(AdminStaffKeys.ATTENDANCE_REQUEST_DRAWER_SWIPE_HANDLE)}
			panelClassName="bg-background border border-border overflow-hidden"
		>
			<DialogHeader
				title={t(AdminStaffKeys.ATTENDANCE_DRAWER_TITLE)}
				subtitle={subtitle}
				onClose={onClose}
			/>
			<div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-6">
				{canViewAsManager ? (
					<>
						<PendingApprovalBanner
							absences={memberAbsences}
							onDecided={() => {
								refetchAllAbsences();
								if (isSelf) refetchMyAbsences();
							}}
						/>
						<ManagerSections
							rangeMode={rangeMode}
							onRangeChange={setRangeMode}
							memberEvents={memberEvents}
							memberAbsences={memberAbsences}
							localeTag={localeTag}
						/>
					</>
				) : null}

				{isSelf ? (
					<SelfSection
						restaurantId={restaurantId}
						myAbsences={myAbsences ?? null}
						isOpen={isOpen}
						onRequested={() => {
							refetchMyAbsences();
							if (canViewAsManager) refetchAllAbsences();
						}}
					/>
				) : null}
			</div>
		</Drawer>
	);
}

interface ManagerSectionsProps {
	readonly rangeMode: RangeMode;
	readonly onRangeChange: (mode: RangeMode) => void;
	readonly memberEvents: Doc<"clockEvents">[];
	readonly memberAbsences: Doc<"absences">[];
	readonly localeTag: string;
}

function ManagerSections({
	rangeMode,
	onRangeChange,
	memberEvents,
	memberAbsences,
	localeTag,
}: Readonly<ManagerSectionsProps>) {
	const { t } = useTranslation();
	const dateTimeFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(localeTag, {
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			}),
		[localeTag]
	);

	return (
		<>
			<div className="flex items-center gap-2">
				<label className="text-xs text-faint-foreground flex items-center gap-2">
					{t(AdminStaffKeys.ATTENDANCE_RANGE_LABEL)}
					<select
						className="rounded border border-border bg-background px-2 py-1 text-sm"
						value={rangeMode}
						onChange={(e) => onRangeChange(e.target.value as RangeMode)}
					>
						<option value="week">{t(AdminStaffKeys.ATTENDANCE_RANGE_WEEK)}</option>
						<option value="7d">{t(AdminStaffKeys.ATTENDANCE_RANGE_7D)}</option>
						<option value="30d">{t(AdminStaffKeys.ATTENDANCE_RANGE_30D)}</option>
					</select>
				</label>
			</div>

			<section className="space-y-2">
				<h3 className="text-sm font-semibold">
					{t(AdminStaffKeys.ATTENDANCE_CLOCK_EVENTS)}
				</h3>
				{memberEvents.length === 0 ? (
					<p className="text-sm text-faint-foreground">
						{t(AdminStaffKeys.ATTENDANCE_NO_EVENTS)}
					</p>
				) : (
					<div className="overflow-x-auto rounded border border-border">
						<table className="w-full text-sm">
							<thead className="bg-muted text-left text-xs uppercase text-faint-foreground">
								<tr>
									<th className="p-2">{t(AdminStaffKeys.ATTENDANCE_COL_TYPE)}</th>
									<th className="p-2">{t(AdminStaffKeys.ATTENDANCE_COL_TIME)}</th>
								</tr>
							</thead>
							<tbody>
								{memberEvents.map((e) => (
									<tr key={e._id} className="border-t border-border">
										<td className="p-2">{e.type}</td>
										<td className="p-2">{dateTimeFormatter.format(new Date(e.at))}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<AbsencesTable
				absences={memberAbsences}
				heading={t(AdminStaffKeys.ATTENDANCE_ABSENCES)}
				emptyLabel={t(AdminStaffKeys.ATTENDANCE_NO_ABSENCES)}
			/>
		</>
	);
}

interface AbsencesTableProps {
	readonly absences: Doc<"absences">[];
	readonly heading?: string;
	readonly emptyLabel: string;
}

function AbsencesTable({ absences, heading, emptyLabel }: Readonly<AbsencesTableProps>) {
	const { t } = useTranslation();
	return (
		<section className="space-y-2">
			{heading ? <h3 className="text-sm font-semibold">{heading}</h3> : null}
			{absences.length === 0 ? (
				<p className="text-sm text-faint-foreground">{emptyLabel}</p>
			) : (
				<div className="overflow-x-auto rounded border border-border">
					<table className="w-full text-sm">
						<thead className="bg-muted text-left text-xs uppercase text-faint-foreground">
							<tr>
								<th className="p-2">{t(AdminStaffKeys.ATTENDANCE_COL_DATE)}</th>
								<th className="p-2">{t(AdminStaffKeys.ATTENDANCE_COL_TYPE)}</th>
								<th className="p-2">{t(AdminStaffKeys.ATTENDANCE_COL_STATUS)}</th>
							</tr>
						</thead>
						<tbody>
							{absences.map((a) => (
								<tr key={a._id} className="border-t border-border">
									<td className="p-2">{a.date}</td>
									<td className="p-2">{absenceTypeLabel(a.type, t)}</td>
									<td className="p-2">{absenceStatusLabel(a.status, t)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}

interface SelfSectionProps {
	readonly restaurantId: Id<"restaurants">;
	readonly myAbsences: Doc<"absences">[] | null;
	readonly isOpen: boolean;
	readonly onRequested: () => void;
}

function SelfSection({
	restaurantId,
	myAbsences,
	isOpen,
	onRequested,
}: Readonly<SelfSectionProps>) {
	const { t } = useTranslation();
	const [requestOpen, setRequestOpen] = useState(false);

	useEffect(() => {
		if (!isOpen) setRequestOpen(false);
	}, [isOpen]);

	return (
		<section className="space-y-2">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h3 className="text-sm font-semibold">
					{t(AdminStaffKeys.ATTENDANCE_MY_ABSENCES)}
				</h3>
				<button
					type="button"
					onClick={() => setRequestOpen(true)}
					className="text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-background hover:bg-(--bg-hover)"
				>
					{t(AdminStaffKeys.ATTENDANCE_REQUEST_OPEN)}
				</button>
			</div>
			<AbsencesTable
				absences={myAbsences ?? []}
				emptyLabel={t(AdminStaffKeys.ATTENDANCE_MY_ABSENCES_EMPTY)}
			/>
			{requestOpen ? (
				<RequestTimeOffForm
					restaurantId={restaurantId}
					onCancel={() => setRequestOpen(false)}
					onSubmitted={() => {
						setRequestOpen(false);
						onRequested();
					}}
				/>
			) : null}
		</section>
	);
}

interface RequestTimeOffFormProps {
	readonly restaurantId: Id<"restaurants">;
	readonly onCancel: () => void;
	readonly onSubmitted: () => void;
}

function RequestTimeOffForm({
	restaurantId,
	onCancel,
	onSubmitted,
}: Readonly<RequestTimeOffFormProps>) {
	const { t, i18n } = useTranslation();
	const [formDate, setFormDate] = useState(() => todayLocalYmd());
	const [formType, setFormType] = useState<SelfServiceAbsenceType>(
		SELF_SERVICE_ABSENCE_TYPES[0]
	);
	const [formReason, setFormReason] = useState("");
	const [formError, setFormError] = useState<string | null>(null);

	const requestAbsence = useMutation({
		mutationFn: useConvexMutation(api.attendance.requestAbsence),
	});

	const onSubmit = async () => {
		const date = formDate.trim();
		if (!date) {
			setFormError(t(AdminStaffKeys.ATTENDANCE_REQUEST_ERROR_DATE));
			return;
		}
		setFormError(null);
		try {
			unwrapResult(
				await requestAbsence.mutateAsync({
					restaurantId,
					date,
					type: formType,
					reason: formReason.trim() || undefined,
				})
			);
			onSubmitted();
		} catch (e) {
			setFormError(e instanceof Error ? e.message : String(e));
		}
	};

	return (
		<div className="mt-3 rounded border border-border p-3 space-y-3">
			<p className="text-xs text-faint-foreground">
				{t(AdminStaffKeys.ATTENDANCE_REQUEST_ONE_DAY_NOTE)}
			</p>
			<AppDatePicker
				id="attendance-drawer-request-date"
				label={t(AdminStaffKeys.ATTENDANCE_REQUEST_DATE_LABEL)}
				value={formDate}
				onChange={setFormDate}
				localeTag={i18n.language}
				embedded
			/>
			<label className="block text-xs font-medium text-foreground">
				{t(AdminStaffKeys.ATTENDANCE_REQUEST_TYPE_LABEL)}
				<select
					value={formType}
					onChange={(e) => setFormType(e.target.value as SelfServiceAbsenceType)}
					className="mt-1 block w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
				>
					{SELF_SERVICE_ABSENCE_TYPES.map((type) => (
						<option key={type} value={type}>
							{absenceTypeLabel(type, t)}
						</option>
					))}
				</select>
			</label>
			<label className="block text-xs font-medium text-foreground">
				{t(AdminStaffKeys.ATTENDANCE_REQUEST_REASON_LABEL)}
				<textarea
					value={formReason}
					onChange={(e) => setFormReason(e.target.value)}
					placeholder={t(AdminStaffKeys.ATTENDANCE_REQUEST_REASON_PLACEHOLDER)}
					rows={3}
					className="mt-1 block w-full rounded border border-border bg-background px-2 py-1.5 text-sm resize-y min-h-16"
				/>
			</label>
			{formError ? <p className="text-xs text-destructive">{formError}</p> : null}
			<div className="flex justify-end gap-2 pt-1">
				<button
					type="button"
					onClick={onCancel}
					className="text-xs font-medium px-3 py-1.5 rounded-md border border-border hover:bg-(--bg-hover)"
				>
					{t(AdminStaffKeys.ATTENDANCE_REQUEST_CANCEL)}
				</button>
				<button
					type="button"
					onClick={() => void onSubmit()}
					disabled={requestAbsence.isPending}
					className="text-xs font-medium px-3 py-1.5 rounded-md border border-primary bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
				>
					{t(AdminStaffKeys.ATTENDANCE_REQUEST_SUBMIT)}
				</button>
			</div>
		</div>
	);
}

interface PendingApprovalBannerProps {
	readonly absences: Doc<"absences">[];
	readonly onDecided: () => void;
}

type PendingDecision =
	| typeof ABSENCE_REQUEST_STATUS.APPROVED
	| typeof ABSENCE_REQUEST_STATUS.DENIED;

/**
 * Surfaces every pending absence for the target member with per-row
 * Approve/Deny + bulk shortcuts. Bulk actions require an inline confirmation
 * morph to mitigate accidental mass-deny; per-row actions fire immediately
 * since their blast radius is one decision.
 *
 * Hidden entirely when there are no pending absences so the rest of the
 * drawer's history view is the dominant UI.
 */
function PendingApprovalBanner({
	absences,
	onDecided,
}: Readonly<PendingApprovalBannerProps>) {
	const { t } = useTranslation();
	const pending = useMemo(
		() =>
			absences
				.filter((a) => a.status === ABSENCE_REQUEST_STATUS.PENDING)
				.slice()
				.sort((a, b) => (a.date < b.date ? -1 : 1)),
		[absences]
	);

	const [confirming, setConfirming] = useState<PendingDecision | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const decideAbsence = useMutation({
		mutationFn: useConvexMutation(api.attendance.decideAbsence),
	});

	useEffect(() => {
		if (pending.length === 0) {
			setConfirming(null);
			setError(null);
		}
	}, [pending.length]);

	const runDecision = async (
		ids: ReadonlyArray<Id<"absences">>,
		status: PendingDecision
	) => {
		if (ids.length === 0) return;
		setBusy(true);
		setError(null);
		try {
			await Promise.all(
				ids.map((absenceId) =>
					decideAbsence
						.mutateAsync({ absenceId, status })
						.then((res) => unwrapResult(res))
				)
			);
			setConfirming(null);
			onDecided();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	if (pending.length === 0) return null;

	return (
		<section
			aria-label={t(AdminStaffKeys.ATTENDANCE_BANNER_PENDING_TITLE, {
				count: pending.length,
			})}
			className="rounded-md border border-yellow-500/60 bg-yellow-400/10 p-3 space-y-3"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-sm font-semibold text-yellow-900 dark:text-yellow-100">
					{t(AdminStaffKeys.ATTENDANCE_BANNER_PENDING_TITLE, {
						count: pending.length,
					})}
				</h3>
				<BulkDecisionControls
					confirming={confirming}
					busy={busy}
					pendingCount={pending.length}
					onArm={(decision) => setConfirming(decision)}
					onCancel={() => setConfirming(null)}
					onConfirm={(decision) =>
						void runDecision(
							pending.map((p) => p._id),
							decision
						)
					}
				/>
			</div>
			<ul className="space-y-2">
				{pending.map((row) => (
					<PendingRow
						key={row._id}
						row={row}
						busy={busy}
						onApprove={() =>
							void runDecision([row._id], ABSENCE_REQUEST_STATUS.APPROVED)
						}
						onDeny={() =>
							void runDecision([row._id], ABSENCE_REQUEST_STATUS.DENIED)
						}
					/>
				))}
			</ul>
			{error ? <p className="text-xs text-destructive">{error}</p> : null}
		</section>
	);
}

interface BulkDecisionControlsProps {
	readonly confirming: PendingDecision | null;
	readonly busy: boolean;
	readonly pendingCount: number;
	readonly onArm: (decision: PendingDecision) => void;
	readonly onCancel: () => void;
	readonly onConfirm: (decision: PendingDecision) => void;
}

function BulkDecisionControls({
	confirming,
	busy,
	pendingCount,
	onArm,
	onCancel,
	onConfirm,
}: Readonly<BulkDecisionControlsProps>) {
	const { t } = useTranslation();

	if (confirming !== null) {
		const labelKey =
			confirming === ABSENCE_REQUEST_STATUS.APPROVED
				? AdminStaffKeys.ATTENDANCE_BANNER_CONFIRM_APPROVE_N
				: AdminStaffKeys.ATTENDANCE_BANNER_CONFIRM_DENY_N;
		const tone =
			confirming === ABSENCE_REQUEST_STATUS.APPROVED
				? "border-emerald-500 bg-emerald-500 text-white hover:opacity-90"
				: "border-destructive bg-destructive text-white hover:opacity-90";
		return (
			<div className="flex items-center gap-2">
				<button
					type="button"
					disabled={busy}
					onClick={() => onConfirm(confirming)}
					className={`text-xs font-medium px-3 py-1.5 rounded-md border ${tone} disabled:opacity-50`}
				>
					{t(labelKey, { count: pendingCount })}
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={onCancel}
					aria-label={t(AdminStaffKeys.ATTENDANCE_BANNER_CONFIRM_CANCEL)}
					className="text-xs font-medium px-2 py-1.5 rounded-md border border-border hover:bg-(--bg-hover) disabled:opacity-50"
				>
					{t(AdminStaffKeys.ATTENDANCE_BANNER_CONFIRM_CANCEL)}
				</button>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-2">
			<button
				type="button"
				disabled={busy}
				onClick={() => onArm(ABSENCE_REQUEST_STATUS.APPROVED)}
				className="text-xs font-medium px-3 py-1.5 rounded-md border border-emerald-500/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
			>
				{t(AdminStaffKeys.ATTENDANCE_BANNER_APPROVE_ALL)}
			</button>
			<button
				type="button"
				disabled={busy}
				onClick={() => onArm(ABSENCE_REQUEST_STATUS.DENIED)}
				className="text-xs font-medium px-3 py-1.5 rounded-md border border-destructive/60 text-destructive hover:bg-destructive/10 disabled:opacity-50"
			>
				{t(AdminStaffKeys.ATTENDANCE_BANNER_DENY_ALL)}
			</button>
		</div>
	);
}

interface PendingRowProps {
	readonly row: Doc<"absences">;
	readonly busy: boolean;
	readonly onApprove: () => void;
	readonly onDeny: () => void;
}

function PendingRow({ row, busy, onApprove, onDeny }: Readonly<PendingRowProps>) {
	const { t } = useTranslation();
	return (
		<li className="flex flex-wrap items-center justify-between gap-2 rounded border border-yellow-500/30 bg-background/60 px-3 py-2">
			<div className="min-w-0 flex-1">
				<div className="text-sm font-medium text-foreground">
					{row.date} · {absenceTypeLabel(row.type, t)}
				</div>
				{row.reason ? (
					<div className="text-xs text-faint-foreground mt-0.5">
						<span className="font-medium">
							{t(AdminStaffKeys.ATTENDANCE_BANNER_REASON_LABEL)}:{" "}
						</span>
						{row.reason}
					</div>
				) : null}
			</div>
			<div className="flex items-center gap-2 shrink-0">
				<button
					type="button"
					disabled={busy}
					onClick={onApprove}
					className="text-xs font-medium px-3 py-1.5 rounded-md border border-emerald-500/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
				>
					{t(AdminStaffKeys.ATTENDANCE_BANNER_APPROVE)}
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={onDeny}
					className="text-xs font-medium px-3 py-1.5 rounded-md border border-destructive/60 text-destructive hover:bg-destructive/10 disabled:opacity-50"
				>
					{t(AdminStaffKeys.ATTENDANCE_BANNER_DENY)}
				</button>
			</div>
		</li>
	);
}
