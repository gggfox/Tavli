/**
 * Shared types for the schedule feature module.
 *
 * `AssignableMember` collapses the team-directory's "rowType" union into the
 * subset the schedule actually cares about: active `restaurantMembers` rows
 * for which the current actor has authority to assign shifts. This is the
 * common shape consumed by the drawer's member dropdown, the week-grid
 * rows, and the team-row "Asignar turno…" action.
 */
import type { Id } from "convex/_generated/dataModel";
import type { RestaurantMemberRole } from "convex/constants";

export interface AssignableMember {
	readonly memberId: Id<"restaurantMembers">;
	readonly userId: string;
	readonly role: RestaurantMemberRole;
	readonly email: string | null;
}

export interface ScheduledShiftView {
	readonly _id: Id<"shifts">;
	readonly memberId: Id<"restaurantMembers">;
	readonly restaurantId: Id<"restaurants">;
	readonly startsAt: number;
	readonly endsAt: number;
	readonly shiftRole?: string;
	readonly status: "scheduled" | "published" | "cancelled";
	readonly notes?: string;
	readonly templateId?: Id<"shiftTemplates">;
	readonly publishedAt?: number;
	readonly member: {
		readonly userId: string;
		readonly role: RestaurantMemberRole;
		readonly email: string | null;
	} | null;
}

export type ShiftDrawerInitial =
	| { readonly mode: "create"; readonly memberId?: Id<"restaurantMembers">; readonly ymd?: string }
	| { readonly mode: "edit"; readonly shift: ScheduledShiftView };
