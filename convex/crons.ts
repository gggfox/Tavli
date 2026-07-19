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

crons.interval("invitation expiry sweep", { hours: 1 }, internal.invites.expirePendingInvitations);

crons.interval(
	"shift attendance no-clockout sweep",
	{ hours: 1 },
	internal.attendance.sweepStaleShiftAttendance
);

// End-of-day tab hygiene (TAVLI-6): active tabs older than 24h are closed
// when settled and flagged (never auto-charged) when they still owe money,
// so staff see lingering walkout candidates in the open-tabs view.
crons.interval("stale open tab sweep", { hours: 1 }, internal.sessions.sweepStaleOpenTabs);

// Stuck-tab reconciliation (TAVLI-45): tab settlement rides on the
// `payment_intent.succeeded` webhook; if that event is dropped/delayed the tab
// stays locked forever. Every 5 minutes, reconcile tabs locked > 10 min against
// Stripe — settle succeeded ones, unlock dead ones, alert on stragglers.
crons.interval(
	"stuck tab payment reconciliation",
	{ minutes: 5 },
	internal.stripe.reconcileStuckTabPayments
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
