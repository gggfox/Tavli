/**
 * Header CTA on the schedule page that flips every SCHEDULED shift in the
 * currently visible week to PUBLISHED via `convex.shifts.publishWeek`.
 *
 * Visual states:
 *   - No drafts in the visible week → button disabled with hint text.
 *   - One or more drafts → button enabled, draft count rendered as a badge.
 *   - Click → small inline confirm prompt → mutation fires and the parent
 *     refetches.
 */
import { Modal, DialogHeader } from "@/global/components";
import { AdminStaffKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface PublishWeekButtonProps {
	readonly restaurantId: Id<"restaurants">;
	readonly weekStartMs: number;
	readonly draftCount: number;
	readonly onPublished: () => void;
}

export function PublishWeekButton({
	restaurantId,
	weekStartMs,
	draftCount,
	onPublished,
}: Readonly<PublishWeekButtonProps>) {
	const { t } = useTranslation();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const publish = useMutation({
		mutationFn: useConvexMutation(api.shifts.publishWeek),
	});

	const handleConfirm = async () => {
		setError(null);
		try {
			unwrapResult(
				await publish.mutateAsync({ restaurantId, weekStartMs })
			);
			onPublished();
			setConfirmOpen(false);
		} catch (e) {
			setError(extractError(e));
		}
	};

	const disabled = draftCount === 0;

	return (
		<>
			<button
				type="button"
				onClick={() => {
					if (!disabled) setConfirmOpen(true);
				}}
				disabled={disabled}
				className="text-xs font-medium px-3 py-1.5 rounded-md border border-primary bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2"
				title={disabled ? t(AdminStaffKeys.SCHEDULE_PUBLISH_WEEK_NONE) : undefined}
			>
				{t(AdminStaffKeys.SCHEDULE_PUBLISH_WEEK)}
				{draftCount > 0 ? (
					<span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary-foreground/20 text-primary-foreground">
						{t(AdminStaffKeys.SCHEDULE_PUBLISH_WEEK_DRAFT_BADGE, { count: draftCount })}
					</span>
				) : null}
			</button>

			<Modal
				isOpen={confirmOpen}
				onClose={() => setConfirmOpen(false)}
				ariaLabel={t(AdminStaffKeys.SCHEDULE_PUBLISH_WEEK_CONFIRM)}
				size="sm"
			>
				<div className="rounded-lg bg-card border border-border overflow-hidden">
					<DialogHeader
						title={t(AdminStaffKeys.SCHEDULE_PUBLISH_WEEK_CONFIRM)}
						onClose={() => setConfirmOpen(false)}
					/>
					<div className="p-4 space-y-3 text-sm">
						<p>
							{t(AdminStaffKeys.SCHEDULE_PUBLISH_WEEK_CONFIRM_BODY, {
								count: draftCount,
							})}
						</p>
						{error ? <p className="text-xs text-destructive">{error}</p> : null}
						<div className="flex justify-end gap-2 pt-1">
							<button
								type="button"
								onClick={() => setConfirmOpen(false)}
								className="text-xs font-medium px-3 py-1.5 rounded-md border border-border hover:bg-(--bg-hover)"
							>
								{t(AdminStaffKeys.SCHEDULE_DRAWER_CANCEL)}
							</button>
							<button
								type="button"
								onClick={() => void handleConfirm()}
								disabled={publish.isPending}
								className="text-xs font-medium px-3 py-1.5 rounded-md border border-primary bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
							>
								{publish.isPending
									? t(AdminStaffKeys.SCHEDULE_PUBLISH_WEEK_PUBLISHING)
									: t(AdminStaffKeys.SCHEDULE_PUBLISH_WEEK)}
							</button>
						</div>
					</div>
				</div>
			</Modal>
		</>
	);
}

function extractError(e: unknown): string {
	if (typeof e === "object" && e != null) {
		const message = (e as { message?: unknown }).message;
		if (typeof message === "string") return message;
	}
	return "Error";
}
