/**
 * `ShiftDrawer` — primary write surface for the schedule feature.
 *
 * Two tabs:
 *   - One-off: assign a single concrete shift on a specific date. Backed by
 *     `convex.shifts.createShift` / `updateShift`.
 *   - Weekly: create one or more `shiftTemplates` rows that cron-materialize
 *     into concrete `shifts` rows for the rolling 4-week horizon. Edit mode
 *     of the drawer always uses the One-off tab — template editing happens
 *     elsewhere in V1.
 *
 * Authorization:
 *   The caller is responsible for filtering `members` to only those the
 *   current actor can target. The convex layer re-checks via
 *   `requireShiftTargetAuthority`, but pre-filtering avoids a UI dead-end.
 */
import {
	AppDatePicker,
	DialogHeader,
	Drawer,
	FieldLabel,
} from "@/global/components";
import { useIsNarrowViewport } from "@/global/hooks";
import { AdminStaffKeys } from "@/global/i18n";
import { todayLocalYmd } from "@/global/utils/calendarMonth";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { SHIFT_STATUS, type ShiftRole } from "convex/constants";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	formatHm,
	parseHm,
	utcMsToHmInTimezone,
	utcMsToYmdInTimezone,
	ymdHmToUtcMs,
} from "../timezone";
import {
	dayLabel,
	SHIFT_ROLE_OPTIONS,
	shiftRoleLabel,
} from "../roles";
import type { AssignableMember, ShiftDrawerInitial } from "../types";

interface ShiftDrawerProps {
	readonly isOpen: boolean;
	readonly onClose: () => void;
	readonly onSaved?: () => void;
	readonly restaurantId: Id<"restaurants">;
	readonly restaurantTimezone: string;
	readonly members: readonly AssignableMember[];
	readonly initial: ShiftDrawerInitial;
	/** Hide the recurring tab — used by the team-row entry which only does one-offs. */
	readonly hideRecurringTab?: boolean;
}

interface OneOffState {
	memberId: Id<"restaurantMembers"> | "";
	ymd: string;
	startMin: number;
	endMin: number;
	role: ShiftRole | "";
	notes: string;
}

interface RecurringState {
	memberId: Id<"restaurantMembers"> | "";
	selectedDays: ReadonlySet<number>;
	startMin: number;
	durationMin: number;
	role: ShiftRole | "";
	notes: string;
	activeFromYmd: string;
	activeUntilYmd: string;
}

const DEFAULT_START_MIN = 11 * 60;
const DEFAULT_END_MIN = 19 * 60;
const DEFAULT_DURATION_MIN = 8 * 60;

const PRESETS: ReadonlyArray<{
	id: string;
	startMin: number;
	endMin: number;
	labelKey: keyof typeof AdminStaffKeys;
}> = [
	{ id: "lunch", startMin: 11 * 60, endMin: 15 * 60, labelKey: "SCHEDULE_DRAWER_PRESET_LUNCH" },
	{ id: "dinner", startMin: 17 * 60, endMin: 22 * 60, labelKey: "SCHEDULE_DRAWER_PRESET_DINNER" },
	{ id: "full", startMin: 9 * 60, endMin: 22 * 60, labelKey: "SCHEDULE_DRAWER_PRESET_FULL" },
];

function memberLabel(m: AssignableMember): string {
	return m.displayName || "—";
}

