/**
 * Disputes (TAVLI-102) — a diner's bank pulling a payment back, and the money
 * Tavli recovers from the restaurant's later orders.
 *
 * Its own slice rather than part of `kitchen` (where the payments dashboard
 * lives) or `payouts`, because a dispute is a third movement of money: a
 * payment is a diner paying the restaurant, a payout is Stripe paying the
 * restaurant's bank, and a dispute is a payment being reversed weeks later.
 * `DisputesSection` is the piece the payments page imports and
 * `DisputeRecoveryControl` the piece the admin restaurants page does — both
 * feature → feature imports, which the boundaries rules allow.
 */
export * from "./components";
export * from "./constants";
