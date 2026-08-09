/**
 * Presentation rules for the invitation verdicts the backend hands back.
 *
 * `convex/inviteOnboardingHelpers.ts` classifies every prospective invitation
 * into an {@link InviteRowStatus} and, for the two recoverable ones, names the
 * acknowledgement that clears it. This module is the frontend's half of that
 * contract and nothing more: status → chip, status → acknowledgement,
 * error object → stable code. It holds no state and does no I/O, so the
 * dialogs can stay about layout.
 *
 * Two rules it exists to enforce:
 *
 *   1. **Reasons are never written twice.** A blocked row's explanation always
 *      resolves through `errors.ERROR_INVITE_*` — the same key the single-invite
 *      form shows — so bulk and single can never disagree about what
 *      `cross_org` means.
 *   2. **Raw codes never reach the UI.** Everything here returns an i18n key.
 */
import type { BackendErrorCode } from "@/global/i18n";
import { ERROR_CODE_KEYS, ErrorKeys, UserOnboardingKeys } from "@/global/i18n";
import type { StatusTone } from "@/global/components";
import { extractErrorCode } from "@/global/utils";
import {
	INVITE_OVERRIDE,
	INVITE_ROW_STATUS,
	inviteRowErrorCode,
	type InviteOverride,
	type InviteRowStatus,
} from "convex/inviteOnboardingHelpers";
// TYPE-ONLY on purpose: `convex/inviteOnboarding.ts` is a Convex *function*
// module (it imports `_generated/server`), so it must never be pulled into the
// client bundle. The exhaustive `Record<InviteCommitOutcome, …>` below is what
// keeps the literals below honest — rename an outcome server-side and this
// file stops compiling.
import type { InviteCommitOutcome } from "convex/inviteOnboarding";

export interface InviteChip {
	readonly labelKey: string;
	readonly tone: StatusTone;
}

const STATUS_CHIPS: Readonly<Record<string, InviteChip>> = {
	[INVITE_ROW_STATUS.OK]: { labelKey: UserOnboardingKeys.STATUS_OK, tone: "success" },
	[INVITE_ROW_STATUS.ALREADY_MEMBER]: {
		labelKey: UserOnboardingKeys.STATUS_ALREADY_MEMBER,
		tone: "info",
	},
	[INVITE_ROW_STATUS.CROSS_ORG]: {
		labelKey: UserOnboardingKeys.STATUS_CROSS_ORG,
		tone: "warning",
	},
	[INVITE_ROW_STATUS.DUPLICATE_PENDING]: {
		labelKey: UserOnboardingKeys.STATUS_DUPLICATE_PENDING,
		tone: "warning",
	},
	[INVITE_ROW_STATUS.DUPLICATE_IN_FILE]: {
		labelKey: UserOnboardingKeys.STATUS_DUPLICATE_IN_FILE,
		tone: "neutral",
	},
};

/**
 * Chip for one row verdict. Every `invalid_*` status collapses to a single
 * "can't be sent" chip on purpose — the chip says whether the row is going out,
 * the reason column says why not, and eleven differently-worded red chips would
 * make a 500-row table unreadable.
 */
export function inviteStatusChip(status: InviteRowStatus): InviteChip {
	return STATUS_CHIPS[status] ?? { labelKey: UserOnboardingKeys.STATUS_INVALID, tone: "danger" };
}

/** Client-side mirror of `INVITE_COMMIT_OUTCOME`, kept honest by the map below. */
export const INVITE_OUTCOME = {
	CREATED: "created",
	SKIPPED: "skipped",
	FAILED: "failed",
} as const satisfies Record<string, InviteCommitOutcome>;

const OUTCOME_CHIPS: Readonly<Record<InviteCommitOutcome, InviteChip>> = {
	[INVITE_OUTCOME.CREATED]: {
		labelKey: UserOnboardingKeys.OUTCOME_CREATED,
		tone: "success",
	},
	[INVITE_OUTCOME.SKIPPED]: {
		labelKey: UserOnboardingKeys.OUTCOME_SKIPPED,
		tone: "warning",
	},
	[INVITE_OUTCOME.FAILED]: { labelKey: UserOnboardingKeys.OUTCOME_FAILED, tone: "danger" },
};

