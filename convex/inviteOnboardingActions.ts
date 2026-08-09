/**
 * Invite-CSV preview action.
 *
 * An action rather than a query because only actions can read a stored blob
 * (`ctx.storage.get` returns a `Blob`; queries and mutations only get URLs and
 * metadata). Actions in turn have no `ctx.db`, so the classification runs in
 * `internal.inviteOnboarding.previewInviteRowsInternal` — the same action /
 * internal-function split `menuImport.ts` uses, and for the same reason.
 *
 * No `"use node"`: parsing is plain string work and Convex's default runtime
 * supports `ctx.storage`, so this stays out of the Node bundle.
 *
 * Nothing is created here. The admin sees the per-row verdicts and then confirms
 * a subset via `inviteOnboarding.commitBulkInvitations`.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import {
	NotAuthenticatedError,
	NotAuthenticatedErrorObject,
	NotAuthorizedError,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { RoleErrorMessages } from "./_util/auth";
import { INVITE_CSV_MAX_BYTES, INVITE_CSV_MAX_ROWS } from "./constants";
import type { InvitePreviewResult } from "./inviteOnboarding";
import {
	CSV_UPLOAD_CONTENT_TYPES,
	INVITE_CSV_ERROR,
	parseInviteCsv,
} from "./inviteOnboardingHelpers";

type PreviewErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject
	| UserInputValidationErrorObject;

/** `InvitePreviewResult` plus the failure modes only the action can hit. */
type PreviewCsvResult = InvitePreviewResult | [null, PreviewErrors];

/**
 * CSV-level failures travel as `CODE` or `CODE:detail` in a single field error,
 * so the frontend can key off the stable code and still show which column or
 * limit tripped.
 */
function csvError(code: string, detail?: string): UserInputValidationErrorObject {
	return new UserInputValidationError({
		fields: [{ field: "file", message: detail ? `${code}:${detail}` : code }],
	}).toObject();
}

export const previewInviteCsv = action({
	args: { storageId: v.id("_storage") },
	handler: async (ctx, args): Promise<PreviewCsvResult> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [null, new NotAuthenticatedError().toObject()];

		// Admin is asserted BEFORE the blob is touched: a non-admin who guessed a
		// storage id must not be able to learn anything about somebody else's file,
		// not even whether it parses.
		const allowed = await ctx.runQuery(internal.inviteOnboarding.assertInviteOnboardingAdmin, {
			userId: identity.subject,
		});
		if (!allowed) {
			return [null, new NotAuthorizedError(RoleErrorMessages.ADMIN_REQUIRED).toObject()];
		}

		const blob = await ctx.storage.get(args.storageId);
		if (!blob) return [null, new NotFoundError("Uploaded file not found").toObject()];

		// The cleanup below deletes whatever `storageId` names, so refuse anything
		// that is plainly not one of our uploads before we get there. A mistyped id
		// pointing at a menu photo or an employee portrait must bounce, not be
		// destroyed. (Provenance cannot be proven — the id only exists after the
		// client has uploaded — so this narrows the blast radius rather than
		// closing it; the endpoint is admin-only.)
		if (blob.type && !CSV_UPLOAD_CONTENT_TYPES.some((type) => blob.type.startsWith(type))) {
			return [null, csvError(INVITE_CSV_ERROR.NOT_CSV)];
		}

		try {
			if (blob.size > INVITE_CSV_MAX_BYTES) {
				return [
					null,
					csvError(INVITE_CSV_ERROR.TOO_LARGE, `${Math.round(INVITE_CSV_MAX_BYTES / 1024)} KB`),
				];
			}

			const parsed = parseInviteCsv(await blob.text(), { maxRows: INVITE_CSV_MAX_ROWS });
			if (!parsed.ok) return [null, csvError(parsed.code, parsed.detail)];

			return await ctx.runQuery(internal.inviteOnboarding.previewInviteRowsInternal, {
				userId: identity.subject,
				rows: parsed.rows,
			});
		} finally {
			// The upload is a list of real people's email addresses. It has served
			// its purpose the moment it is parsed, so it is never retained — the
			// admin re-uploads to preview again.
			await ctx.storage.delete(args.storageId);
		}
	},
});
