/**
 * Bulk onboarding: upload a CSV, review every row, send the ones you accept.
 *
 * The shape mirrors the menu-import dialog (dropzone → preview → confirm →
 * result) because admins already know that flow, but the stakes are different:
 * a menu row that goes wrong is a wrong price, an invitation row that goes
 * wrong emails a stranger or moves a real person out of their organization.
 * So three things are non-negotiable here and are what most of this file is
 * about:
 *
 *   1. **Nothing is created before Confirm.** Preview only classifies.
 *   2. **A dangerous row is opt-in, never opt-out.** Rows the backend flagged
 *      `cross_org` or `duplicate_pending` start unticked; ticking one IS the
 *      acknowledgement that unlocks it, and the payload carries that flag.
 *   3. **The run is reported honestly.** Per-row created / skipped / failed,
 *      with reasons, copyable and downloadable so a big file can be fixed and
 *      re-uploaded rather than re-typed.
 */
import { DialogHeader, getStatusToneStyle, Modal, StatusBadge } from "@/global/components";
import { UserOnboardingKeys } from "@/global/i18n";
import type { Id } from "convex/_generated/dataModel";
import { INVITE_CSV_MAX_BYTES, INVITE_CSV_MAX_ROWS } from "convex/constants";
// Type-only: `convex/inviteOnboarding.ts` is a Convex function module and must
// not reach the client bundle. Its runtime vocabulary is mirrored in
// `../../utils/inviteVerdicts` (`INVITE_OUTCOME`).
import type { InvitePreviewRow } from "convex/inviteOnboarding";
import { INVITE_OVERRIDE, type InviteRole } from "convex/inviteOnboardingHelpers";
import { AlertTriangle, Loader2, Upload } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBulkInvite, type BulkInviteSubmission } from "../../hooks/useBulkInvite";
import {
	buildInviteCsvTemplate,
	buildInviteProblemCsv,
	downloadCsv,
	INVITE_CSV_TEMPLATE_FILENAME,
	INVITE_PROBLEM_CSV_FILENAME,
} from "../../utils/inviteCsv";
import {
	INVITE_OUTCOME,
	inviteOutcomeChip,
	inviteReasonKey,
	inviteStatusChip,
	type InviteChip,
} from "../../utils/inviteVerdicts";

const ROLE_LABEL_KEYS: Readonly<Record<string, string>> = {
	owner: UserOnboardingKeys.ROLE_OWNER,
	manager: UserOnboardingKeys.ROLE_MANAGER,
	employee: UserOnboardingKeys.ROLE_EMPLOYEE,
};

export interface BulkInviteDialogProps {
	readonly isOpen: boolean;
	readonly onClose: () => void;
}

/** A row the admin is allowed to tick: sendable as-is, or unlockable by an acknowledgement. */
function isSelectable(row: InvitePreviewRow): boolean {
	return !row.blocked || row.override !== null;
}

function Chip({ labelKey, tone }: Readonly<InviteChip>) {
	const { t } = useTranslation();
	const style = getStatusToneStyle(tone);
	return <StatusBadge bgColor={style.tintedBg} textColor={style.fg} label={t(labelKey)} />;
}

