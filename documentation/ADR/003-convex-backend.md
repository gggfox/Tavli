# ADR-003: Convex as Backend-as-a-Service

## Metadata

| Field | Value |
| ------- | ------- |
| **Status** | Accepted |
| **Date** | 2025-12-21 |
| **Author(s)** | Development Team |
| **Supersedes** | N/A |
| **Superseded by** | N/A |

## Context

Fierro Viejo requires a backend solution that can handle real-time data synchronization for our B2B auction marketplace. The application needs to support live bidding, instant updates across clients, and a reliable data layer that can scale with business growth.

Key requirements identified:

1. **Real-time synchronization**: Auction marketplaces require instant updates—bids, listings, and status changes must propagate immediately to all connected clients
2. **Developer velocity**: As a lean team, we need to move fast without sacrificing code quality or maintainability
3. **Type safety**: End-to-end TypeScript support to catch errors at compile time and improve developer experience
4. **Scalable architecture**: A foundation that grows with the product without requiring major rewrites
5. **Low operational burden**: Minimal DevOps overhead so the team can focus on product development

## Decision

We will use **Convex** as our backend-as-a-service platform.

Convex provides a complete backend solution with a database, serverless functions, real-time subscriptions, and file storage—all with a TypeScript-first approach that aligns with our frontend stack.

Key factors in this decision:

- **Developer Experience**: Convex offers an exceptional DX with automatic TypeScript generation, hot reloading, and a local development environment that mirrors production
- **Powerful Sync Engine**: The real-time sync engine is built into the core architecture, not bolted on—queries automatically subscribe to updates without additional configuration
- **TypeScript First**: Schema definitions, queries, mutations, and client code are all TypeScript, providing end-to-end type safety from database to UI
- **Flexible Ecosystem**: Convex offers additional features like scheduled functions (cron jobs), database triggers, file storage, and actions for external API calls that can be adopted as scope expands

## Consequences

### Positive

- **Zero-config real-time**: Subscriptions work out of the box; any query automatically becomes reactive
- **End-to-end type safety**: Schema changes propagate to generated types, catching breaking changes at compile time
- **Rapid iteration**: Hot reload and instant deploys enable fast development cycles
- **ACID transactions**: Database operations are transactional by default, ensuring data consistency
- **Built-in functions**: Queries, mutations, and actions provide a clear mental model for data operations
- **Future-proof features**: Database triggers, scheduled functions, and vector search are available when needed
- **Excellent documentation**: Comprehensive guides and examples for common patterns

### Negative

- **Vendor lock-in**: Convex has a proprietary query language and architecture; migration would require significant effort
- **Pricing at scale**: Costs at high volume are not fully understood; may need to revisit if usage grows significantly
- **Newer platform**: Less battle-tested than traditional databases or established BaaS solutions
- **Limited query flexibility**: Some complex queries that are trivial in SQL may require different approaches

### Neutral

- **Learning curve**: While the concepts are straightforward, the reactive paradigm differs from traditional REST/GraphQL backends
- **Community size**: Growing but smaller than Firebase or Supabase communities

## Alternatives Considered

### Option 1: Supabase

PostgreSQL-based backend with real-time subscriptions, auth, and storage.

**Pros:**

- Open-source PostgreSQL under the hood
- SQL familiarity for complex queries
- Large community and ecosystem
- Self-hosting option available

**Cons:**

- Real-time requires explicit subscription setup
- Less integrated TypeScript experience
- More configuration required for type generation

**Why not chosen:** Convex's tighter TypeScript integration and zero-config real-time sync better aligned with our velocity goals.

### Option 2: Firebase/Firestore

Google's established BaaS platform with real-time database and extensive services.

**Pros:**

- Mature, battle-tested platform
- Extensive feature set (auth, hosting, analytics, etc.)
- Large community and resources

**Cons:**

- NoSQL document model can be limiting for relational data
- TypeScript support is less integrated
- Complex pricing model
- Query limitations compared to SQL

**Why not chosen:** Convex provides better TypeScript integration and a more flexible data model with ACID transactions.

### Option 3: Traditional Backend (Node.js + PostgreSQL)

Custom backend using Express/Fastify with PostgreSQL and WebSockets for real-time.

**Pros:**

- Full control over architecture
- No vendor lock-in
- Familiar patterns for most developers
- Unlimited query flexibility

**Cons:**

- Significant development time for real-time infrastructure
- DevOps burden (hosting, scaling, monitoring)
- Must build auth, file storage, etc. separately
- More code to maintain

**Why not chosen:** The operational overhead and development time for building real-time infrastructure from scratch would delay time-to-market significantly.

### Option 4: Hasura + PostgreSQL

GraphQL engine with real-time subscriptions on top of PostgreSQL.

**Pros:**

- Instant GraphQL API from database schema
- Real-time subscriptions built-in
- PostgreSQL power with GraphQL convenience
- Self-hosting available

**Cons:**

- GraphQL adds complexity for simple use cases
- Requires separate database management
- Less integrated development experience

**Why not chosen:** Convex's simpler function-based model (queries/mutations) felt more natural for our use case than GraphQL.

## Implementation

### Project Structure

```bash
convex/
├── _generated/        # Auto-generated types and API
│   ├── api.d.ts       # Typed API references
│   ├── api.js
│   ├── dataModel.d.ts # Database model types
│   └── server.d.ts    # Server function types
├── schema.ts          # Database schema definition
└── tasks.ts           # Query and mutation functions
```

### Schema Definition

Schemas are defined using Convex's TypeScript-based schema builder:

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  tasks: defineTable({
    text: v.string(),
    isCompleted: v.optional(v.boolean()),
  }),
});
```

### Queries and Mutations

Functions are TypeScript with automatic type inference:

```typescript
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("tasks").collect();
  },
});

export const create = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("tasks", {
      text: args.text,
      isCompleted: false,
    });
  },
});
```

### Client Integration

Convex integrates with TanStack Query via `@convex-dev/react-query`:

```typescript
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../convex/_generated/api";

// Queries are automatically reactive
const { data: tasks } = useSuspenseQuery(convexQuery(api.tasks.get, {}));
```

### Future Features Available

As the product scope expands, Convex provides:

- **Scheduled Functions**: Cron-like jobs for recurring tasks (e.g., auction closing)
- **Database Triggers**: React to data changes automatically
- **File Storage**: Built-in file upload and serving
- **Actions**: For calling external APIs and services
- **Vector Search**: AI-powered similarity search (useful for product recommendations)
- **HTTP Actions**: Custom HTTP endpoints for webhooks

## References

- [Convex Documentation](https://docs.convex.dev/)
- [Convex + TanStack Query Integration](https://docs.convex.dev/client/tanstack-query)
- [Convex TypeScript Guide](https://docs.convex.dev/using/writing-convex-functions)
- [ADR-001: Effect.ts Integration](./001-effect-ts-integration.md)
- [ADR-002: WorkOS Authentication](./002-workos-authentication.md)

---

## Change Log

| Date       | Author           | Description     |
|------------|------------------|-----------------|
| 2025-12-21 | Development Team | Initial version |
