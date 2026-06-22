import { AdminStaffKeys } from "@/global/i18n";
import { createColumnHelper } from "@tanstack/react-table";
import type { Id } from "convex/_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE } from "convex/constants";
import type { TFunction } from "i18next";

export type TeamDirectoryRow =
	| {
			rowType: "member";
			kind: "user" | "employeeAccount";
			_id: Id<"restaurantMembers">;
			employeeAccountId: Id<"employeeAccounts"> | null;
			userId: string | null;
			role: string;
			isActive: boolean;
			email: string | null;
			firstName: string | null;
			paternalLastname: string | null;
			maternalLastname: string | null;
			photoUrl: string | null;
			addedByEmail: string | null;
			removedAt: number | null;
	  }
	| {
			rowType: "restaurantOwner";
			kind: "user";
			userId: string;
			role: string;
			isActive: true;
			email: string | null;
			firstName: string | null;
			paternalLastname: string | null;
			maternalLastname: string | null;
			photoUrl: string | null;
			addedByEmail: string | null;
			removedAt: null;
	  }
	| {
			rowType: "orgOwner";
			kind: "user";
			userId: string;
			role: string;
			isActive: true;
			email: string | null;
			firstName: string | null;
			paternalLastname: string | null;
			maternalLastname: string | null;
			photoUrl: string | null;
			addedByEmail: string | null;
			removedAt: null;
	  }
	| {
			rowType: "invite";
			kind: "user";
			_id: Id<"invitations">;
			email: string;
			role: string;
			firstName: string | null;
			paternalLastname: string | null;
			maternalLastname: string | null;
			photoUrl: string | null;
			addedByEmail: string | null;
	  };

function nameFromEmail(value: string): string {
	const at = value.indexOf("@");
	return at === -1 ? value : value.slice(0, at);
}

function displayName(row: {
	firstName: string | null;
	paternalLastname: string | null;
	maternalLastname: string | null;
	email?: string | null;
}): string {
	const parts = [row.firstName, row.paternalLastname, row.maternalLastname].filter(Boolean);
	if (parts.length > 0) return parts.join(" ");
	if ("email" in row && row.email) return nameFromEmail(row.email);
	return "";
}

function initials(row: { firstName: string | null; paternalLastname: string | null }): string {
	const f = row.firstName?.charAt(0) ?? "";
	const p = row.paternalLastname?.charAt(0) ?? "";
	return (f + p).toUpperCase() || "?";
}

const columnHelper = createColumnHelper<TeamDirectoryRow>();

export function createTeamDirectoryColumns(args: {
	t: TFunction;
	staffRoleLabel: (role: string) => string;
	onRevokeInvite: (invitationId: Id<"invitations">) => void;
	revokePendingId: Id<"invitations"> | null;
	onAssignShift?: (memberId: Id<"restaurantMembers">) => void;
	assignableMemberIds?: ReadonlySet<string>;
}) {
	const { t, staffRoleLabel, onRevokeInvite, revokePendingId, onAssignShift, assignableMemberIds } =
		args;

	return [
		columnHelper.accessor((row) => displayName(row), {
			id: "name",
			header: () => t(AdminStaffKeys.TEAM_DIRECTORY_COL_NAME),
			cell: ({ row }) => {
				const r = row.original;
				const name = displayName(r);
				const photo = r.photoUrl;
				const removed = "removedAt" in r && r.removedAt != null;

				return (
					<div className={`flex items-center gap-2.5 ${removed ? "opacity-50" : ""}`}>
						{photo ? (
							<img src={photo} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
						) : (
							<span className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[11px] font-medium text-muted-foreground shrink-0">
								{initials(r)}
							</span>
						)}
						<span className="text-sm text-foreground truncate">
							{name ||
								(r.rowType === "invite"
									? nameFromEmail(r.email)
									: "userId" in r && r.userId
										? r.userId
										: "—")}
						</span>
					</div>
				);
			},
		}),
		columnHelper.accessor((row) => staffRoleLabel(row.role), {
			id: "role",
			header: () => t(AdminStaffKeys.TEAM_DIRECTORY_COL_ROLE),
			cell: ({ row }) => (
				<span className="text-sm text-muted-foreground">{staffRoleLabel(row.original.role)}</span>
			),
		}),
		columnHelper.accessor(
			(row) => {
				if (row.rowType === "invite") return t(AdminStaffKeys.TEAM_STATUS_PENDING_INVITE);
				if ("removedAt" in row && row.removedAt != null)
					return t(AdminStaffKeys.TEAM_STATUS_REMOVED);
				if (row.rowType === "restaurantOwner" || row.rowType === "orgOwner") {
					return t(AdminStaffKeys.TEAM_STATUS_ACTIVE);
				}
				return row.isActive
					? t(AdminStaffKeys.TEAM_STATUS_ACTIVE)
					: t(AdminStaffKeys.TEAM_MEMBER_INACTIVE);
			},
			{
				id: "status",
				header: () => t(AdminStaffKeys.TEAM_DIRECTORY_COL_STATUS),
				cell: ({ row }) => {
					const r = row.original;
					if (r.rowType === "invite") {
						return (
							<span className="text-sm text-muted-foreground">
								{t(AdminStaffKeys.TEAM_STATUS_PENDING_INVITE)}
							</span>
						);
					}
					if ("removedAt" in r && r.removedAt != null) {
						return (
							<span className="text-sm text-destructive">
								{t(AdminStaffKeys.TEAM_STATUS_REMOVED)}
							</span>
						);
					}
					if (r.rowType === "restaurantOwner" || r.rowType === "orgOwner") {
						return (
							<span className="text-sm text-muted-foreground">
								{t(AdminStaffKeys.TEAM_STATUS_ACTIVE)}
							</span>
						);
					}
					return (
						<span className="text-sm text-muted-foreground">
							{r.isActive
								? t(AdminStaffKeys.TEAM_STATUS_ACTIVE)
								: t(AdminStaffKeys.TEAM_MEMBER_INACTIVE)}
						</span>
					);
				},
			}
		),
		columnHelper.display({
			id: "actions",
			header: () => "",
			cell: ({ row }) => {
				const r = row.original;
				if (r.rowType === "invite") {
					const busy = revokePendingId === r._id;
					return (
						<button
							type="button"
							className="text-xs text-destructive hover:underline disabled:opacity-50"
							disabled={busy}
							onClick={(e) => {
								e.stopPropagation();
								onRevokeInvite(r._id);
							}}
						>
							{t(AdminStaffKeys.TEAM_REVOKE)}
						</button>
					);
				}
				if (
					r.rowType === "member" &&
					r.isActive &&
					r.removedAt == null &&
					onAssignShift &&
					assignableMemberIds?.has(String(r._id))
				) {
					if (
						r.role === RESTAURANT_MEMBER_ROLE.MANAGER ||
						r.role === RESTAURANT_MEMBER_ROLE.EMPLOYEE
					) {
						return (
							<button
								type="button"
								className="text-xs text-foreground hover:underline"
								onClick={(e) => {
									e.stopPropagation();
									onAssignShift(r._id);
								}}
							>
								{t(AdminStaffKeys.SCHEDULE_TEAM_ROW_ASSIGN)}
							</button>
						);
					}
				}
				return null;
			},
		}),
	];
}
