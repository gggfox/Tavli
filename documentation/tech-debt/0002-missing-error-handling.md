# TDR-0002: Missing Error Handling for Authentication Errors

## Context

The `getAuthenticatedUser` helper in `convex/tasks.ts` throws an `Error("Not authenticated")` when a user is not logged in. However, this error is never explicitly caught anywhere in the application. For queries, this causes app crashes; for mutations, it results in unhandled promise rejections. Users see no friendly error message and the app state becomes inconsistent.

## Impact

- **App Crashes**: Queries using `useSuspenseQuery` bubble errors up to React, crashing the app without an Error Boundary
- **Silent Failures**: Mutations (`addTask`, `deleteTask`, `toggleTask`) return rejected promises with no `.catch()` handling
- **Poor UX**: Users receive no feedback when operations fail due to authentication issues
- **Debugging Difficulty**: Unhandled promise rejections are hard to trace in production
- **Effect Error Types Unused**: `TasksError` is properly defined but never handled at the UI layer

## Current Implementation Status

| Step | Description | Status | Notes |
| ------ | ------------- | -------- | ------- |
| 1 | Add ErrorBoundary component | ✅ **Done** | `src/components/ErrorBoundary/` |
| 2 | Wrap app in ErrorBoundary | ✅ **Done** | Added to `__root.tsx` |
| 3 | Add error state to useTasks | ✅ **Done** | Using Effect's Exit for typed errors |
| 4 | Display errors inline in components | ✅ **Done** | `ErrorAlert` component in `AuthenticatedTasks` |
| 5 | Auth guard for task routes | ✅ **Done** | Implemented in `TasksSection.tsx` |

### What's Already Implemented

**Auth Guard (Step 5)** is fully implemented via `src/components/Tasks/TasksSection.tsx`:

```tsx
function AuthAwareTasksSection() {
  const { isLoading, isAuthenticated } = useConvexAuth()
  
  if (isLoading) {
    return <TasksLoadingFallback />
  }
  
  if (!isAuthenticated) {
    return <WelcomeSection />
  }
  
  return (
    <Suspense fallback={<TasksLoadingFallback />}>
      <AuthenticatedTasks />
    </Suspense>
  )
}
```

This prevents the primary "Not authenticated" error by only rendering task components for authenticated users.

### Addressed Risks

The following risks have been mitigated by the implemented error handling:

1. **Session expiry mid-use** - ✅ Handled by `useTasks` error state with user-friendly messages
2. **Other Convex errors** - ✅ `TasksError` with operation context provides specific error messages
3. **No crash recovery** - ✅ `ErrorBoundary` catches query errors with retry/reload options

## Affected Files

| File | Issue |
| ------ | ------- |
| `convex/tasks.ts` | Throws errors that propagate unhandled |
| `src/lib/effect/hooks/useTasks.ts` | `runPromise()` returns rejected promises, no error handling |
| `src/lib/effect/services/TasksService.ts` | `TasksError` defined but never caught |
| `src/routes/__root.tsx` | No Error Boundary for query failures |
| `src/components/Tasks/*` | No `.catch()` on mutation calls |

## Error Flow

```bash
convex/tasks.ts: throw new Error("Not authenticated")
        ↓
[Convex Server returns error to client]
        ↓
┌─────────────────────────────────────────────────────────────┐
│ QUERIES (api.tasks.get)                                     │
│   ConvexQueryClient → useSuspenseQuery → React Error        │
│   → No Error Boundary → APP CRASH                           │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ MUTATIONS (create/remove/toggle)                            │
│   ConvexService → ConvexMutationError                       │
│   → TasksService → TasksError                               │
│   → useTasks.runPromise() → Rejected Promise                │
│   → No .catch() → UNHANDLED REJECTION                       │
└─────────────────────────────────────────────────────────────┘
```

## Options

### Option 1: Add Error Boundary + Inline Error State (Recommended)

1. Add a React Error Boundary at the app root for query failures
2. Track error state in `useTasks` hook and expose it to components
3. Display errors inline within the component that triggered the action

