# Admin Impersonation (Clerk Built-in)

## Purpose

Let an admin "see what a user sees" for live prod debugging — same identity, same restaurant memberships, same `userSettings`, same dashboard.

This runbook covers **Approach 1: Clerk Dashboard impersonation**. Zero code. Good for ad-hoc debugging today; revisit if it stops being enough.

## How it works

Tavli auth flows: Clerk issues a JWT → `ConvexProviderWithClerk` passes it to Convex → `convex/_util/auth.ts:getCurrentUserId` returns `identity.subject` (the Clerk user ID) → every query/mutation reads/writes as that user.

When you impersonate via the Clerk Dashboard, Clerk gives your browser a session whose JWT `sub` is the *target* user. Convex therefore returns the target user from `getCurrentUserId`, and the entire app (sidebar, restaurants, theme, language, schedule, orders) renders as if the target were signed in.

## Steps

1. Open the [Clerk Dashboard](https://dashboard.clerk.com) and select the Tavli production application.
2. **Users** → find the user (search by email).
3. Click **... → Impersonate user**.
4. A new tab opens at the Tavli app, signed in as the target user. Debug.
5. When done: click your avatar → **Sign out**, then sign back in with your own admin account.

## What to check while impersonating

- The page or action the user reported as broken (reproduce it).
- Sidebar: which restaurants and admin sections are visible?
- `useUserSettings`: theme, language, sidebar state.
- For restaurant-scoped issues: confirm the active restaurant via the restaurant switcher matches the one the user was on.
- Open the in-app Auth devtool (bottom-right) and confirm the JWT `sub` matches the target user's Clerk ID — that's your "yes, I'm really seeing what they see" check.

## What it does NOT cover

- **Audit trail.** Any mutation you trigger while impersonating is recorded as the *target user*. Don't click anything destructive. Treat this as read-only.
- **Stripe.** Stripe Connect calls hit the impersonated restaurant's account. Don't touch payment/refund actions.
- **External IDs in logs.** Sentry/Convex logs during the session will attribute actions to the target, not to you.

## Limits / when to upgrade to Approach 2

- One-user-at-a-time per browser (use a separate browser profile if you need both identities side-by-side).
- Free Clerk plan has a monthly impersonation cap; check the Clerk billing page if the button is disabled.
- No in-app banner saying "you are impersonating" — easy to forget. If we start doing this more than a couple of times a week, build Approach 2 (Clerk actor tokens + in-app banner + `impersonationSessions` audit table).

## Quick test plan (do this once before relying on it in an incident)

1. Pick a non-admin test user (e.g., a staff account in the staging restaurant).
2. Impersonate from the Clerk Dashboard.
3. Verify:
   - Sidebar only shows surfaces the staff account is allowed to see (admin-only items hidden).
   - `/admin/team`, `/admin/payments`, etc. either redirect or 403 if the target lacks the role.
   - `useUserSettings` reflects the target's theme/language, not yours.
4. Sign out, sign back in as admin, confirm you're back to your own view.