export function ShiftDrawer(props: Readonly<ShiftDrawerProps>) {
	const {
		isOpen,
		onClose,
		onSaved,
		restaurantId,
		restaurantTimezone,
		members,
		initial,
		hideRecurringTab,
	} = props;

	const { t, i18n } = useTranslation();
	const isNarrow = useIsNarrowViewport();
	const reactId = useId();
	const tz = restaurantTimezone || "UTC";

	const isEdit = initial.mode === "edit";
	const editingShift = isEdit ? initial.shift : null;

	const initialOneOff = useMemo<OneOffState>(() => {
		if (editingShift) {
			return {
				memberId: editingShift.memberId,
				ymd: utcMsToYmdInTimezone(editingShift.startsAt, tz),
				startMin: parseHmInTz(editingShift.startsAt, tz),
				endMin: parseHmInTz(editingShift.endsAt, tz),
				role: (SHIFT_ROLE_OPTIONS as readonly string[]).includes(editingShift.shiftRole ?? "")
					? (editingShift.shiftRole as ShiftRole)
					: "",
				notes: editingShift.notes ?? "",
			};
		}
		return {
			memberId: initial.mode === "create" && initial.memberId ? initial.memberId : "",
			ymd: initial.mode === "create" && initial.ymd ? initial.ymd : todayLocalYmd(),
			startMin: DEFAULT_START_MIN,
			endMin: DEFAULT_END_MIN,
			role: "",
			notes: "",
		};
	}, [editingShift, initial, tz]);

	const initialRecurring = useMemo<RecurringState>(
		() => ({
			memberId:
				initial.mode === "create" && initial.memberId ? initial.memberId : "",
			selectedDays: new Set<number>(),
			startMin: DEFAULT_START_MIN,
			durationMin: DEFAULT_DURATION_MIN,
			role: "",
			notes: "",
			activeFromYmd: todayLocalYmd(),
			activeUntilYmd: "",
		}),
		[initial]
	);

	const [tab, setTab] = useState<"oneoff" | "recurring">("oneoff");
	const [oneoff, setOneoff] = useState<OneOffState>(initialOneOff);
	const [recurring, setRecurring] = useState<RecurringState>(initialRecurring);
	const [error, setError] = useState<string | null>(null);
	const [confirmingCancel, setConfirmingCancel] = useState(false);

	useEffect(() => {
		if (!isOpen) return;
		setOneoff(initialOneOff);
		setRecurring(initialRecurring);
		setTab("oneoff");
		setError(null);
		setConfirmingCancel(false);
	}, [isOpen, initialOneOff, initialRecurring]);

	const createShift = useMutation({
		mutationFn: useConvexMutation(api.shifts.createShift),
	});
	const updateShift = useMutation({
		mutationFn: useConvexMutation(api.shifts.updateShift),
	});
	const cancelShift = useMutation({
		mutationFn: useConvexMutation(api.shifts.cancelShift),
	});
	const createTemplate = useMutation({
		mutationFn: useConvexMutation(api.shiftTemplates.createShiftTemplate),
	});

	const isPending =
		createShift.isPending ||
		updateShift.isPending ||
		cancelShift.isPending ||
		createTemplate.isPending;

	const handleSaveOneOff = async () => {
		setError(null);
		if (!oneoff.memberId) {
			setError(t(AdminStaffKeys.SCHEDULE_DRAWER_ERROR_NO_MEMBER));
			return;
		}
		if (oneoff.endMin <= oneoff.startMin) {
			setError(t(AdminStaffKeys.SCHEDULE_DRAWER_ERROR_TIME));
			return;
		}
		const startsAt = ymdHmToUtcMs(oneoff.ymd, oneoff.startMin, tz);
		const endsAt = ymdHmToUtcMs(oneoff.ymd, oneoff.endMin, tz);
		try {
			if (editingShift) {
				unwrapResult(
					await updateShift.mutateAsync({
						shiftId: editingShift._id,
						startsAt,
						endsAt,
						shiftRole: oneoff.role || undefined,
						notes: oneoff.notes.trim() || undefined,
					})
				);
			} else {
				unwrapResult(
					await createShift.mutateAsync({
						memberId: oneoff.memberId,
						restaurantId,
						startsAt,
						endsAt,
						shiftRole: oneoff.role || undefined,
						notes: oneoff.notes.trim() || undefined,
					})
				);
			}
			onSaved?.();
			onClose();
		} catch (e) {
			setError(extractError(e, t));
		}
	};

	const handleSaveRecurring = async () => {
		setError(null);
		if (!recurring.memberId) {
			setError(t(AdminStaffKeys.SCHEDULE_DRAWER_ERROR_NO_MEMBER));
			return;
		}
		if (recurring.selectedDays.size === 0) {
			setError(t(AdminStaffKeys.SCHEDULE_DRAWER_ERROR_NO_DAYS));
			return;
		}
		if (recurring.durationMin <= 0) {
			setError(t(AdminStaffKeys.SCHEDULE_DRAWER_ERROR_TIME));
			return;
		}
		try {
			for (const dayOfWeek of Array.from(recurring.selectedDays).sort((a, b) => a - b)) {
				unwrapResult(
					await createTemplate.mutateAsync({
						memberId: recurring.memberId,
						restaurantId,
						dayOfWeek,
						startMinutesFromMidnight: recurring.startMin,
						durationMinutes: recurring.durationMin,
						shiftRole: recurring.role || undefined,
						notes: recurring.notes.trim() || undefined,
						activeFromYmd: recurring.activeFromYmd,
						activeUntilYmd: recurring.activeUntilYmd.trim() || undefined,
					})
				);
			}
			onSaved?.();
			onClose();
		} catch (e) {
			setError(extractError(e, t));
		}
	};

	const handleCancelShift = async () => {
		if (!editingShift) return;
		setError(null);
		try {
			unwrapResult(await cancelShift.mutateAsync({ shiftId: editingShift._id }));
			onSaved?.();
			onClose();
		} catch (e) {
			setError(extractError(e, t));
		}
	};

	const showRecurringTab = !isEdit && !hideRecurringTab;
	const isPublishedEdit =
		editingShift?.status === SHIFT_STATUS.PUBLISHED;
	const isLinkedTemplateEdit = editingShift?.templateId != null;
	const title = isEdit
		? t(AdminStaffKeys.SCHEDULE_DRAWER_TITLE_EDIT)
		: t(AdminStaffKeys.SCHEDULE_DRAWER_TITLE_CREATE);

	const submitDisabled =
		isPending ||
		(tab === "oneoff" ? !oneoff.memberId : !recurring.memberId);

	return (
		<Drawer
			isOpen={isOpen}
			onClose={onClose}
			ariaLabel={title}
			side={isNarrow ? "bottom" : "right"}
			size={isNarrow ? "92dvh" : "min(520px, 90vw)"}
			swipeToClose={isNarrow}
			swipeHandleAriaLabel={t(AdminStaffKeys.SCHEDULE_DRAWER_SWIPE_HANDLE)}
			panelClassName="bg-background border border-border overflow-hidden"
		>
			<DialogHeader title={title} onClose={onClose} />
			<div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
				{showRecurringTab ? (
					<div
						className="grid grid-cols-2 rounded-md border border-border overflow-hidden text-xs"
						role="tablist"
					>
						<button
							type="button"
							role="tab"
							aria-selected={tab === "oneoff"}
							onClick={() => setTab("oneoff")}
							className={`px-3 py-2 ${
								tab === "oneoff"
									? "bg-primary text-primary-foreground"
									: "bg-background text-foreground hover:bg-(--bg-hover)"
							}`}
						>
							{t(AdminStaffKeys.SCHEDULE_DRAWER_TAB_ONEOFF)}
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={tab === "recurring"}
							onClick={() => setTab("recurring")}
							className={`px-3 py-2 ${
								tab === "recurring"
									? "bg-primary text-primary-foreground"
									: "bg-background text-foreground hover:bg-(--bg-hover)"
							}`}
						>
							{t(AdminStaffKeys.SCHEDULE_DRAWER_TAB_RECURRING)}
						</button>
					</div>
				) : null}

				{tab === "oneoff" ? (
					<OneOffTab
						state={oneoff}
						setState={setOneoff}
						members={members}
						isEdit={isEdit}
						idPrefix={reactId}
						localeTag={i18n.language}
					/>
				) : (
					<RecurringTab
						state={recurring}
						setState={setRecurring}
						members={members}
						idPrefix={reactId}
						localeTag={i18n.language}
					/>
				)}

				{tab === "oneoff" && editingShift ? (
					<SectionsCoveredPanel
						restaurantId={restaurantId}
						shiftId={editingShift._id}
						shiftStartsAt={editingShift.startsAt}
						shiftEndsAt={editingShift.endsAt}
					/>
				) : null}

				{isPublishedEdit ? (
					<p className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
						{t(AdminStaffKeys.SCHEDULE_DRAWER_PUBLISHED_WARN)}
					</p>
				) : null}
				{isLinkedTemplateEdit ? (
					<p className="text-xs rounded-md border border-border bg-muted px-3 py-2 text-muted-foreground">
						{t(AdminStaffKeys.SCHEDULE_DRAWER_TEMPLATE_DETACH_WARN)}
					</p>
				) : null}
				{error ? <p className="text-xs text-destructive">{error}</p> : null}

				<div className="flex flex-wrap items-center justify-between gap-2 pt-2">
					{isEdit ? (
						confirmingCancel ? (
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-xs text-foreground">
									{t(AdminStaffKeys.SCHEDULE_DRAWER_DELETE_CONFIRM)}
								</span>
								<button
									type="button"
									onClick={() => void handleCancelShift()}
									disabled={isPending}
									className="text-xs font-medium px-3 py-1.5 rounded-md border border-destructive bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50"
								>
									{t(AdminStaffKeys.SCHEDULE_DRAWER_DELETE)}
								</button>
								<button
									type="button"
									onClick={() => setConfirmingCancel(false)}
									className="text-xs font-medium px-2 py-1 rounded-md border border-border hover:bg-(--bg-hover)"
								>
									{t(AdminStaffKeys.SCHEDULE_DRAWER_CANCEL)}
								</button>
							</div>
						) : (
							<button
								type="button"
								onClick={() => setConfirmingCancel(true)}
								disabled={isPending}
								className="text-xs font-medium px-3 py-1.5 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50"
							>
								{t(AdminStaffKeys.SCHEDULE_DRAWER_DELETE)}
							</button>
						)
					) : (
						<span />
					)}

					<div className="flex items-center gap-2 ml-auto">
						<button
							type="button"
							onClick={onClose}
							className="text-xs font-medium px-3 py-1.5 rounded-md border border-border hover:bg-(--bg-hover)"
						>
							{t(AdminStaffKeys.SCHEDULE_DRAWER_CANCEL)}
						</button>
						<button
							type="button"
							onClick={() =>
								tab === "oneoff" ? void handleSaveOneOff() : void handleSaveRecurring()
							}
							disabled={submitDisabled}
							className="text-xs font-medium px-3 py-1.5 rounded-md border border-primary bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
						>
							{isPending
								? t(AdminStaffKeys.SCHEDULE_DRAWER_SAVING)
								: t(AdminStaffKeys.SCHEDULE_DRAWER_SAVE)}
						</button>
					</div>
				</div>
			</div>
		</Drawer>
	);
}