**Pros**: Comprehensive coverage, contextual feedback, accessible, no external dependencies  
**Cons**: Components need to handle error display

### Option 2: Effect-Based Error Recovery

1. Use Effect's error channel to handle `TasksError` at the service layer
2. Add `Effect.catchTag` to provide fallback behavior
3. Surface errors via React state in `useTasks`

**Pros**: Leverages existing Effect infrastructure, type-safe errors  
**Cons**: More complex, requires Effect expertise

### Option 3: Redirect Unauthenticated Users ✅ IMPLEMENTED

1. Check authentication state before rendering task components
2. Redirect to `/api/auth/signin` if not authenticated
3. Queries/mutations only run for authenticated users

**Pros**: Prevents errors entirely, simple logic  
**Cons**: Doesn't handle session expiry mid-use, edge cases remain

## Effect-TS Analysis

### Where Effect-TS Helps vs. Pure React

| Step | Effect-TS Useful? | Reasoning |
| ------ | ------------------- | ----------- |
| **1 & 2: Error Boundary** | ❌ No | React-specific lifecycle pattern (`componentDidCatch`). Effect can't intercept React render errors. |
| **3: Error State in useTasks** | ✅ **Yes** | `TasksError` already has tagged unions—use Effect's error channel properly instead of `runPromise` throwing. |
| **4: Inline Error Display** | ⚠️ Partial | Effect provides typed errors, but displaying them is pure React. |

### Current Problem

The `runPromise` helper in `EffectProvider.tsx` **discards Effect's typed error handling**:

```tsx
// src/lib/effect/EffectProvider.tsx
runPromise: <A, E>(effect: Effect.Effect<A, E, AppServices>) =>
  runtime.runPromise(effect),
```

The well-typed `TasksError` gets converted to a rejected Promise, losing type information:

```tsx
// src/lib/effect/services/TasksService.ts
export class TasksError {
  readonly _tag = "TasksError";
  constructor(
    readonly operation: "create" | "delete" | "toggle",
    readonly cause: unknown
  ) {}
}
```

### Existing Effect Infrastructure

The codebase already has proper Effect error types:

- `ConvexQueryError` - wraps Convex query failures
- `ConvexMutationError` - wraps Convex mutation failures  
- `TasksError` - domain-level error with operation tag

These are mapped correctly in the service layer but lost at the React boundary.

## Recommended Implementation (Option 1 + Option 2 Hybrid)

Combine React Error Boundary with Effect-based error handling for mutations.

### Step 1: Add Error Boundary (Pure React)

```tsx
// src/components/ErrorBoundary.tsx
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="error-container">
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message}</p>
          <button onClick={() => window.location.href = '/api/auth/signin'}>
            Sign In
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

### Step 2: Wrap App in Error Boundary

```tsx
// src/routes/__root.tsx
import { ErrorBoundary } from '../components/ErrorBoundary';

function RootComponent() {
  return (
    <RootDocument>
      <Header />
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
    </RootDocument>
  );
}
```

### Step 3: Add Effect-Based Error Handling to useTasks (Effect-TS)

First, add `runPromiseExit` to the EffectProvider to preserve typed errors:

```tsx
// src/lib/effect/EffectProvider.tsx
import { Exit } from "effect";

interface EffectContextValue {
  runtime: ManagedRuntime.ManagedRuntime<AppServices, never>;
  runPromise: <A, E>(effect: Effect.Effect<A, E, AppServices>) => Promise<A>;
  runPromiseExit: <A, E>(effect: Effect.Effect<A, E, AppServices>) => Promise<Exit.Exit<A, E>>;
  runSync: <A, E>(effect: Effect.Effect<A, E, AppServices>) => A;
}

// In the provider:
runPromiseExit: <A, E>(effect: Effect.Effect<A, E, AppServices>) =>
  runtime.runPromise(Effect.exit(effect)),
```

Then update `useTasks` to use Exit for typed error handling:

```tsx
// src/lib/effect/hooks/useTasks.ts
import { useState, useCallback } from 'react';
import { Effect, Exit, Cause, Option } from 'effect';
import { TasksService, TasksError } from '../services/TasksService';

