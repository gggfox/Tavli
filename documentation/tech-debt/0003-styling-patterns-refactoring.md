# TDR-0003: Styling Patterns and Code Duplication

## Context

The codebase has accumulated several patterns that, while functional, create maintenance burden and inconsistency. These primarily involve inline styles, repeated hover handlers, and duplicated logic across components. As the application grows, these patterns become harder to maintain and extend.

## Impact

- **Verbose JSX**: 90+ inline `style={{...}}` declarations make components harder to read
- **Duplicated Logic**: Similar hover handlers repeated across 8 files (32 occurrences)
- **Inconsistent Patterns**: Some components use CSS variables inline, others could use Tailwind utilities
- **Maintenance Cost**: Changes to hover behavior require updates in multiple locations
- **Type Duplication**: Identical types defined in multiple files

## Affected Files

| File | Issue | Occurrences |
| ---- | ----- | ----------- |
| `src/components/Tasks/TaskItem.tsx` | Inline styles, hover handlers | 5 styles, 2 handlers |
| `src/components/Tasks/TaskForm.tsx` | Inline styles, hover handlers | 2 styles, 2 handlers |
| `src/components/Sidebar/Sidebar.tsx` | Inline styles, hover handlers | 20 styles, 6 handlers |
| `src/components/Sidebar/SidebarUserSection.tsx` | Duplicated avatar rendering, hover handlers | 9 styles, 2 handlers |
| `src/components/Sidebar/SidebarAuthSection.tsx` | Hover handlers | 8 handlers |
| `src/components/WelcomeSection.tsx` | Inline styles, hover handlers | 18 styles, 4 handlers |
| `src/components/ErrorBoundary/ErrorBoundary.tsx` | Inline styles, hover handlers | 8 styles, 6 handlers |
| `src/components/Tasks/ErrorAlert.tsx` | Hover handlers | 2 handlers |
| `src/lib/effect/utils/extractError.ts` | `TaskOperation` type | 1 |
| `src/lib/effect/stores/TasksDebugStore.ts` | `TaskOperationType` type (duplicate) | 1 |

## Issue Details

### 1. Inline Hover Handlers (High Priority)

The same hover pattern is repeated throughout the codebase:

```tsx
// Pattern repeated in 8 files, 32+ times
onMouseEnter={(e) => {
  e.currentTarget.style.backgroundColor = 'var(--bg-hover)'
  e.currentTarget.style.color = 'var(--text-primary)'
}}
onMouseLeave={(e) => {
  e.currentTarget.style.backgroundColor = 'transparent'
  e.currentTarget.style.color = 'var(--text-tertiary)'
}}
```

**Current workaround**: `Sidebar.tsx` already extracts these into reusable handlers:

```tsx
// Already in Sidebar.tsx - could be shared
const handleIconHoverEnter = (e: MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.backgroundColor = 'var(--bg-hover)'
  e.currentTarget.style.color = 'var(--text-primary)'
}
```

### 2. Excessive Inline Styles (Medium Priority)

CSS variables are used correctly, but applied via inline styles instead of utility classes:

```tsx
// Current: verbose inline styles
<div
  className="p-4 rounded-xl"
  style={{
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-default)'
  }}
>

// Preferred: Tailwind arbitrary values
<div className="p-4 rounded-xl bg-(--bg-secondary) border border-(--border-default)">
```

### 3. Duplicated Error Handling Logic (Medium Priority)

Both `TaskForm.tsx` and `AuthenticatedTasks.tsx` implement similar Exit error extraction:

```tsx
// TaskForm.tsx (lines 83-110)
function getErrorMessage<E>(exit: Exit.Exit<unknown, E>): string {
  if (Exit.isSuccess(exit)) return ""
  const failureOption = Cause.failureOption(exit.cause)
  if (Option.isSome(failureOption)) {
    const error = failureOption.value
    if (error && typeof error === "object" && "operation" in error && "cause" in error) {
      // ... extract message
    }
  }
  // ... handle defects
}

// AuthenticatedTasks.tsx (lines 37-57)
const handleExitError = useCallback(<A,>(exit: Exit.Exit<A, TasksError>): boolean => {
  if (Exit.isSuccess(exit)) return true
  const failureOption = Cause.failureOption(exit.cause)
  if (Option.isSome(failureOption)) {
    // ... similar logic
  }
  // ...
}, [])
```

