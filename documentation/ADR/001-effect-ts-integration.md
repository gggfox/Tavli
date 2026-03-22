# ADR-001: Effect.ts Integration Between TanStack Start and Convex

## Metadata

| Field               | Value            |
| ------------------- | ---------------- |
| **Status**          | Deprecated       |
| **Date**            | 2025-12-14       |
| **Author(s)**       | Development Team |
| **Supersedes**      | N/A              |
| **Superseded by**   | N/A              |
| **Deprecated Date** | 2025-01-XX       |

## Context

The application uses TanStack Start as the full-stack React framework and Convex as the backend-as-a-service for real-time data synchronization. While this stack provides excellent developer experience and real-time capabilities, there was a need for:

1. **Type-safe service layer**: A structured way to encapsulate business logic and data transformations
2. **Dependency injection**: Clean separation of concerns with testable services
3. **Functional programming patterns**: Composable, predictable operations with explicit error handling
4. **Maintainability**: A scalable architecture as the application grows

The challenge was to introduce Effect.ts as an intermediary layer without disrupting Convex's real-time sync engine, which is a core feature of the application.

## Decision

We decided to integrate Effect.ts between TanStack Start (React) and Convex using the following architecture:

```bash
TanStack Start (React Components)
           ↓
   Effect Provider (Runtime + ManagedRuntime)
           ↓
   Effect Services (TasksService, ConvexService)
           ↓
   Convex (via convexQuery for real-time sync)
```

Key architectural decisions:

1. **Preserve `convexQuery` for subscriptions**: Continue using `convexQuery` from `@convex-dev/react-query` to maintain Convex's real-time sync engine
2. **Effect services for business logic**: Create Effect-based services that wrap Convex operations and provide domain-specific transformations
3. **React Context for runtime**: Use a `ManagedRuntime` provided via React Context for dependency injection
4. **Custom hooks**: Create hooks that combine Effect services with TanStack Query's caching and Convex's real-time updates

## Consequences

### Positive

- **Type-safe error handling**: All errors are explicitly typed using Effect's error channel
- **Composable services**: Services can be easily composed and extended using Effect's Layer system
- **Testability**: Services can be mocked and tested in isolation
- **Real-time preserved**: Convex's sync engine continues to provide live updates
- **Gradual adoption**: Effect can be introduced incrementally without rewriting existing code
- **Schema validation**: Effect Schema provides runtime validation for domain models

### Negative

- **Learning curve**: Team members need to learn Effect.ts concepts (Effect, Layer, Context, etc.)
- **Bundle size**: Effect.ts adds to the application bundle (~30-50KB gzipped)
- **Complexity overhead**: Simple operations now go through more abstraction layers
- **Dual paradigms**: Mixing Effect patterns with React hooks requires careful consideration

### Neutral

- **Performance**: The additional abstraction layer has negligible runtime impact for typical use cases
- **Debugging**: Effect provides excellent tracing capabilities, but requires understanding Effect's execution model

## Alternatives Considered

### Option 1: Direct Convex Usage (Status Quo)

Continue using Convex directly with `convexQuery` and TanStack Query without any intermediary layer.

**Pros:**

- Simple and straightforward
- No additional dependencies
- Minimal abstraction

**Cons:**

- Business logic scattered across components
- No structured error handling
- Difficult to test in isolation
- No dependency injection

**Why not chosen:** Does not address the need for structured business logic and service layer.

### Option 2: Custom Service Layer Without Effect

Create a custom service layer using plain TypeScript classes and manual dependency injection.

**Pros:**

- Familiar patterns
- No new dependencies
- Full control over implementation

**Cons:**

- Manual error handling
- No built-in composition patterns
- More boilerplate code
- Reinventing the wheel

**Why not chosen:** Effect.ts provides battle-tested patterns for exactly this use case with better ergonomics.

### Option 3: Replace Convex Subscriptions with Effect Streams

Use Effect Streams for all real-time data, completely replacing Convex's subscription model.

**Pros:**

- Fully unified Effect-based architecture
- Complete control over data flow

**Cons:**

- Loses Convex's optimized sync engine
- More complex implementation
- Potential performance issues
- Breaks existing patterns

**Why not chosen:** Convex's sync engine is highly optimized and a key feature; replacing it would be counterproductive.

## Implementation

### File Structure

```bash
src/lib/effect/
├── index.ts                     # Public exports
├── EffectProvider.tsx           # React context provider
├── services/
│   ├── ConvexService.ts         # Convex wrapper service
│   └── TasksService.ts          # Domain-specific task service
└── hooks/
    ├── useEffectQuery.ts        # Generic Effect + Query hooks
    └── useTasks.ts              # Task-specific hooks
```

### Core Services

#### ConvexService

Wraps Convex operations in Effect:

