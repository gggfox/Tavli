/**
 * Convex cron registry.
 *
 * Convex picks this file up automatically (the default-exported `Crons`
 * registers all jobs at deployment time). Keep schedules conservative -- the
 * goal is "eventually consistent within a few minutes", not real-time.
 */
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Flip pending/confirmed reservations whose startsAt + grace has elapsed to
// `no_show`. Five minutes is fast enough that the dashboard reflects reality
// during a busy service while staying well under any user-perceptible
// double-booking risk (the no-show flip frees the table window, which the
// next booking attempt re-checks anyway).
crons.interval("reservation no-show sweep", { minutes: 15 }, internal.reservations.sweepNoShows);

crons.interval(
	"invitation expiry sweep",
	{ hours: 1 },
	internal.invites.expirePendingInvitations
);

crons.interval(
	"shift attendance no-clockout sweep",
	{ hours: 1 },
	internal.attendance.sweepStaleShiftAttendance
);

crons.interval(
	"restaurant soft-delete hard purge",
	{ hours: 24 },
	internal.restaurantPurge.purgeExpiredSoftDeletes
);

crons.interval(
	"sections/tables soft-delete hard purge",
	{ hours: 24 },
	internal.softDeletePurge.purgeExpiredSoftDeletes
);

// Daily sweep that extends the rolling 4-week materialized horizon for every
// active `shiftTemplates` row. 09:00 UTC ≈ 03:00 in MX; for restaurants in
// other zones the only effect is a slightly different sweep moment of day.
// Idempotent — the per-template overlap check skips slots already covered.
crons.daily(
	"shift template materialization",
	{ hourUTC: 9, minuteUTC: 0 },
	internal.shiftTemplates.materializeAllTemplates
);

export default crons;