interface OneOffTabProps {
	readonly state: OneOffState;
	readonly setState: (next: OneOffState) => void;
	readonly members: readonly AssignableMember[];
	readonly isEdit: boolean;
	readonly idPrefix: string;
	readonly localeTag: string;
}

function OneOffTab({ state, setState, members, isEdit, idPrefix, localeTag }: OneOffTabProps) {
	const { t } = useTranslation();
	const dateId = `${idPrefix}-date`;
	const startId = `${idPrefix}-start`;
	const endId = `${idPrefix}-end`;
	const roleId = `${idPrefix}-role`;
	const notesId = `${idPrefix}-notes`;

	return (
		<div className="space-y-3">
			<MemberSelect
				value={state.memberId}
				onChange={(v) => setState({ ...state, memberId: v })}
				members={members}
				disabled={isEdit}
				idPrefix={idPrefix}
			/>
			<AppDatePicker
				id={dateId}
				label={t(AdminStaffKeys.SCHEDULE_DRAWER_DATE_LABEL)}
				value={state.ymd}
				onChange={(ymd) => setState({ ...state, ymd })}
				localeTag={localeTag}
			/>
			<div>
				<FieldLabel htmlFor={`${idPrefix}-presets`} label={t(AdminStaffKeys.SCHEDULE_DRAWER_PRESETS_LABEL)} />
				<div id={`${idPrefix}-presets`} className="flex flex-wrap gap-1.5">
					{PRESETS.map((p) => {
						const active = state.startMin === p.startMin && state.endMin === p.endMin;
						return (
							<button
								key={p.id}
								type="button"
								onClick={() =>
									setState({ ...state, startMin: p.startMin, endMin: p.endMin })
								}
								className={`text-xs px-2 py-1 rounded-md border ${
									active
										? "border-primary bg-primary/10 text-primary"
										: "border-border bg-background hover:bg-(--bg-hover)"
								}`}
							>
								{t(AdminStaffKeys[p.labelKey])}
							</button>
						);
					})}
				</div>
			</div>
			<div className="grid grid-cols-2 gap-3">
				<TimeField
					id={startId}
					label={t(AdminStaffKeys.SCHEDULE_DRAWER_START_LABEL)}
					value={state.startMin}
					onChange={(v) => setState({ ...state, startMin: v })}
				/>
				<TimeField
					id={endId}
					label={t(AdminStaffKeys.SCHEDULE_DRAWER_END_LABEL)}
					value={state.endMin}
					onChange={(v) => setState({ ...state, endMin: v })}
				/>
			</div>
			<RoleSelect
				id={roleId}
				value={state.role}
				onChange={(v) => setState({ ...state, role: v })}
			/>
			<label htmlFor={notesId} className="block text-xs font-medium text-foreground">
				<span className="block mb-1">{t(AdminStaffKeys.SCHEDULE_DRAWER_NOTES_LABEL)}</span>
				<textarea
					id={notesId}
					value={state.notes}
					onChange={(e) => setState({ ...state, notes: e.target.value })}
					placeholder={t(AdminStaffKeys.SCHEDULE_DRAWER_NOTES_PLACEHOLDER)}
					rows={2}
					className="block w-full rounded border border-border bg-background px-2 py-1.5 text-sm resize-y min-h-12"
				/>
			</label>
		</div>
	);
}

