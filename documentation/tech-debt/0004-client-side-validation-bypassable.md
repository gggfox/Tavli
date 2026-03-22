# TDR-0004: Client-Side Validation Can Be Bypassed

## Context

Effect Schema validation has been added to the client-side Effect services (`TasksService`) to validate task inputs before sending them to Convex. However, since this validation runs on the client, malicious users can bypass it by directly calling Convex mutations with invalid data. While Convex provides basic type validation (`v.string()`, `v.id()`), it doesn't enforce business rules like minimum/maximum length, trimmed strings, or other domain-specific constraints.

## Impact

- **Security Gap**: Malicious users can bypass client-side validation and send invalid data directly to Convex
- **Data Corruption Risk**: Invalid data (e.g., empty strings, strings > 500 chars, whitespace-only) can be stored in the database
- **Inconsistent Validation**: Client-side rules (Effect Schema) don't match server-side rules (Convex `v.string()`)
- **No Defense in Depth**: Single point of failure - if client validation is bypassed, invalid data reaches the database

## Current State

### Client-Side (Effect Schema)

- ✅ Validates task text: 1-500 characters, trimmed, non-empty
- ✅ Validates task IDs: non-empty strings
- ✅ Provides immediate UX feedback
- ❌ Can be bypassed by malicious users

### Server-Side (Convex)

- ✅ Basic type validation: `v.string()`, `v.id("tasks")`
- ✅ Schema enforces table structure
- ❌ No business rule validation (length, trimming, etc.)

## Options

### Option 1: Add Server-Side Validation in Convex (Simpler)

Add matching validation logic directly in Convex mutations to mirror Effect Schema rules.

**Implementation:**

```typescript
// convex/tasks.ts
function validateTaskText(text: string): void {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		throw new Error("Task text cannot be empty");
	}
	if (trimmed.length > 500) {
		throw new Error("Task text cannot exceed 500 characters");
	}
}

export const create = mutation({
	args: { text: v.string() },
	handler: async (ctx, args) => {
		validateTaskText(args.text); // Server-side validation
		// ... rest of handler
	},
});
```

**Pros:**

- Simple to implement
- Keeps current architecture (direct Convex mutations)
- Maintains real-time query capabilities
- No additional infrastructure needed

**Cons:**

- Validation logic duplicated between client and server
- Need to manually keep rules in sync
- Less type-safe than Effect Schema

### Option 2: Route Mutations Through TanStack Server Functions (More Secure)

Keep queries direct to Convex (for real-time sync) but route all mutations through TanStack Start server functions that validate with Effect Schema before calling Convex.

**Architecture:**

```
Queries:  Client → Convex (direct, real-time)
Mutations: Client → TanStack Server Function → Effect Schema Validation → Convex
```

**Implementation:**

```typescript
// src/lib/server/tasks.server.ts
import { createServerFn } from "@tanstack/react-start";
import { Schema, Runtime } from "@effect/schema";
import { ConvexHttpClient } from "convex/browser";
import { CreateTaskInputSchema } from "../effect/services/TasksSchemas";

const convexClient = new ConvexHttpClient(process.env.CONVEX_URL!);
const runtime = Runtime.defaultRuntime;

export const createTask = createServerFn({ method: "POST" })
	.inputValidator((input: unknown) => {
		// Validate with Effect Schema on server
		return runtime.runSync(Schema.decodeUnknown(CreateTaskInputSchema)(input));
	})
	.handler(async ({ data }) => {
		// Data is validated, call Convex
		return await convexClient.mutation(api.tasks.create, data);
	});
```

**Pros:**

- Single source of truth for validation (Effect Schema)
- Server-side validation cannot be bypassed
- Type-safe end-to-end
- Can add authentication checks in server functions
- Better separation of concerns

**Cons:**

- More complex architecture
- Requires server-side Effect runtime setup
- Mutations go through additional layer (slight latency)
- Need to handle error serialization from server to client
- Real-time queries still direct (asymmetric pattern)

### Option 3: Hybrid Approach (Recommended)

Keep current client-side Effect Schema validation for UX, but add matching server-side validation in Convex mutations for security.

**Implementation:**

- Keep client-side Effect Schema (immediate feedback)
- Add server-side validation functions in Convex (security)
- Share validation constants between client and server

**Pros:**

- Defense in depth (client + server validation)
- Best UX (immediate client feedback)
- Best security (server cannot be bypassed)
- Keeps current architecture simple

**Cons:**

- Validation logic exists in two places
- Need to keep rules synchronized
- Slightly more maintenance

## Recommendation

**Option 3 (Hybrid)** is recommended because:

1. It provides defense in depth without architectural complexity
2. Maintains excellent UX with immediate client-side feedback
3. Ensures security with server-side validation
4. Keeps the current architecture intact

## Related Issues

- TDR-0001: Missing Backend Authentication (server functions would need auth too)
- Effect Schema integration (ADR-001)

## Owner

Development Team

## Created

2025-12-26

## Status

Open
