/**
 * Convex component registrations for this deployment.
 *
 * This file exists for the aggregate component (`@convex-dev/aggregate`),
 * which keeps denormalised counts and sums in a B-tree so a total, a rank or a
 * percentile is an `O(log n)` read instead of a `.collect()` over the table.
 * The Stripe reporting work stacked behind TAVLI-108 needs those over payment
 * and dispute volumes, where the row count grows without bound.
 *
 * Registration is deliberately the bare install step from the component's
 * README and nothing more. The README is explicit that one component instance
 * backs exactly one aggregate -- one table, one sort key -- and that further
 * aggregates each get their own named instance:
 *
 *     app.use(aggregate, { name: "aggregateScores" });
 *     app.use(aggregate, { name: "aggregateByGame" });
 *
 * So there is no generic instance that many aggregates could share, and naming
 * one now (`disputeAggregates`, say) would be guessing at a shape no code in
 * this PR defines. The unnamed registration below mounts the component as
 * `components.aggregate`, ready for the first aggregate to claim; every
 * aggregate after it adds a named `app.use` line here.
 *
 * Renaming or removing an instance resets its stored aggregate to empty, so
 * treat the names below as data, not labels: adding one is cheap, changing one
 * means a backfill.
 */
import { defineApp } from "convex/server";
import aggregate from "@convex-dev/aggregate/convex.config.js";

const app = defineApp();
app.use(aggregate);

// ---------------------------------------------------------------------------
// Disputes (TAVLI-102)
// ---------------------------------------------------------------------------

/**
 * What disputes cost **Tavli**, per calendar month: the Stripe dispute fee,
 * which the platform absorbs. Key is `YYYY-MM` (UTC) and the id is the Stripe
 * dispute id, so one dispute can only ever contribute one fee however many
 * times its events are redelivered. Platform-wide on purpose — it is not a
 * restaurant's number, it is the line item an operator checks against the
 * Stripe balance.
 */
app.use(aggregate, { name: "disputeFeesByMonth" });

/**
 * What disputes cost **one restaurant**, namespaced by restaurant id and keyed
 * by `[outcome, timestamp]` — opened, lost, won, recovered. The namespace is
 * what lets the restaurant purge drop a restaurant's whole history in one call
 * (aggregate entries are not rows, so nothing else would ever find them), and
 * what keeps one busy restaurant's writes off another's B-tree shard.
 */
app.use(aggregate, { name: "disputeTotalsByRestaurant" });

export default app;