interface RecurringTabProps {
	readonly state: RecurringState;
	readonly setState: (next: RecurringState) => void;
	readonly members: readonly AssignableMember[];
	readonly idPrefix: string;
	readonly localeTag: string;
}

function RecurringTab({ state, setState, members, idPrefix, localeTag }: RecurringTabProps) {
	const { t } = useTranslation();
	const startId = `${idPrefix}-r-start`;
	const fromId = `${idPrefix}-r-from`;
	const untilId = `${idPrefix}-r-until`;
	const durationId = `${idPrefix}-r-duration`;
	const roleId = `${idPrefix}-r-role`;
	const notesId = `${idPrefix}-r-notes`;
	const daysGroupId = `${idPrefix}-r-days`;

	const toggleDay = (day: number) => {
		const next = new Set(state.selectedDays);
		if (next.has(day)) next.delete(day);
		else next.add(day);
		setState({ ...state, selectedDays: next });
	};

	return (
		<div className="space-y-3">
			<MemberSelect
				value={state.memberId}
				onChange={(v) => setState({ ...state, memberId: v })}
				members={members}
				idPrefix={idPrefix}
			/>
			<div>
				<FieldLabel htmlFor={daysGroupId} label={t(AdminStaffKeys.SCHEDULE_DRAWER_DAYS_LABEL)} />
				<div id={daysGroupId} className="flex flex-wrap gap-1.5">
					{Array.from({ length: 7 }, (_, i) => i).map((dow) => {
						const active = state.selectedDays.has(dow);
						return (
							<button
								key={dow}
								type="button"
								onClick={() => toggleDay(dow)}
								className={`text-xs px-2.5 py-1 rounded-md border ${
									active
										? "border-primary bg-primary/10 text-primary"
										: "border-border bg-background hover:bg-(--bg-hover)"
								}`}
							>
								{dayLabel(dow, t)}
							</button>
						);
					})}
				</div>
			</div>
			<div className="grid grid-cols-2 gap-3">
				<TimeField
					id={startId}
					label={t(AdminStaffKeys.SCHEDULE_DRAWER_START_LABEL)}
					value={state.startMin}
					onChange={(v) => setState({ ...state, startMin: v })}
				/>
				<NumberHoursField
					id={durationId}
					label={t(AdminStaffKeys.SCHEDULE_DRAWER_DURATION_LABEL)}
					valueMin={state.durationMin}
					onChangeMin={(v) => setState({ ...state, durationMin: v })}
				/>
			</div>
			<RoleSelect
				id={roleId}
				value={state.role}
				onChange={(v) => setState({ ...state, role: v })}
			/>
			<AppDatePicker
				id={fromId}
				label={t(AdminStaffKeys.SCHEDULE_DRAWER_ACTIVE_FROM_LABEL)}
				value={state.activeFromYmd}
				onChange={(ymd) => setState({ ...state, activeFromYmd: ymd })}
				localeTag={localeTag}
			/>
			<label htmlFor={untilId} className="block text-xs font-medium text-foreground">
				<span className="block mb-1">{t(AdminStaffKeys.SCHEDULE_DRAWER_ACTIVE_UNTIL_LABEL)}</span>
				<input
					id={untilId}
					type="date"
					value={state.activeUntilYmd}
					onChange={(e) => setState({ ...state, activeUntilYmd: e.target.value })}
					placeholder={t(AdminStaffKeys.SCHEDULE_DRAWER_ACTIVE_UNTIL_PLACEHOLDER)}
					className="block w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
				/>
			</label>
			<label htmlFor={notesId} className="block text-xs font-medium text-foreground">
				<span className="block mb-1">{t(AdminStaffKeys.SCHEDULE_DRAWER_NOTES_LABEL)}</span>
				<textarea
					id={notesId}
					value={state.notes}
					onChange={(e) => setState({ ...state, notes: e.target.value })}
					placeholder={t(AdminStaffKeys.SCHEDULE_DRAWER_NOTES_PLACEHOLDER)}
					rows={2}
					className="block w-full rounded border border-border bg-background px-2 py-1.5 text-sm resize-y min-h-12"
				/>
			</label>
		</div>
	);
}

