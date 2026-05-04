import { AdminStaffKeys } from "@/global/i18n";
import { createColumnHelper } from "@tanstack/react-table";
import type { Id } from "convex/_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE } from "convex/constants";
import type { TFunction } from "i18next";

export type TeamDirectoryRow =
	| {
			rowType: "member";
			_id: Id<"restaurantMembers">;
			userId: string;
			role: string;
			isActive: boolean;
			email: string | null;
	  }
	| {
			rowType: "restaurantOwner";
			userId: string;
			role: string;
			isActive: true;
			email: string | null;
	  }
	| {
			rowType: "orgOwner";
			userId: string;
			role: string;
			isActive: true;
			email: string | null;
	  }
	| {
			rowType: "invite";
			_id: Id<"invitations">;
			email: string;
			role: string;
	  };

const columnHelper = createColumnHelper<TeamDirectoryRow>();

export function createTeamDirectoryColumns(args: {
	t: TFunction;
	staffRoleLabel: (role: string) => string;
	onRevokeInvite: (invitationId: Id<"invitations">) => void;
	revokePendingId: Id<"invitations"> | null;
	/** When provided, member rows the actor can target render an "Asignar turno…" action. */
	onAssignShift?: (memberId: Id<"restaurantMembers">) => void;
	/** Member ids the current actor can schedule shifts for; used to gate the row action. */
	assignableMemberIds?: ReadonlySet<string>;
}) {
	const {
		t,
		staffRoleLabel,
		onRevokeInvite,
		revokePendingId,
		onAssignShift,
		assignableMemberIds,
	} = args;

	return [
		columnHelper.display({
			id: "identity",
			header: () => t(AdminStaffKeys.TEAM_DIRECTORY_COL_IDENTITY),
			cell: ({ row }) => {
				const r = row.original;
				if (r.rowType === "invite") {
					return <span className="text-sm text-foreground">{r.email}</span>;
				}
				const label = r.email?.trim() ? r.email : r.userId;
				const mono = !r.email?.trim();
				return (
					<span
						className={`text-sm text-foreground ${mono ? "font-mono text-xs" : ""}`}
					>
						{label}
					</span>
				);
			},
		}),
		columnHelper.display({
			id: "role",
			header: () => t(AdminStaffKeys.TEAM_DIRECTORY_COL_ROLE),
			cell: ({ row }) => (
				<span className="text-sm text-muted-foreground">{staffRoleLabel(row.original.role)}</span>
			),
		}),
		columnHelper.display({
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
				if (r.rowType === "restaurantOwner" || r.rowType === "orgOwner") {
					return (
						<span className="text-sm text-muted-foreground">{t(AdminStaffKeys.TEAM_STATUS_ACTIVE)}</span>
					);
				}
				return (
					<span className="text-sm text-muted-foreground">
						{r.isActive ? t(AdminStaffKeys.TEAM_STATUS_ACTIVE) : t(AdminStaffKeys.TEAM_MEMBER_INACTIVE)}
					</span>
				);
			},
		}),
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
							onClick={() => onRevokeInvite(r._id)}
						>
							{t(AdminStaffKeys.TEAM_REVOKE)}
						</button>
					);
				}
				if (
					r.rowType === "member" &&
					r.isActive &&
					onAssignShift &&
					assignableMemberIds?.has(String(r._id))
				) {
					// Owners only render via the synthetic owner row (no `_id`), so
					// `member` rowType already excludes the org/restaurant owners we
					// can't schedule.
					if (
						r.role === RESTAURANT_MEMBER_ROLE.MANAGER ||
						r.role === RESTAURANT_MEMBER_ROLE.EMPLOYEE
					) {
						return (
							<button
								type="button"
								className="text-xs text-foreground hover:underline"
								onClick={() => onAssignShift(r._id)}
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
