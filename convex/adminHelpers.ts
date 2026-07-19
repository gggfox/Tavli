/**
 * Pure decision logic for the guarded first-admin bootstrap
 * (see `bootstrapFirstAdmin` in `convex/admin.ts`, ticket TAVLI-51).
 *
 * Extracted so the fail-closed guards can be unit-tested without a Convex
 * runtime. The `internalMutation` is a thin shell: it reads state, calls
 * `decideAdminBootstrap`, and applies the result. All privilege decisions
 * live here.
 */
import { USER_ROLES, type UserRole } from "./constants";

/**
 * Stable refusal codes surfaced by the bootstrap decision. They are operator-
 * facing (thrown from an `internalMutation` invoked via `npx convex run`), not
 * mapped to i18n, but follow the same `ERROR_*` code convention as the rest of
 * the backend.
 */
export const ADMIN_BOOTSTRAP_REFUSAL = {
	/** `ALLOW_ADMIN_BOOTSTRAP` opt-in env flag is not set — inert by default. */
	DISABLED: "ERROR_ADMIN_BOOTSTRAP_DISABLED",
	/** At least one owner/admin already exists — this is strictly first-admin. */
	ALREADY_INITIALIZED: "ERROR_ADMIN_BOOTSTRAP_ALREADY_INITIALIZED",
	/** No `userRoles` row matched the target email / Clerk subject. */
	USER_NOT_FOUND: "ERROR_ADMIN_BOOTSTRAP_USER_NOT_FOUND",
} as const;

export type AdminBootstrapRefusal =
	(typeof ADMIN_BOOTSTRAP_REFUSAL)[keyof typeof ADMIN_BOOTSTRAP_REFUSAL];

/** Minimal shape of a `userRoles` row the decision needs. */
export interface BootstrapRoleRow {
	roles?: readonly UserRole[];
}

/** The matched target row, echoing its id so the caller can patch it. */
export interface BootstrapTargetRow extends BootstrapRoleRow {
	_id: string;
}

export type AdminBootstrapDecision =
	| {
			ok: true;
			targetRowId: string;
			nextRoles: UserRole[];
			previousRoles: UserRole[];
	  }
	| { ok: false; reason: AdminBootstrapRefusal };

/** Lower-case + trim so email lookups match regardless of casing/whitespace. */
export function normalizeBootstrapEmail(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * True when any row already carries an org-level owner or admin role. Used as
 * the "database is already initialized" guard: bootstrap is only for the very
 * first privileged account.
 */
export function hasExistingOwnerOrAdmin(rows: readonly BootstrapRoleRow[]): boolean {
	return rows.some((row) => {
		const roles = row.roles ?? [];
		return roles.includes(USER_ROLES.OWNER) || roles.includes(USER_ROLES.ADMIN);
	});
}

/**
 * Merge the target's existing roles with owner+admin without dropping any it
 * already had (e.g. `customer`). Deterministic order: existing roles first
 * (deduped), then owner/admin if still missing.
 */
export function promoteToOwnerAdmin(existingRoles: readonly UserRole[]): UserRole[] {
	const next: UserRole[] = [];
	const seen = new Set<UserRole>();
	for (const role of [...existingRoles, USER_ROLES.OWNER, USER_ROLES.ADMIN]) {
		if (!seen.has(role)) {
			seen.add(role);
			next.push(role);
		}
	}
	return next;
}

/**
 * Fail-closed decision for the first-admin bootstrap. Guards, in order:
 *   1. the `ALLOW_ADMIN_BOOTSTRAP` opt-in must be set (inert by default);
 *   2. no owner/admin may already exist (strictly first-admin);
 *   3. the target `userRoles` row must exist (this never creates users).
 * Only when all three pass does it return an `ok` promotion.
 */
export function decideAdminBootstrap(input: {
	allowBootstrap: boolean;
	existingRoleRows: readonly BootstrapRoleRow[];
	targetRow: BootstrapTargetRow | null;
}): AdminBootstrapDecision {
	if (!input.allowBootstrap) {
		return { ok: false, reason: ADMIN_BOOTSTRAP_REFUSAL.DISABLED };
	}
	if (hasExistingOwnerOrAdmin(input.existingRoleRows)) {
		return { ok: false, reason: ADMIN_BOOTSTRAP_REFUSAL.ALREADY_INITIALIZED };
	}
	if (!input.targetRow) {
		return { ok: false, reason: ADMIN_BOOTSTRAP_REFUSAL.USER_NOT_FOUND };
	}

	const previousRoles = [...(input.targetRow.roles ?? [])];
	return {
		ok: true,
		targetRowId: input.targetRow._id,
		nextRoles: promoteToOwnerAdmin(previousRoles),
		previousRoles,
	};
}
