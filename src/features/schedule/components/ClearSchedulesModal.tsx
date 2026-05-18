/**
 * ClearSchedulesModal — bulk-cancel shifts and deactivate templates for
 * selected members across a configurable time range.
 *
 * Two-phase flow:
 *   1. Selection: pick members + scope (this week / future / all)
 *   2. Preview + confirm: show impact count, then execute
 *
 * Only visible to managers and above (caller gates rendering).
 */
import { DialogHeader } from "@/global/components/Dialog";
import { Modal } from "@/global/components/Modal";
import { AdminStaffKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AssignableMember } from "../types";

type ClearScope = "thisWeek" | "futureWeeks" | "all";

interface ClearSchedulesModalProps {
	readonly isOpen: boolean;
	readonly onClose: () => void;
	readonly onCleared?: () => void;
	readonly restaurantId: Id<"restaurants">;
	readonly weekStartMs: number;
	readonly members: readonly AssignableMember[];
}

const SCOPE_OPTIONS = [
	["thisWeek", AdminStaffKeys.SCHEDULE_CLEAR_MODAL_SCOPE_THIS_WEEK],
	["futureWeeks", AdminStaffKeys.SCHEDULE_CLEAR_MODAL_SCOPE_FUTURE],
	["all", AdminStaffKeys.SCHEDULE_CLEAR_MODAL_SCOPE_ALL],
] as const;

export function ClearSchedulesModal({
	isOpen,
	onClose,
	onCleared,
	restaurantId,
	weekStartMs,
	members,
}: ClearSchedulesModalProps) {
	const { t } = useTranslation();

	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [scope, setScope] = useState<ClearScope>("thisWeek");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!isOpen) return;
		setSelectedIds(new Set());
		setScope("thisWeek");
		setError(null);
	}, [isOpen]);

	const toggleMember = useCallback((id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const selectAll = useCallback(() => {
		setSelectedIds(new Set(members.map((m) => m.memberId)));
	}, [members]);

	const deselectAll = useCallback(() => {
		setSelectedIds(new Set());
	}, []);

	const selectedMemberIds = useMemo(
		() =>
			Array.from(selectedIds).filter((id) =>
				members.some((m) => m.memberId === id)
			) as Id<"restaurantMembers">[],
		[selectedIds, members]
	);

	const canPreview = selectedMemberIds.length > 0;

	const previewQuery = useQuery({
		...convexQuery(api.shifts.previewBulkClear, {
			restaurantId,
			memberIds: selectedMemberIds,
			scope,
			weekStartMs,
		}),
		enabled: canPreview,
		select: unwrapResult<{ shiftCount: number; templateCount: number }>,
	});

	const preview = canPreview ? previewQuery.data ?? null : null;
	const previewLoading = canPreview && previewQuery.isLoading;
	const hasImpact = preview != null && (preview.shiftCount > 0 || preview.templateCount > 0);

	const bulkClear = useMutation({
		mutationFn: useConvexMutation(api.shifts.bulkClearMemberSchedules),
	});

	const handleConfirm = async () => {
		if (!canPreview) return;
		setError(null);
		try {
			unwrapResult(
				await bulkClear.mutateAsync({
					restaurantId,
					memberIds: selectedMemberIds,
					scope,
					weekStartMs,
				})
			);
			onCleared?.();
			onClose();
		} catch {
			setError(t(AdminStaffKeys.SCHEDULE_CLEAR_MODAL_ERROR));
		}
	};

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			ariaLabel={t(AdminStaffKeys.SCHEDULE_CLEAR_MODAL_TITLE)}
			size="md"
		>
			<div className="bg-background rounded-xl border border-border overflow-hidden">
				<DialogHeader
					title={t(AdminStaffKeys.SCHEDULE_CLEAR_MODAL_TITLE)}
					onClose={onClose}
				/>
				<div className="p-5 space-y-4 max-h-[70dvh] overflow-y-auto">
					<MemberCheckboxList
						members={members}
						selectedIds={selectedIds}
						onToggle={toggleMember}
						onSelectAll={selectAll}
						onDeselectAll={deselectAll}
					/>

					<ScopeRadioGroup scope={scope} onScopeChange={setScope} />

					<PreviewSection
						canPreview={canPreview}
						loading={previewLoading}
						preview={preview}
						hasImpact={hasImpact}
					/>

					{error ? <p className="text-xs text-destructive">{error}</p> : null}

					<div className="flex items-center justify-end gap-2 pt-2">
						<button
							type="button"
							onClick={onClose}
							className="text-xs font-medium px-3 py-1.5 rounded-md border border-border hover:bg-(--bg-hover)"
						>
							{t(AdminStaffKeys.SCHEDULE_CLEAR_MODAL_CANCEL)}
						</button>
						<ConfirmButton
							isPending={bulkClear.isPending}
							hasImpact={hasImpact}
							preview={preview}
							onConfirm={() => void handleConfirm()}
						/>
					</div>
				</div>
			</div>
		</Modal>
	);
}

// ---------------------------------------------------------------------------
// Extracted sub-components to reduce cognitive complexity
// ---------------------------------------------------------------------------