```typescript
export class ConvexService extends Context.Tag("ConvexService")<
	ConvexService,
	{
		readonly query: <Query extends FunctionReference<"query">>(
			query: Query,
			args: FunctionArgs<Query>
		) => Effect.Effect<FunctionReturnType<Query>, ConvexQueryError>;

		readonly mutation: <Mutation extends FunctionReference<"mutation">>(
			mutation: Mutation,
			args: FunctionArgs<Mutation>
		) => Effect.Effect<FunctionReturnType<Mutation>, ConvexMutationError>;

		readonly subscribe: <Query extends FunctionReference<"query">>(
			query: Query,
			args: FunctionArgs<Query>
		) => Stream.Stream<FunctionReturnType<Query>, ConvexSubscriptionError>;

		readonly client: ConvexReactClient;
	}
>() {}
```

#### TasksService

Domain-specific service with business logic:

```typescript
export class TasksService extends Context.Tag("TasksService")<
	TasksService,
	{
		readonly getTasks: Effect.Effect<readonly Task[], TasksError>;
		readonly subscribeToTasks: Stream.Stream<readonly Task[], TasksError>;
		readonly getTasksByStatus: (completed: boolean) => Effect.Effect<readonly Task[], TasksError>;
		readonly countByStatus: Effect.Effect<
			{ total: number; completed: number; pending: number },
			TasksError
		>;
	}
>() {}
```

### React Integration

#### EffectProvider

Provides the Effect runtime to React components:

```typescript
export function EffectProvider({ convexClient, children }: EffectProviderProps) {
  const contextValue = useMemo(() => {
    const appLayer = createAppLayer(convexClient);
    const runtime = ManagedRuntime.make(appLayer);

    return {
      runtime,
      runPromise: <A, E>(effect: Effect.Effect<A, E, AppServices>) =>
        runtime.runPromise(effect),
      runSync: <A, E>(effect: Effect.Effect<A, E, AppServices>) =>
        runtime.runSync(effect),
    };
  }, [convexClient]);

  return (
    <EffectContext.Provider value={contextValue}>
      {children}
    </EffectContext.Provider>
  );
}
```

#### useTasks Hook

Combines Effect services with Convex real-time:

```typescript
export function useTasks() {
	const { runSync, runPromise } = useEffectRuntime();

	// Use convexQuery for real-time subscriptions (preserves Convex sync)
	const { data: rawTasks, ...queryMeta } = useSuspenseQuery(convexQuery(api.tasks.get, {}));

	// Transform using Effect patterns
	const tasks = useMemo<readonly Task[]>(() => rawTasks.map(transformTask), [rawTasks]);

	// Computed values
	const counts = useMemo(() => {
		const completed = tasks.filter((t) => t.isCompleted ?? false).length;
		return {
			total: tasks.length,
			completed,
			pending: tasks.length - completed,
		};
	}, [tasks]);

	return { tasks, counts, ...queryMeta };
}
```

### Router Integration

The Effect provider is integrated in the router:

```typescript
Wrap: ({ children }) => (
  <ConvexProvider client={convexQueryClient.convexClient}>
    <EffectProvider convexClient={convexQueryClient.convexClient}>
      {children}
    </EffectProvider>
  </ConvexProvider>
),
```

### Usage Example

```typescript
function App() {
  const { tasks, counts } = useTasks();

  return (
    <div>
      <p>Total: {counts.total}, Completed: {counts.completed}</p>
      {tasks.map((task) => (
        <div key={task._id}>{task.text}</div>
      ))}
    </div>
  );
}
```

## References

- [Effect.ts Documentation](https://effect.website/)
- [Convex Documentation](https://docs.convex.dev/)
- [TanStack Start Documentation](https://tanstack.com/start)
- [@convex-dev/react-query](https://github.com/get-convex/convex-js/tree/main/packages/convex-dev-react-query)

---

## Deprecation

**Status:** This ADR is deprecated. Effect.ts was removed from the codebase.

### Reason for Removal

Effect.ts was removed because it added an extra layer of complexity in a functional style that didn't sit well with our use of Convex and TanStack Start. While Effect.ts provides powerful functional programming patterns and type-safe error handling, the additional abstraction layer:

1. **Increased cognitive overhead**: Team members needed to understand Effect.ts concepts (Effect, Layer, Context, etc.) on top of Convex and TanStack Start patterns
2. **Created architectural friction**: The functional programming style of Effect.ts didn't align well with the reactive patterns used by Convex's real-time subscriptions and TanStack Start's query system
3. **Added unnecessary complexity**: For our use case, the benefits of Effect.ts (structured error handling, dependency injection, composable services) didn't outweigh the complexity cost
4. **Simplified stack**: Removing Effect.ts allows us to work more directly with Convex and TanStack Start, reducing the number of abstraction layers

The application now uses Convex and TanStack Start directly, with business logic organized in service modules using plain TypeScript patterns.

## Change Log

| Date       | Author           | Description                                               |
| ---------- | ---------------- | --------------------------------------------------------- |
| 2025-12-14 | Development Team | Initial version - Effect.ts integration                   |
| 2025-01-XX | Development Team | Deprecated - Effect.ts removed due to complexity overhead |
