/**
 * The bulk-onboarding state machine: upload → validate → preview → commit →
 * report.
 *
 * Shaped after `useMenuImport`, with three differences the domain forces:
 *
 *   - **Preview creates nothing.** `previewInviteCsv` classifies and then
 *     deletes the uploaded blob. Cancelling from the preview leaves no trace,
 *     which is what makes "review every row before sending" honest.
 *   - **The admin picks the rows.** Only the submissions handed to
 *     {@link UseBulkInviteResult.commit} are sent, and each carries its own
 *     acknowledgement flags. The server re-classifies every one of them anyway.
 *   - **Commit is chunked.** `commitBulkInvitations` caps a call at
 *     `INVITE_BULK_COMMIT_MAX_ROWS`, so a 500-row file walks through in five
 *     transactions tied together by one `bulkImportId`. A chunk that fails stops
 *     the run and still reports what the earlier chunks did — invitations
 *     already sent are real and must not be hidden.
 */
import { useConvexAction, useConvexMutation } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { INVITE_BULK_COMMIT_MAX_ROWS } from "convex/constants";
import type {
	InviteCommitOutcome,
	InvitePreviewCounts,
	InvitePreviewRow,
} from "convex/inviteOnboarding";
import type { InviteRole } from "convex/inviteOnboardingHelpers";
import { useCallback, useState } from "react";
import { readInviteFailure, type InviteFailure } from "../utils/inviteVerdicts";

export type BulkInviteStep =
	| "idle"
	| "uploading"
	| "validating"
	| "preview"
	| "committing"
	| "report"
	| "error";

export interface BulkInvitePreview {
	readonly rows: InvitePreviewRow[];
	readonly counts: InvitePreviewCounts;
}

/** One row the admin confirmed, in the shape `commitBulkInvitations` accepts. */
export interface BulkInviteSubmission {
	readonly rowNumber: number;
	readonly email: string;
	readonly role: InviteRole;
	readonly organizationId: Id<"organizations">;
	readonly restaurantIds: Id<"restaurants">[];
	readonly firstName?: string;
	readonly paternalLastname?: string;
	readonly maternalLastname?: string;
	readonly acknowledgeOrgMove?: boolean;
	readonly replaceExistingPending?: boolean;
}

export interface BulkInviteResultRow {
	readonly rowNumber: number;
	readonly email: string;
	readonly outcome: InviteCommitOutcome;
	readonly status: string;
	readonly code: string | null;
	readonly invitationId: string | null;
}

export interface BulkInviteReport {
	readonly results: BulkInviteResultRow[];
	readonly counts: { requested: number; created: number; skipped: number; failed: number };
	/** How many rows the admin confirmed, whether or not the run reached them. */
	readonly requestedTotal: number;
	/** Set when a chunk failed outright and the run stopped early. */
	readonly stoppedEarly: InviteFailure | null;
}

export interface UseBulkInviteResult {
	readonly step: BulkInviteStep;
	readonly preview: BulkInvitePreview | null;
	readonly report: BulkInviteReport | null;
	readonly failure: InviteFailure | null;
	/** Rows committed so far, out of the confirmed total. */
	readonly progress: { done: number; total: number };
	readonly uploadAndPreview: (file: File) => Promise<void>;
	readonly commit: (rows: readonly BulkInviteSubmission[]) => Promise<void>;
	readonly reset: () => void;
	readonly backToUpload: () => void;
}

function chunk<T>(rows: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
	return out;
}

export function useBulkInvite(): UseBulkInviteResult {
	const [step, setStep] = useState<BulkInviteStep>("idle");
	const [preview, setPreview] = useState<BulkInvitePreview | null>(null);
	const [report, setReport] = useState<BulkInviteReport | null>(null);
	const [failure, setFailure] = useState<InviteFailure | null>(null);
	const [progress, setProgress] = useState({ done: 0, total: 0 });

	const generateUploadUrl = useConvexMutation(api.inviteOnboarding.generateInviteUploadUrl);
	const previewCsv = useConvexAction(api.inviteOnboardingActions.previewInviteCsv);
	const commitRows = useConvexMutation(api.inviteOnboarding.commitBulkInvitations);

	const reset = useCallback(() => {
		setStep("idle");
		setPreview(null);
		setReport(null);
		setFailure(null);
		setProgress({ done: 0, total: 0 });
	}, []);

	/** Back to the dropzone, keeping nothing from the file just reviewed. */
	const backToUpload = useCallback(() => {
		setStep("idle");
		setPreview(null);
		setFailure(null);
	}, []);

	const uploadAndPreview = useCallback(
		async (file: File) => {
			setFailure(null);
			setReport(null);
			setStep("uploading");

			try {
				const [uploadUrl, urlError] = await generateUploadUrl({});
				if (urlError) {
					setFailure(readInviteFailure(urlError));
					setStep("error");
					return;
				}

				const response = await fetch(uploadUrl, {
					method: "POST",
					headers: { "Content-Type": file.type || "text/csv" },
					body: file,
				});
				if (!response.ok) throw new Error("upload failed");
				const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };

				setStep("validating");
				const [data, previewError] = await previewCsv({ storageId });
				if (previewError) {
					setFailure(readInviteFailure(previewError));
					setStep("error");
					return;
				}

				setPreview(data);
				setStep("preview");
			} catch (thrown) {
				setFailure(readInviteFailure(thrown));
				setStep("error");
			}
		},
		[generateUploadUrl, previewCsv]
	);

	const commit = useCallback(
		async (rows: readonly BulkInviteSubmission[]) => {
			if (rows.length === 0) return;

			setFailure(null);
			setStep("committing");
			setProgress({ done: 0, total: rows.length });

			const results: BulkInviteResultRow[] = [];
			const counts = { requested: 0, created: 0, skipped: 0, failed: 0 };
			let bulkImportId: string | undefined;
			let stoppedEarly: InviteFailure | null = null;

			for (const batch of chunk(rows, INVITE_BULK_COMMIT_MAX_ROWS)) {
				try {
					const [data, error] = await commitRows({ rows: [...batch], bulkImportId });
					if (error) {
						stoppedEarly = readInviteFailure(error);
						break;
					}
					bulkImportId = data.bulkImportId;
					results.push(...data.results);
					counts.requested += data.counts.requested;
					counts.created += data.counts.created;
					counts.skipped += data.counts.skipped;
					counts.failed += data.counts.failed;
					setProgress({ done: results.length, total: rows.length });
				} catch (thrown) {
					stoppedEarly = readInviteFailure(thrown);
					break;
				}
			}

			// Even a run that died on its first chunk gets a report: "nothing was
			// created, here is why" is a result, and dropping back to an error
			// screen would hide the invitations a later chunk had already sent.
			setReport({ results, counts, requestedTotal: rows.length, stoppedEarly });
			setFailure(stoppedEarly);
			setStep("report");
		},
		[commitRows]
	);

	return {
		step,
		preview,
		report,
		failure,
		progress,
		uploadAndPreview,
		commit,
		reset,
		backToUpload,
	};
}