export function useTasks() {
  const { runPromiseExit } = useEffectRuntime();
  const [error, setError] = useState<{ message: string; operation?: string } | null>(null);

  const clearError = useCallback(() => setError(null), []);

  // Helper to extract user-friendly error message from TasksError
  const handleTasksError = useCallback((exit: Exit.Exit<unknown, TasksError>) => {
    if (Exit.isFailure(exit)) {
      const failureOption = Cause.failureOption(exit.cause);
      if (Option.isSome(failureOption)) {
        const tasksError = failureOption.value;
        setError({
          message: `Failed to ${tasksError.operation} task`,
          operation: tasksError.operation,
        });
      } else {
        setError({ message: 'An unexpected error occurred' });
      }
    }
  }, []);

  const addTask = useCallback(
    async (text: string) => {
      setError(null);
      const exit = await runPromiseExit(
        Effect.gen(function* () {
          const service = yield* TasksService;
          return yield* service.addTask(text);
        })
      );

      if (Exit.isFailure(exit)) {
        handleTasksError(exit);
        return undefined;
      }

      return exit.value;
    },
    [runPromiseExit, handleTasksError]
  );

  const deleteTask = useCallback(
    async (id: Id<"tasks">) => {
      setError(null);
      const exit = await runPromiseExit(
        Effect.gen(function* () {
          const service = yield* TasksService;
          return yield* service.deleteTask(id);
        })
      );

      if (Exit.isFailure(exit)) {
        handleTasksError(exit);
      }
    },
    [runPromiseExit, handleTasksError]
  );

  const toggleTask = useCallback(
    async (id: Id<"tasks">) => {
      setError(null);
      const exit = await runPromiseExit(
        Effect.gen(function* () {
          const service = yield* TasksService;
          return yield* service.toggleTask(id);
        })
      );

      if (Exit.isFailure(exit)) {
        handleTasksError(exit);
      }
    },
    [runPromiseExit, handleTasksError]
  );

  return {
    // ... existing returns
    error,      // Current error state with operation context
    clearError, // Reset error state
  };
}
```

### Step 4: Display Errors Inline in Components

```tsx
// src/components/Tasks/TaskForm.tsx
function TaskForm() {
  const { addTask, error, clearError } = useTasks();
  const [text, setText] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const result = await addTask(text);
    if (result !== undefined) {
      setText('');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input 
        value={text} 
        onChange={(e) => setText(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? 'task-error' : undefined}
      />
      <button type="submit">Add Task</button>
      
      {error && (
        <div id="task-error" role="alert" className="error-message">
          {error.message}
          <button type="button" onClick={clearError}>Dismiss</button>
        </div>
      )}
    </form>
  );
}
```

### Step 5: Add Auth Guard to Task Routes ✅ ALREADY IMPLEMENTED

Already implemented in `src/components/Tasks/TasksSection.tsx` using `useConvexAuth()`.

## Benefits of Effect-Based Approach

1. **Type-safe errors** - Know exactly what can fail (`TasksError` with operation tag)
2. **Rich error context** - `Cause` preserves the full error chain (Convex → TasksService)
3. **No thrown exceptions** - Explicit error handling, no unhandled rejections
4. **Operation-specific messages** - Use `TasksError.operation` for contextual messages like "Failed to create task" vs "Failed to delete task"
5. **Leverages existing infrastructure** - `TasksError` and `ConvexMutationError` are already defined

## Owner

Development Team

## Created

2024-12-23

## Severity

**Medium** - Causes poor UX and potential app crashes, but no security implications

## Status

**Resolved** - All error handling steps implemented 2024-12-23

### Progress

- [x] Step 1: ErrorBoundary component (`src/components/ErrorBoundary/`)
- [x] Step 2: Wrap app in ErrorBoundary (`src/routes/__root.tsx`)
- [x] Step 3: Effect-based error handling in useTasks (using `Exit` and `runPromiseExit`)
- [x] Step 4: Inline error display in components (`ErrorAlert` in `AuthenticatedTasks`)
- [x] Step 5: Auth guard (prevents most "Not authenticated" errors)