function MemberCheckboxList({
	members,
	selectedIds,
	onToggle,
	onSelectAll,
	onDeselectAll,
}: {
	readonly members: readonly AssignableMember[];
	readonly selectedIds: ReadonlySet<string>;
	readonly onToggle: (id: string) => void;
	readonly onSelectAll: () => void;
	readonly onDeselectAll: () => void;
}) {
	const { t } = useTranslation();
	return (
		<div>
			<div className="flex items-center justify-between mb-2">
				<span className="text-xs font-medium text-foreground">
					{t(AdminStaffKeys.SCHEDULE_CLEAR_MODAL_MEMBERS_LABEL)}
				</span>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onSelectAll}
						className="text-xs text-primary hover:underline"
					>
						{t(AdminStaffKeys.SCHEDULE_CLEAR_MODAL_SELECT_ALL)}
					</button>
					<button
						type="button"
						onClick={onDeselectAll}
						className="text-xs text-primary hover:underline"
					>
						{t(AdminStaffKeys.SCHEDULE_CLEAR_MODAL_DESELECT_ALL)}
					</button>
				</div>
			</div>
			<div className="border border-border rounded-md max-h-48 overflow-y-auto">
				{members.map((m) => (
					<label
						key={m.memberId}
						className="flex items-center gap-2 px-3 py-2 hover:bg-(--bg-hover) cursor-pointer text-sm text-foreground"
					>
						<input
							type="checkbox"
							checked={selectedIds.has(m.memberId)}
							onChange={() => onToggle(m.memberId)}
							className="h-4 w-4 accent-primary"
						/>
						<MemberAvatar member={m} />
						<span className="truncate">{m.displayName || "—"}</span>
					</label>
				))}
			</div>
		</div>
	);
}

function MemberAvatar({ member }: { readonly member: AssignableMember }) {
	if (member.photoUrl) {
		return (
			<img
				src={member.photoUrl}
				alt=""
				className="w-5 h-5 rounded-full object-cover shrink-0"
			/>
		);
	}
	return (
		<span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium text-muted-foreground shrink-0">
			{(member.displayName.charAt(0) || "?").toUpperCase()}
		</span>
	);
}

function ScopeRadioGroup({
	scope,
	onScopeChange,
}: {
	readonly scope: ClearScope;
	readonly onScopeChange: (v: ClearScope) => void;
}) {
	const { t } = useTranslation();
	return (
		<fieldset>
			<legend className="text-xs font-medium text-foreground mb-2">
				{t(AdminStaffKeys.SCHEDULE_CLEAR_MODAL_SCOPE_LABEL)}
			</legend>
			<div className="flex flex-col gap-1.5">
				{SCOPE_OPTIONS.map(([value, labelKey]) => (
					<label
						key={value}
						className="flex items-center gap-2 text-sm text-foreground cursor-pointer"
					>
						<input
							type="radio"
							name="clear-scope"
							value={value}
							checked={scope === value}
							onChange={() => onScopeChange(value)}
							className="h-4 w-4 accent-primary"
						/>
						{t(labelKey)}
					</label>
				))}
			</div>
		</fieldset>
	);
}

function PreviewSection({
	canPreview,
	loading,
	preview,
	hasImpact,
}: {
	readonly canPreview: boolean;
	readonly loading: boolean;
	readonly preview: { shiftCount: number; templateCount: number } | null;
	readonly hasImpact: boolean;
}) {
	const { t } = useTranslation();
	if (!canPreview) {
		return (
			<p className="text-xs text-faint-foreground">
				{t(AdminStaffKeys.SCHEDULE_CLEAR_MODAL_NO_MEMBERS)}
			</p>
		);
	}
	if (loading) {
		return (
			<p className="text-xs text-faint-foreground animate-pulse">
				{t(AdminStaffKeys.SCHEDULE_CLEAR_MODAL_PREVIEW_LOADING)}
			</p>
		);
	}
	if (preview && !hasImpact) {
		return (
			<p className="text-xs text-faint-foreground">
				{t(AdminStaffKeys.SCHEDULE_CLEAR_MODAL_PREVIEW_NONE)}
			</p>
		);
	}
	if (preview) {
		return (
			<p className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
				{t(AdminStaffKeys.SCHEDULE_CLEAR_MODAL_PREVIEW_SUMMARY, {
					shiftCount: preview.shiftCount,
					templateCount: preview.templateCount,
				})}
			</p>
		);
	}
	return null;
}

function ConfirmButton({
	isPending,
	hasImpact,
	preview,
	onConfirm,
}: {
	readonly isPending: boolean;
	readonly hasImpact: boolean;
	readonly preview: { shiftCount: number; templateCount: number } | null;
	readonly onConfirm: () => void;
}) {
	const { t } = useTranslation();
	let label: string;
	if (isPending) {
		label = t(AdminStaffKeys.SCHEDULE_CLEAR_MODAL_CLEARING);
	} else {
		label = t(AdminStaffKeys.SCHEDULE_CLEAR_MODAL_CONFIRM, {
			shiftCount: preview?.shiftCount ?? 0,
			templateCount: preview?.templateCount ?? 0,
		});
	}
	return (
		<button
			type="button"
			onClick={onConfirm}
			disabled={!hasImpact || isPending}
			className="text-xs font-medium px-3 py-1.5 rounded-md border border-destructive bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50"
		>
			{label}
		</button>
	);
}