interface MemberSelectProps {
	readonly value: Id<"restaurantMembers"> | "";
	readonly onChange: (v: Id<"restaurantMembers"> | "") => void;
	readonly members: readonly AssignableMember[];
	readonly disabled?: boolean;
	readonly idPrefix: string;
}

function MemberSelect({ value, onChange, members, disabled, idPrefix }: MemberSelectProps) {
	const { t } = useTranslation();
	const id = `${idPrefix}-member`;
	if (members.length === 0) {
		return (
			<div>
				<FieldLabel htmlFor={id} label={t(AdminStaffKeys.SCHEDULE_DRAWER_MEMBER_LABEL)} />
				<p
					id={id}
					className="text-xs text-faint-foreground border border-dashed border-border rounded-md px-3 py-2"
				>
					{t(AdminStaffKeys.SCHEDULE_DRAWER_MEMBER_NONE)}
				</p>
			</div>
		);
	}
	return (
		<label htmlFor={id} className="block text-xs font-medium text-foreground">
			<span className="block mb-1">{t(AdminStaffKeys.SCHEDULE_DRAWER_MEMBER_LABEL)}</span>
			<select
				id={id}
				value={value}
				onChange={(e) => onChange(e.target.value as Id<"restaurantMembers">)}
				disabled={disabled}
				className="block w-full rounded border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-60"
			>
				<option value="">{t(AdminStaffKeys.SCHEDULE_DRAWER_MEMBER_PLACEHOLDER)}</option>
				{members.map((m) => (
					<option key={m.memberId} value={m.memberId}>
						{memberLabel(m)}
					</option>
				))}
			</select>
		</label>
	);
}