### 4. Duplicated Type Definitions (Low Priority)

```tsx
// src/lib/effect/utils/extractError.ts
export type TaskOperation = "create" | "delete" | "toggle";

// src/lib/effect/stores/TasksDebugStore.ts
export type TaskOperationType = "create" | "delete" | "toggle"
```

### 5. Duplicated Avatar Rendering (Low Priority)

`SidebarUserSection.tsx` renders the same avatar logic twice for expanded/collapsed states:

```tsx
// Expanded state (lines 23-40)
{user.profilePictureUrl ? (
  <img src={user.profilePictureUrl} ... />
) : (
  <div className="...">{user.firstName?.[0] || ...}</div>
)}

// Collapsed state (lines 72-89)
{user.profilePictureUrl ? (
  <img src={user.profilePictureUrl} ... />  // Same logic
) : (
  <div className="...">{user.firstName?.[0] || ...}</div>  // Same logic
)}
```

### 6. Feature Cards Pattern (Low Priority)

`WelcomeSection.tsx` has three nearly identical feature card structures, despite `src/data/features.tsx` existing with typed feature data:

```tsx
// Current: Repeated JSX (lines 34-68)
<div className="p-4 rounded-xl" style={{ ... }}>
  <CheckCircle2 ... />
  <h3>Simple Tasks</h3>
  <p>Create, complete...</p>
</div>
<div className="p-4 rounded-xl" style={{ ... }}>
  <Zap ... />
  <h3>Real-time Sync</h3>
  <p>Powered by Convex...</p>
</div>
// ... third card

// Preferred: Map over data
{features.map((feature) => (
  <FeatureCard key={feature.title} {...feature} />
))}
```

## Options

### Option 1: Extract Shared UI Utilities (Recommended)

Create a shared utilities module for common patterns.

**Implementation:**

1. Create `src/lib/ui/hover.ts` with reusable hover handlers
2. Create `src/components/ui/Avatar.tsx` component
3. Extract Exit error handling to `src/lib/effect/utils/exitHelpers.ts`
4. Consolidate `TaskOperation` type in one location

**Pros:**

- Centralized maintenance
- Consistent behavior
- Type-safe
- Gradual migration possible

**Cons:**

- Additional abstraction layer
- Need to update imports across files

### Option 2: CSS-Only Hover States

Replace JavaScript hover handlers with CSS `:hover` pseudo-classes via Tailwind.

**Implementation:**

```tsx
// Instead of onMouseEnter/Leave
<button className="text-(--text-tertiary) hover:bg-(--bg-hover) hover:text-(--text-primary) transition-colors">
```

**Pros:**

- No JavaScript needed
- Better performance
- Standard CSS patterns
- Works with SSR

**Cons:**

- Some complex hover states harder to express
- Need to verify Tailwind arbitrary value support for all CSS variables

### Option 3: Component Library Extraction

Create a small internal component library with styled primitives.

**Implementation:**

```tsx
// src/components/ui/Button.tsx
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}

// src/components/ui/Avatar.tsx
interface AvatarProps {
  src?: string
  fallback: string
  size?: 'sm' | 'md' | 'lg'
}
```

**Pros:**

- Consistent design system
- Self-documenting components
- Easier testing

**Cons:**

- Higher initial investment
- May be overkill for current app size

## Recommended Implementation

### Phase 1: Quick Wins (Low Effort)

**Step 1: Consolidate types** - Move `TaskOperationType` to `extractError.ts` and re-export

```tsx
// src/lib/effect/utils/extractError.ts
export type TaskOperation = "create" | "delete" | "toggle";

// src/lib/effect/stores/TasksDebugStore.ts
import type { TaskOperation } from "../utils/extractError";
export type { TaskOperation as TaskOperationType };  // Backward compat
```

