# TDR-0001: Missing Backend Authentication & Authorization

## Context

WorkOS AuthKit is configured for client-side authentication (signin, signup, signout, callback routes) and the `authkitMiddleware()` is applied to TanStack Start. However, neither Convex functions nor TanStack server functions validate user identity before executing operations. This creates a gap where the frontend shows authentication UI, but backend operations are completely unprotected.

## Impact

- **Critical Security Gap**: Any user (authenticated or not) can call Convex queries/mutations directly
- **Data Exposure**: All tasks are publicly readable via `api.tasks.get`
- **Data Manipulation**: Anyone can create, delete, or toggle any task via mutations
- **No Multi-tenancy**: Even if auth were added, there's no user-scoping on data
- **Server Functions Exposed**: Demo server functions (`getTodos`, `addTodo`, `getPunkSongs`) have no auth checks

## Affected Files

| File | Issue |
| ------ | ------- |
| `convex/tasks.ts` | No `ctx.auth.getUserIdentity()` checks |
| `src/routes/demo/start.server-funcs.tsx` | No `getUser()` validation |
| `src/data/demo.punk-songs.ts` | No auth on server function |
| `src/router.tsx` | Convex client initialized without auth token |
| `convex/schema.ts` | No `userId` field for multi-tenancy |

## Options

### Option 1: Integrate WorkOS with Convex (Recommended)

1. Configure Convex to accept WorkOS JWT tokens
2. Set up `ConvexProviderWithAuth` to pass tokens from WorkOS session
3. Add `ctx.auth.getUserIdentity()` checks to all Convex functions
4. Add `userId` field to schema for data isolation

**Pros**: Full integration, proper multi-tenancy, industry standard  
**Cons**: Requires Convex auth configuration, schema migration

### Option 2: Server-Side Proxy Pattern

1. Keep Convex functions internal (no direct client access)
2. Route all data operations through TanStack server functions
3. Validate WorkOS session in server functions before calling Convex

**Pros**: Simpler Convex setup, centralized auth  
**Cons**: Loses Convex real-time benefits, adds latency, more code

### Option 3: Minimal Fix for Server Functions Only

1. Add `getUser()` checks to TanStack server functions
2. Leave Convex as-is for demo/internal use only
3. Document Convex endpoints as public/dev-only

**Pros**: Quick fix for server functions  
**Cons**: Convex remains insecure, not production-ready

## Recommended Implementation (Option 1)

### Step 1: Update Convex Schema

```ts
// convex/schema.ts
export default defineSchema({
  tasks: defineTable({
    text: v.string(),
    isCompleted: v.optional(v.boolean()),
    userId: v.string(), // NEW: Owner of the task
  }).index("by_user", ["userId"]),
});
```

### Step 2: Add Auth to Convex Functions

```ts
// convex/tasks.ts
export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }
    return await ctx.db
      .query("tasks")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
  },
});
```

### Step 3: Configure Convex Auth Provider

```tsx
// src/router.tsx - Pass auth token to Convex
<ConvexProviderWithAuth 
  client={convexQueryClient.convexClient}
  useAuth={useWorkOSAuth} // Custom hook to bridge WorkOS → Convex
>
```

### Step 4: Add Auth to Server Functions

```ts
import { getUser } from '@workos/authkit-tanstack-react-start';

const getTodos = createServerFn({ method: 'GET' })
  .handler(async ({ request }) => {
    const { user } = await getUser({ ensureSignedIn: true });
    if (!user) throw new Error("Unauthorized");
    return await readTodos();
  });
```

## Owner

Development Team

## Created

2024-12-21

## Severity

**High** - Security vulnerability allowing unauthorized data access and manipulation

## Status

**Resolved** - Implemented 2024-12-22

## Resolution

Implemented Option 1 (WorkOS + Convex integration):

1. Created `convex/auth.config.ts` with WorkOS JWT validation
2. Updated `convex/schema.ts` with `userId` field and `by_user` index
3. Updated `convex/tasks.ts` with authentication checks and user-scoped queries

### Setup Required

After deploying, you must set the `WORKOS_CLIENT_ID` environment variable in your Convex deployment:

**Via Convex Dashboard:**

1. Go to [dashboard.convex.dev](https://dashboard.convex.dev)
2. Select your project and deployment (dev/prod)
3. Navigate to Settings > Environment Variables
4. Add `WORKOS_CLIENT_ID` with your WorkOS client ID (e.g., `client_01XXXXXXXX`)

**Via CLI:**

```bash
npx convex env set WORKOS_CLIENT_ID your_client_id_here
```

### Data Migration

Existing tasks without a `userId` will not be accessible. Clear test data or run a migration to assign them to a user.