interface RoleSelectProps {
	readonly id: string;
	readonly value: ShiftRole | "";
	readonly onChange: (v: ShiftRole | "") => void;
}

function RoleSelect({ id, value, onChange }: RoleSelectProps) {
	const { t } = useTranslation();
	return (
		<label htmlFor={id} className="block text-xs font-medium text-foreground">
			<span className="block mb-1">{t(AdminStaffKeys.SCHEDULE_DRAWER_ROLE_LABEL)}</span>
			<select
				id={id}
				value={value}
				onChange={(e) => onChange(e.target.value as ShiftRole | "")}
				className="block w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
			>
				<option value="">{t(AdminStaffKeys.SCHEDULE_DRAWER_ROLE_NONE)}</option>
				{SHIFT_ROLE_OPTIONS.map((r) => (
					<option key={r} value={r}>
						{shiftRoleLabel(r, t)}
					</option>
				))}
			</select>
		</label>
	);
}

interface TimeFieldProps {
	readonly id: string;
	readonly label: string;
	readonly value: number;
	readonly onChange: (v: number) => void;
}

function TimeField({ id, label, value, onChange }: TimeFieldProps) {
	const [draft, setDraft] = useState(formatHm(value));
	useEffect(() => {
		setDraft(formatHm(value));
	}, [value]);
	const commit = (next: string) => {
		setDraft(next);
		const parsed = parseHm(next);
		if (parsed != null) onChange(parsed);
	};
	return (
		<label htmlFor={id} className="block text-xs font-medium text-foreground">
			<span className="block mb-1">{label}</span>
			<input
				id={id}
				type="time"
				value={draft}
				onChange={(e) => commit(e.target.value)}
				className="block w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
			/>
		</label>
	);
}