export function BulkInviteDialog({ isOpen, onClose }: Readonly<BulkInviteDialogProps>) {
	const { t } = useTranslation();
	const fileInputRef = useRef<HTMLInputElement>(null);

	const {
		step,
		preview,
		report,
		failure,
		progress,
		uploadAndPreview,
		commit,
		reset,
		backToUpload,
	} = useBulkInvite();

	/** Row numbers the admin has ticked. Nothing is ticked by default. */
	const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
	const [localErrorKey, setLocalErrorKey] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const rows = useMemo(() => preview?.rows ?? [], [preview]);

	const selectableRows = useMemo(() => rows.filter(isSelectable), [rows]);
	const safeRows = useMemo(() => rows.filter((row) => !row.blocked), [rows]);
	const crossOrgRows = useMemo(
		() => rows.filter((row) => row.override === INVITE_OVERRIDE.ACKNOWLEDGE_ORG_MOVE),
		[rows]
	);
	const selectedCrossOrgCount = crossOrgRows.filter((row) => selected.has(row.rowNumber)).length;

	const handleClose = useCallback(() => {
		// Committing writes real invitations chunk by chunk; letting the dialog
		// vanish mid-run would hide a result the admin needs to see.
		if (step === "committing") return;
		reset();
		setSelected(new Set());
		setLocalErrorKey(null);
		setCopied(false);
		onClose();
	}, [step, reset, onClose]);

	const handleFile = useCallback(
		(file: File | undefined) => {
			if (!file) return;
			const looksLikeCsv =
				file.name.toLowerCase().endsWith(".csv") ||
				file.type === "text/csv" ||
				file.type === "application/csv";
			if (!looksLikeCsv) {
				setLocalErrorKey(UserOnboardingKeys.BULK_NOT_CSV);
				return;
			}
			setLocalErrorKey(null);
			setSelected(new Set());
			void uploadAndPreview(file);
		},
		[uploadAndPreview]
	);

	const toggleRow = useCallback((rowNumber: number) => {
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(rowNumber)) next.delete(rowNumber);
			else next.add(rowNumber);
			return next;
		});
	}, []);

	const selectAllSafe = useCallback(() => {
		setSelected(new Set(safeRows.map((row) => row.rowNumber)));
	}, [safeRows]);

	const acknowledgeAllCrossOrg = useCallback(() => {
		setSelected((current) => {
			const next = new Set(current);
			for (const row of crossOrgRows) next.add(row.rowNumber);
			return next;
		});
	}, [crossOrgRows]);

	const submissions: BulkInviteSubmission[] = useMemo(
		() =>
			selectableRows
				.filter((row) => selected.has(row.rowNumber))
				.flatMap((row) => {
					// A selectable row always resolved its role and organization; the
					// guard keeps that promise checkable rather than asserted.
					if (row.role === null || row.organizationId === null) return [];
					return [
						{
							rowNumber: row.rowNumber,
							email: row.email,
							role: row.role as InviteRole,
							organizationId: row.organizationId as Id<"organizations">,
							restaurantIds: row.restaurantIds as Id<"restaurants">[],
							...(row.firstName && { firstName: row.firstName }),
							...(row.paternalLastname && { paternalLastname: row.paternalLastname }),
							...(row.maternalLastname && { maternalLastname: row.maternalLastname }),
							...(row.override === INVITE_OVERRIDE.ACKNOWLEDGE_ORG_MOVE && {
								acknowledgeOrgMove: true,
							}),
							...(row.override === INVITE_OVERRIDE.REPLACE_EXISTING_PENDING && {
								replaceExistingPending: true,
							}),
						},
					];
				}),
		[selectableRows, selected]
	);

	const problemRows = useMemo(
		() =>
			(report?.results ?? [])
				.filter((row) => row.outcome !== INVITE_OUTCOME.CREATED)
				.map((row) => ({
					rowNumber: row.rowNumber,
					email: row.email,
					outcome: t(inviteOutcomeChip(row.outcome).labelKey),
					reason: t(inviteReasonKey(row.code)),
				})),
		[report, t]
	);

	const problemCsv = useCallback(
		() =>
			buildInviteProblemCsv(problemRows, {
				row: t(UserOnboardingKeys.BULK_COL_ROW),
				email: t(UserOnboardingKeys.BULK_COL_EMAIL),
				outcome: t(UserOnboardingKeys.BULK_COL_OUTCOME),
				reason: t(UserOnboardingKeys.BULK_COL_REASON),
			}),
		[problemRows, t]
	);

	const handleCopyProblems = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(problemCsv());
			setCopied(true);
		} catch {
			// Clipboard access can be denied; the download button is the fallback.
			setCopied(false);
		}
	}, [problemCsv]);

	const failureMessage = failure
		? t(inviteReasonKey(failure.code), { detail: failure.detail ?? "" })
		: null;

	return (
		<Modal
			isOpen={isOpen}
			onClose={handleClose}
			ariaLabel={t(UserOnboardingKeys.BULK_TITLE)}
			size="5xl"
		>
			<div className="bg-surface rounded-xl flex flex-col max-h-[88vh]">
				<DialogHeader
					title={t(UserOnboardingKeys.BULK_TITLE)}
					subtitle={t(UserOnboardingKeys.BULK_SUBTITLE)}
					onClose={handleClose}
					closeAriaLabel={t(UserOnboardingKeys.CLOSE)}
				/>

				<div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">
					{(step === "idle" || step === "error") && (
						<>
							<button
								type="button"
								className="w-full border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary hover:bg-hover transition-colors"
								onClick={() => fileInputRef.current?.click()}
								onDragOver={(event) => event.preventDefault()}
								onDrop={(event) => {
									event.preventDefault();
									handleFile(event.dataTransfer.files[0]);
								}}
							>
								<Upload className="mx-auto mb-3 text-muted-foreground" size={32} aria-hidden />
								<p className="text-sm font-medium text-foreground">
									{t(UserOnboardingKeys.BULK_DROPZONE_LABEL)}
								</p>
								<p className="text-xs text-muted-foreground mt-1">
									{t(UserOnboardingKeys.BULK_DROPZONE_HINT)}
								</p>
							</button>
							<input
								ref={fileInputRef}
								type="file"
								className="hidden"
								accept=".csv,text/csv"
								data-testid="bulk-invite-file-input"
								onChange={(event) => handleFile(event.target.files?.[0])}
							/>

							<button
								type="button"
								onClick={() => downloadCsv(INVITE_CSV_TEMPLATE_FILENAME, buildInviteCsvTemplate())}
								className="text-sm font-medium text-primary hover:underline"
							>
								{t(UserOnboardingKeys.BULK_TEMPLATE_DOWNLOAD)}
							</button>

							<div className="rounded-md border border-border p-3 space-y-1">
								<p className="text-xs font-medium text-foreground">
									{t(UserOnboardingKeys.BULK_FORMAT_TITLE)}
								</p>
								<ul className="text-xs text-muted-foreground space-y-1">
									<li>{t(UserOnboardingKeys.BULK_FORMAT_REQUIRED)}</li>
									<li>{t(UserOnboardingKeys.BULK_FORMAT_OPTIONAL)}</li>
									<li>{t(UserOnboardingKeys.BULK_FORMAT_ROLES)}</li>
									<li>{t(UserOnboardingKeys.BULK_FORMAT_ORGANIZATION)}</li>
									<li>{t(UserOnboardingKeys.BULK_FORMAT_RESTAURANTS)}</li>
									<li>
										{t(UserOnboardingKeys.BULK_FORMAT_LIMITS, {
											maxRows: INVITE_CSV_MAX_ROWS,
											maxKilobytes: Math.round(INVITE_CSV_MAX_BYTES / 1024),
										})}
									</li>
								</ul>
							</div>

							{localErrorKey !== null && (
								<p className="text-sm text-destructive">{t(localErrorKey)}</p>
							)}
							{step === "error" && failureMessage !== null && (
								<p className="text-sm text-destructive">{failureMessage}</p>
							)}
						</>
					)}

					{(step === "uploading" || step === "validating" || step === "committing") && (
						<div className="flex flex-col items-center justify-center py-12 gap-3">
							<Loader2 className="animate-spin text-primary" size={32} aria-hidden />
							<p className="text-sm text-muted-foreground">
								{step === "uploading" && t(UserOnboardingKeys.BULK_UPLOADING)}
								{step === "validating" && t(UserOnboardingKeys.BULK_VALIDATING)}
								{step === "committing" &&
									t(UserOnboardingKeys.BULK_COMMITTING, {
										done: progress.done,
										total: progress.total,
									})}
							</p>
						</div>
					)}

					{step === "preview" && preview && (
						<>
							<div className="flex flex-wrap items-center gap-3">
								<h3 className="text-sm font-medium text-foreground">
									{t(UserOnboardingKeys.BULK_PREVIEW_TITLE)}
								</h3>
								<span className="text-xs text-muted-foreground">
									{t(UserOnboardingKeys.BULK_SUMMARY_TOTAL, { count: preview.counts.total })}
								</span>
								<span className="text-xs text-muted-foreground">
									{t(UserOnboardingKeys.BULK_SUMMARY_SELECTED, { count: submissions.length })}
								</span>
								<div className="ml-auto flex items-center gap-2">
									<button
										type="button"
										onClick={selectAllSafe}
										className="text-xs font-medium px-2 py-1 rounded-md border border-border text-foreground hover:bg-hover"
									>
										{t(UserOnboardingKeys.BULK_SELECT_ALL_SAFE)}
									</button>
									<button
										type="button"
										onClick={() => setSelected(new Set())}
										className="text-xs font-medium px-2 py-1 rounded-md border border-border text-foreground hover:bg-hover"
									>
										{t(UserOnboardingKeys.BULK_CLEAR_SELECTION)}
									</button>
								</div>
							</div>

							<p className="text-xs text-muted-foreground">
								{t(UserOnboardingKeys.BULK_PREVIEW_NOTHING_CREATED)}
							</p>

							{crossOrgRows.length > 0 && (
								<div className="rounded-md border border-warning/40 bg-warning-subtle p-3 flex flex-wrap items-center gap-3">
									<AlertTriangle className="shrink-0 text-warning" size={16} aria-hidden />
									<p className="text-xs text-foreground flex-1 min-w-[16rem]">
										{t(UserOnboardingKeys.BULK_CROSS_ORG_BANNER, { count: crossOrgRows.length })}
									</p>
									<button
										type="button"
										onClick={acknowledgeAllCrossOrg}
										disabled={selectedCrossOrgCount === crossOrgRows.length}
										className="text-xs font-medium px-2 py-1 rounded-md border border-warning/60 text-foreground hover:bg-hover disabled:opacity-50"
									>
										{t(UserOnboardingKeys.BULK_ACK_ALL_CROSS_ORG, { count: crossOrgRows.length })}
									</button>
								</div>
							)}

							<div className="overflow-x-auto border border-border rounded-lg">
								<table className="w-full text-sm">
									<thead className="bg-muted">
										<tr>
											<th className="text-left px-3 py-2 font-medium text-foreground">
												{t(UserOnboardingKeys.BULK_COL_INCLUDE)}
											</th>
											<th className="text-left px-3 py-2 font-medium text-foreground">
												{t(UserOnboardingKeys.BULK_COL_ROW)}
											</th>
											<th className="text-left px-3 py-2 font-medium text-foreground">
												{t(UserOnboardingKeys.BULK_COL_EMAIL)}
											</th>
											<th className="text-left px-3 py-2 font-medium text-foreground">
												{t(UserOnboardingKeys.BULK_COL_ROLE)}
											</th>
											<th className="text-left px-3 py-2 font-medium text-foreground">
												{t(UserOnboardingKeys.BULK_COL_ORGANIZATION)}
											</th>
											<th className="text-left px-3 py-2 font-medium text-foreground">
												{t(UserOnboardingKeys.BULK_COL_RESTAURANTS)}
											</th>
											<th className="text-left px-3 py-2 font-medium text-foreground">
												{t(UserOnboardingKeys.BULK_COL_STATUS)}
											</th>
											<th className="text-left px-3 py-2 font-medium text-foreground">
												{t(UserOnboardingKeys.BULK_COL_REASON)}
											</th>
										</tr>
									</thead>
									<tbody>
										{rows.map((row) => {
											const chip = inviteStatusChip(row.status);
											const selectable = isSelectable(row);
											return (
												<tr key={row.rowNumber} className="border-t border-border align-top">
													<td className="px-3 py-2">
														{selectable ? (
															<input
																type="checkbox"
																checked={selected.has(row.rowNumber)}
																onChange={() => toggleRow(row.rowNumber)}
																aria-label={t(UserOnboardingKeys.BULK_ROW_INCLUDE_ARIA, {
																	email: row.email,
																})}
															/>
														) : (
															<span className="text-faint-foreground" aria-hidden>
																—
															</span>
														)}
													</td>
													<td className="px-3 py-2 text-muted-foreground tabular-nums">
														{row.rowNumber}
													</td>
													<td className="px-3 py-2 text-foreground break-all">{row.email}</td>
													<td className="px-3 py-2 text-muted-foreground">
														{row.role ? t(ROLE_LABEL_KEYS[row.role] ?? row.role) : "—"}
													</td>
													<td className="px-3 py-2 text-muted-foreground">
														{row.organizationName ?? "—"}
													</td>
													<td className="px-3 py-2 text-muted-foreground">
														{row.restaurantNames.length > 0 ? row.restaurantNames.join(", ") : "—"}
													</td>
													<td className="px-3 py-2">
														<Chip labelKey={chip.labelKey} tone={chip.tone} />
													</td>
													<td className="px-3 py-2 text-xs text-muted-foreground">
														{row.errorCode !== null ? t(inviteReasonKey(row.errorCode)) : "—"}
														{row.blocked && row.override === null && (
															<span className="block mt-0.5 text-faint-foreground">
																{t(UserOnboardingKeys.BULK_ROW_NOT_SENDABLE)}
															</span>
														)}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						</>
					)}

					{step === "report" && report && (
						<>
							<div className="flex flex-wrap items-center gap-3">
								<h3 className="text-sm font-medium text-foreground">
									{t(UserOnboardingKeys.BULK_REPORT_TITLE)}
								</h3>
								<span className="text-xs text-muted-foreground">
									{t(UserOnboardingKeys.BULK_REPORT_SUMMARY, {
										created: report.counts.created,
										skipped: report.counts.skipped,
										failed: report.counts.failed,
									})}
								</span>
							</div>

							{report.stoppedEarly !== null && (
								<p className="text-sm text-destructive">
									{t(UserOnboardingKeys.BULK_REPORT_PARTIAL)}
									{failureMessage !== null && ` ${failureMessage}`}
								</p>
							)}

							{/*
							 * "Every selected row was sent" is only true when the run
							 * actually reached every row. A run that died on its first
							 * chunk also has no problem rows, and claiming success there
							 * would be a lie about invitations that were never attempted.
							 */}
							{problemRows.length === 0 && report.stoppedEarly === null ? (
								<p className="text-sm text-muted-foreground">
									{t(UserOnboardingKeys.BULK_REPORT_ALL_GOOD)}
								</p>
							) : problemRows.length === 0 ? null : (
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={() => void handleCopyProblems()}
										className="text-xs font-medium px-2 py-1 rounded-md border border-border text-foreground hover:bg-hover"
									>
										{copied
											? t(UserOnboardingKeys.BULK_REPORT_COPIED)
											: t(UserOnboardingKeys.BULK_REPORT_COPY)}
									</button>
									<button
										type="button"
										onClick={() => downloadCsv(INVITE_PROBLEM_CSV_FILENAME, problemCsv())}
										className="text-xs font-medium px-2 py-1 rounded-md border border-border text-foreground hover:bg-hover"
									>
										{t(UserOnboardingKeys.BULK_REPORT_DOWNLOAD)}
									</button>
								</div>
							)}

							<div className="overflow-x-auto border border-border rounded-lg">
								<table className="w-full text-sm">
									<thead className="bg-muted">
										<tr>
											<th className="text-left px-3 py-2 font-medium text-foreground">
												{t(UserOnboardingKeys.BULK_COL_ROW)}
											</th>
											<th className="text-left px-3 py-2 font-medium text-foreground">
												{t(UserOnboardingKeys.BULK_COL_EMAIL)}
											</th>
											<th className="text-left px-3 py-2 font-medium text-foreground">
												{t(UserOnboardingKeys.BULK_COL_OUTCOME)}
											</th>
											<th className="text-left px-3 py-2 font-medium text-foreground">
												{t(UserOnboardingKeys.BULK_COL_REASON)}
											</th>
										</tr>
									</thead>
									<tbody>
										{report.results.map((row) => {
											const chip = inviteOutcomeChip(row.outcome);
											return (
												<tr key={row.rowNumber} className="border-t border-border">
													<td className="px-3 py-2 text-muted-foreground tabular-nums">
														{row.rowNumber}
													</td>
													<td className="px-3 py-2 text-foreground break-all">{row.email}</td>
													<td className="px-3 py-2">
														<Chip labelKey={chip.labelKey} tone={chip.tone} />
													</td>
													<td className="px-3 py-2 text-xs text-muted-foreground">
														{row.code !== null ? t(inviteReasonKey(row.code)) : "—"}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						</>
					)}
				</div>

				<div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
					{step === "preview" && (
						<>
							<button
								type="button"
								onClick={backToUpload}
								className="text-sm font-medium px-3 py-1.5 rounded-md border border-border text-foreground hover:bg-hover"
							>
								{t(UserOnboardingKeys.BACK)}
							</button>
							<button
								type="button"
								onClick={handleClose}
								className="text-sm font-medium px-3 py-1.5 rounded-md border border-border text-foreground hover:bg-hover"
							>
								{t(UserOnboardingKeys.CANCEL)}
							</button>
							<button
								type="button"
								onClick={() => void commit(submissions)}
								disabled={submissions.length === 0}
								title={
									submissions.length === 0
										? t(UserOnboardingKeys.BULK_CONFIRM_NONE_SELECTED)
										: undefined
								}
								className="text-sm font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
							>
								{t(UserOnboardingKeys.BULK_CONFIRM, { count: submissions.length })}
							</button>
						</>
					)}

					{step === "report" && (
						<>
							<button
								type="button"
								onClick={() => {
									setSelected(new Set());
									setCopied(false);
									backToUpload();
								}}
								className="text-sm font-medium px-3 py-1.5 rounded-md border border-border text-foreground hover:bg-hover"
							>
								{t(UserOnboardingKeys.BULK_RETRY)}
							</button>
							<button
								type="button"
								onClick={handleClose}
								className="text-sm font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90"
							>
								{t(UserOnboardingKeys.DONE)}
							</button>
						</>
					)}

					{step !== "preview" && step !== "report" && (
						<button
							type="button"
							onClick={handleClose}
							disabled={step === "committing"}
							className="text-sm font-medium px-3 py-1.5 rounded-md border border-border text-foreground hover:bg-hover disabled:opacity-50"
						>
							{t(UserOnboardingKeys.CANCEL)}
						</button>
					)}
				</div>
			</div>
		</Modal>
	);
}
