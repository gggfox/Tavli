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

export default crons;