interface NumberHoursFieldProps {
	readonly id: string;
	readonly label: string;
	readonly valueMin: number;
	readonly onChangeMin: (v: number) => void;
}

function NumberHoursField({ id, label, valueMin, onChangeMin }: NumberHoursFieldProps) {
	const valueHours = (valueMin / 60).toFixed(2).replace(/\.?0+$/, "");
	return (
		<label htmlFor={id} className="block text-xs font-medium text-foreground">
			<span className="block mb-1">{label}</span>
			<input
				id={id}
				type="number"
				min={0.5}
				max={24}
				step={0.5}
				value={valueHours}
				onChange={(e) => {
					const num = Number(e.target.value);
					if (Number.isFinite(num) && num > 0) {
						onChangeMin(Math.round(num * 60));
					}
				}}
				className="block w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
			/>
		</label>
	);
}

function parseHmInTz(utcMs: number, timezone: string): number {
	const hm = utcMsToHmInTimezone(utcMs, timezone);
	const parsed = parseHm(hm);
	return parsed ?? 0;
}

interface SectionsCoveredPanelProps {
	readonly restaurantId: Id<"restaurants">;
	readonly shiftId: Id<"shifts">;
	readonly shiftStartsAt: number;
	readonly shiftEndsAt: number;
}

function SectionsCoveredPanel({
	restaurantId,
	shiftId,
	shiftStartsAt,
	shiftEndsAt,
}: SectionsCoveredPanelProps) {
	const { t } = useTranslation();
	const sectionsQuery = useQuery(
		convexQuery(api.sections.getByRestaurant, { restaurantId })
	);
	const assignmentsQuery = useQuery(
		convexQuery(api.shifts.listSectionAssignmentsForShift, { shiftId })
	);

	const upsertSectionAssignment = useMutation({
		mutationFn: useConvexMutation(api.shifts.upsertSectionAssignment),
	});
	const removeSectionAssignment = useMutation({
		mutationFn: useConvexMutation(api.shifts.removeSectionAssignment),
	});

	const [error, setError] = useState<string | null>(null);

	const sectionsAll: readonly Doc<"sections">[] = sectionsQuery.data ?? [];
	const assignmentsResult = assignmentsQuery.data;
	const assignments: readonly Doc<"shiftSectionAssignments">[] = useMemo(() => {
		if (!assignmentsResult) return [];
		const [rows] = assignmentsResult;
		return rows ?? [];
	}, [assignmentsResult]);

	const assignmentBySection = useMemo(() => {
		const m = new Map<Id<"sections">, Doc<"shiftSectionAssignments">>();
		for (const a of assignments) m.set(a.sectionId, a);
		return m;
	}, [assignments]);

	// Hide inactive sections from the assignable list, but keep ones that
	// already have an assignment for this shift so the user can unassign them
	// without first having to re-show the section.
	const sections = useMemo(
		() =>
			sectionsAll.filter(
				(s) => s.isActive !== false || assignmentBySection.has(s._id)
			),
		[sectionsAll, assignmentBySection]
	);

	const sectionLabel = (section: Doc<"sections">, fallbackIndex: number): string => {
		if (section.isSystem === true && (section.name === undefined || section.name === "Default")) {
			return t(AdminStaffKeys.SCHEDULE_DRAWER_SECTIONS_DEFAULT);
		}
		if (section.name && section.name.length > 0) return section.name;
		return t(AdminStaffKeys.SCHEDULE_DRAWER_SECTIONS_UNNAMED, { number: fallbackIndex + 1 });
	};

	const handleToggle = async (sectionId: Id<"sections">, nextChecked: boolean) => {
		setError(null);
		try {
			if (nextChecked) {
				unwrapResult(
					await upsertSectionAssignment.mutateAsync({
						shiftId,
						sectionId,
						startsAt: shiftStartsAt,
						endsAt: shiftEndsAt,
					})
				);
			} else {
				const existing = assignmentBySection.get(sectionId);
				if (!existing) return;
				unwrapResult(
					await removeSectionAssignment.mutateAsync({ assignmentId: existing._id })
				);
			}
		} catch (e) {
			setError(extractSectionsError(e, t));
		}
	};

	return (
		<div className="rounded-md border border-border p-3 space-y-2">
			<div>
				<p className="text-xs font-semibold text-foreground">
					{t(AdminStaffKeys.SCHEDULE_DRAWER_SECTIONS_LABEL)}
				</p>
				<p className="text-xs text-faint-foreground">
					{t(AdminStaffKeys.SCHEDULE_DRAWER_SECTIONS_HINT)}
				</p>
			</div>
			{sections.length === 0 ? (
				<p className="text-xs text-faint-foreground">
					{t(AdminStaffKeys.SCHEDULE_DRAWER_SECTIONS_EMPTY)}
				</p>
			) : (
				<ul className="space-y-1.5">
					{sections.map((section, idx) => {
						const checked = assignmentBySection.has(section._id);
						return (
							<li key={section._id} className="flex items-center gap-2">
								<label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
									<input
										type="checkbox"
										checked={checked}
										onChange={(e) => void handleToggle(section._id, e.target.checked)}
										className="h-4 w-4 accent-primary"
									/>
									<span>{sectionLabel(section, idx)}</span>
								</label>
							</li>
						);
					})}
				</ul>
			)}
			{error ? <p className="text-xs text-destructive">{error}</p> : null}
		</div>
	);
}

