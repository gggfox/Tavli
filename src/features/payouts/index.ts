/**
 * Payouts (TAVLI-103) — the restaurant's own money leaving Stripe for its bank.
 *
 * Its own slice rather than part of `kitchen` (where the payments dashboard
 * lives) because a payout is a different movement of money from a payment: a
 * payment is a diner paying the restaurant, a payout is Stripe paying the
 * restaurant's bank. `PayoutsHeldBanner` is the one piece the payments page
 * imports, which is a feature → feature import and allowed by the boundaries
 * rules.
 */
export * from "./components";
export * from "./constants";
export * from "./hooks";