**Step 2: Extract Exit error helper** - Create shared `extractExitError()` function

```tsx
// src/lib/effect/utils/exitHelpers.ts
export function extractExitError<E>(
  exit: Exit.Exit<unknown, E>
): { message: string; operation?: string } | null {
  if (Exit.isSuccess(exit)) return null;
  // ... consolidated logic
}
```

### Phase 2: CSS Hover Migration (Medium Effort)

Convert inline hover handlers to CSS classes where possible:

```css
/* src/styles.css - add utility classes */
.hover-icon {
  color: var(--text-tertiary);
  background-color: transparent;
  transition: background-color 0.15s, color 0.15s;
}

.hover-icon:hover {
  color: var(--text-primary);
  background-color: var(--bg-hover);
}
```

### Phase 3: Component Extraction (Higher Effort)

1. Create `<Avatar>` component
2. Create `<FeatureCard>` component
3. Consider `<IconButton>` with built-in hover states

## Success Criteria

| Metric | Current | Target |
| ------ | ------- | ------ |
| Inline hover handlers | 32 | < 5 |
| Duplicated Exit handling | 2 files | 1 shared utility |
| Duplicated types | 2 | 1 canonical location |
| Avatar implementations | 2 | 1 shared component |

## Owner

Development Team

## Created

2024-12-24

## Resolved

2024-12-24

## Severity

**Low** - Code quality and maintainability issue, no user-facing impact

## Status

**Resolved** - All phases completed

### Progress

- [x] Phase 1: Consolidate types and extract Exit helper
- [x] Phase 2: CSS hover migration
- [x] Phase 3: Component extraction (Avatar, FeatureCard)

## Resolution Summary

### Phase 1: Type Consolidation & Exit Helper

- **Consolidated types**: `TaskOperationType` in `TasksDebugStore.ts` now imports from `extractError.ts`
- **Created `extractExitError()`**: Shared utility function in `extractError.ts` that handles Exit failure extraction
- **Simplified components**: `TaskForm.tsx` and `AuthenticatedTasks.tsx` now use the shared utility

### Phase 2: CSS Hover Migration

Added utility classes to `src/styles.css`:

- `.hover-icon` - Icon button hover (tertiary → primary)
- `.hover-secondary` - Secondary text hover
- `.hover-bg` - Background-only hover
- `.hover-btn-primary` - Primary button hover
- `.hover-btn-secondary` - Secondary button hover
- `.hover-danger` - Danger/delete hover (muted → red)
- `.hover-opacity` - Opacity fade hover

**Migrated components**:

- `Sidebar.tsx` - Removed 4 JS hover handlers
- `SidebarUserSection.tsx` - Removed 2 JS hover handlers
- `SidebarAuthSection.tsx` - Removed 8 JS hover handlers
- `TaskItem.tsx` - Removed 2 JS hover handlers
- `TaskForm.tsx` - Removed 2 JS hover handlers
- `WelcomeSection.tsx` - Removed 4 JS hover handlers
- `ErrorBoundary.tsx` - Removed 6 JS hover handlers
- `ErrorAlert.tsx` - Removed 2 JS hover handlers

### Phase 3: Component Extraction

Created `src/components/ui/` with shared components:

1. **`Avatar.tsx`**
   - Handles image or fallback initials
   - Supports sizes: `sm`, `md`, `lg`
   - Includes `getAvatarFallback()` helper
   - Used by `SidebarUserSection.tsx`

2. **`FeatureCard.tsx`**
   - Consistent feature card styling
   - Props: `icon`, `title`, `description`, `iconColor`
   - Used by `WelcomeSection.tsx`

### Final Metrics

| Metric | Before | After |
| ------ | ------ | ----- |
| Inline hover handlers | 32 | 0 |
| Duplicated Exit handling | 2 files | 1 shared utility |
| Duplicated types | 2 | 1 canonical location |
| Avatar implementations | 2 | 1 shared component |