export function inviteOutcomeChip(outcome: InviteCommitOutcome): InviteChip {
	return OUTCOME_CHIPS[outcome] ?? { labelKey: UserOnboardingKeys.OUTCOME_FAILED, tone: "danger" };
}

/**
 * The acknowledgement copy for an override, so the checkbox that unlocks a
 * blocked row reads the same in the single form and in the bulk preview.
 */
export const OVERRIDE_COPY: Readonly<
	Record<InviteOverride, { titleKey: string; bodyKey: string; acknowledgeKey: string }>
> = {
	[INVITE_OVERRIDE.ACKNOWLEDGE_ORG_MOVE]: {
		titleKey: UserOnboardingKeys.CROSS_ORG_TITLE,
		bodyKey: UserOnboardingKeys.CROSS_ORG_BODY,
		acknowledgeKey: UserOnboardingKeys.CROSS_ORG_ACK,
	},
	[INVITE_OVERRIDE.REPLACE_EXISTING_PENDING]: {
		titleKey: UserOnboardingKeys.REPLACE_PENDING_TITLE,
		bodyKey: UserOnboardingKeys.REPLACE_PENDING_BODY,
		acknowledgeKey: UserOnboardingKeys.REPLACE_PENDING_ACK,
	},
};

/**
 * Which acknowledgement (if any) would let a rejected single invite through.
 *
 * The single-invite form has no pre-flight classification endpoint — the only
 * public entry point is the mutation itself — so a `cross_org` or
 * `duplicate_pending` verdict arrives as a *rejection*. Mapping the rejection
 * back to its override is what turns "computer says no" into a checkbox the
 * admin can consciously tick and re-send.
 */
const OVERRIDE_BY_ERROR_CODE: Readonly<Record<string, InviteOverride>> = {
	[inviteRowErrorCode(INVITE_ROW_STATUS.CROSS_ORG)]: INVITE_OVERRIDE.ACKNOWLEDGE_ORG_MOVE,
	[inviteRowErrorCode(INVITE_ROW_STATUS.DUPLICATE_PENDING)]:
		INVITE_OVERRIDE.REPLACE_EXISTING_PENDING,
};

export function overrideForErrorCode(code: string | null | undefined): InviteOverride | null {
	if (!code) return null;
	return OVERRIDE_BY_ERROR_CODE[code] ?? null;
}

/** The `errors.*` key for a stable code, falling back to the generic message. */
export function inviteReasonKey(code: string | null | undefined): string {
	if (!code) return ErrorKeys.GENERIC;
	return ERROR_CODE_KEYS[code as BackendErrorCode] ?? ErrorKeys.GENERIC;
}

export interface InviteFailure {
	/** `null` when nothing recognizable came back — the UI shows the generic message. */
	readonly code: BackendErrorCode | null;
	/**
	 * The free-form suffix the backend appends after `CODE:` on file-level CSV
	 * failures — a column name, a row cap, a byte cap. `null` when absent.
	 */
	readonly detail: string | null;
}

/** Every string on an error object that might carry a stable code. */
function candidateStrings(error: unknown): string[] {
	if (typeof error === "string") return [error];
	if (!error || typeof error !== "object") return [];

	const record = error as Record<string, unknown>;
	const out: string[] = [];
	if (typeof record.message === "string") out.push(record.message);
	if (Array.isArray(record.fields)) {
		for (const field of record.fields) {
			const message = (field as Record<string, unknown> | null)?.message;
			if (typeof message === "string") out.push(message);
		}
	}
	return out;
}

/**
 * Split a caught value (or a returned Convex error object) into its stable code
 * and the detail the backend attached to it.
 *
 * `extractErrorCode` already handles every shape a code can arrive in; this adds
 * only the `CODE:detail` convention `previewInviteCsv` uses, which would
 * otherwise be thrown away and leave the admin reading "your file is missing a
 * required column" without being told which one.
 */
export function readInviteFailure(error: unknown): InviteFailure {
	const code = extractErrorCode(error);
	if (!code) return { code: null, detail: null };

	const needle = `${code}:`;
	for (const candidate of candidateStrings(error)) {
		const at = candidate.indexOf(needle);
		if (at === -1) continue;
		const detail = candidate.slice(at + needle.length).trim();
		if (detail.length > 0) return { code, detail };
	}
	return { code, detail: null };
}