function extractSectionsError(e: unknown, t: (k: string, params?: Record<string, unknown>) => string): string {
	if (typeof e === "object" && e != null) {
		const message = (e as { message?: unknown }).message;
		if (typeof message === "string") {
			const lower = message.toLowerCase();
			if (lower.includes("already covered") || lower.includes("ya cubre")) {
				return t(AdminStaffKeys.SCHEDULE_DRAWER_SECTIONS_OVERLAP);
			}
			return message;
		}
	}
	return t(AdminStaffKeys.SCHEDULE_DRAWER_ERROR_GENERIC);
}

function extractError(e: unknown, t: (k: string) => string): string {
	if (typeof e === "object" && e != null) {
		const message = (e as { message?: unknown }).message;
		if (typeof message === "string") {
			if (
				message.toLowerCase().includes("overlap") ||
				message.toLowerCase().includes("traslapa")
			) {
				return t(AdminStaffKeys.SCHEDULE_DRAWER_ERROR_OVERLAP);
			}
			if (message.toLowerCase().includes("startsat")) {
				return t(AdminStaffKeys.SCHEDULE_DRAWER_ERROR_TIME);
			}
			if (message.toLowerCase().includes("endsat")) {
				return t(AdminStaffKeys.SCHEDULE_DRAWER_ERROR_TIME);
			}
			return message;
		}
	}
	return t(AdminStaffKeys.SCHEDULE_DRAWER_ERROR_GENERIC);
}
