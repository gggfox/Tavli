# Design System Guide

This document outlines the design standards and patterns used throughout Fierro Viejo. Follow these guidelines when creating new components to maintain visual consistency.

## Table of Contents

- [Philosophy](#philosophy)
- [Color Palette](#color-palette)
- [Typography](#typography)
- [Spacing & Layout](#spacing--layout)
- [Components](#components)
- [Animations & Transitions](#animations--transitions)
- [Icons](#icons)
- [Patterns](#patterns)
- [Accessibility](#accessibility)

---

## Philosophy

The design follows a **Notion-inspired, minimal dark theme** with these principles:

1. **Subtle over flashy** – Use low-opacity whites (`white/5`, `white/10`) instead of solid colors for backgrounds
2. **Reveal on interaction** – Hide secondary actions until hover (e.g., delete buttons)
3. **Adaptive layouts** – Components should gracefully collapse/expand (like the sidebar)
4. **Consistent depth** – Use opacity layers to create hierarchy, not shadows

---

## Color Palette

### Background Colors

| Token          | Value                    | Usage                         |
| -------------- | ------------------------ | ----------------------------- |
| `bg-[#0f0f0f]` | `#0f0f0f`                | Page/main content background  |
| `bg-[#191919]` | `#191919`                | Sidebar, elevated surfaces    |
| `bg-white/5`   | `rgba(255,255,255,0.05)` | Subtle hover states, cards    |
| `bg-white/10`  | `rgba(255,255,255,0.10)` | Active states, selected items |

### Border Colors

| Token                 | Usage                                |
| --------------------- | ------------------------------------ |
| `border-white/5`      | Subtle dividers, card borders        |
| `border-white/10`     | More visible dividers, input borders |
| `border-amber-500/20` | Accent borders (badges, highlights)  |

### Text Colors

| Token | Usage |
| ------- | ------- |
| `text-white` | Primary text, headings, active items |
| `text-gray-300` | Secondary text (sidebar default) |
| `text-gray-400` | Tertiary text, inactive navigation |
| `text-gray-500` | Muted text, labels, descriptions |
| `text-gray-600` | Very muted (placeholder-like) |

### Accent Colors

| Color       | Token                    | Usage                                  |
| ----------- | ------------------------ | -------------------------------------- |
| **Amber**   | `amber-500`, `amber-600` | Primary accent, CTAs, brand highlights |
| **Emerald** | `emerald-500`            | Success states, completed items        |
| **Blue**    | `blue-500`               | Information, links                     |
| **Red**     | `red-400`                | Destructive actions (delete)           |
| **Orange**  | `orange-600`             | Gradients (user avatars)               |

### Gradients

```css
/* User avatar fallback */
bg-gradient-to-br from-amber-500 to-orange-600
```

---

## Typography

### Font Families

```css
/* Body text */
font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif;

/* Code/monospace */
font-family: "JetBrains Mono", source-code-pro, Menlo, Monaco, Consolas, monospace;
```

### Font Sizes

| Class | Usage |
| ------- | ------- |
| `text-xs` | Labels, badges, meta text |
| `text-sm` | Navigation items, form labels, body text |
| `text-base` | Default body text |
| `text-lg` | Subheadings, emphasized text |
| `text-xl` | Section headings |
| `text-4xl md:text-5xl` | Hero headings |

### Font Weights

| Class           | Usage                         |
| --------------- | ----------------------------- |
| `font-medium`   | Navigation items, card titles |
| `font-semibold` | Section headings, brand name  |
| `font-bold`     | Hero headings                 |

### Tracking (Letter Spacing)

| Class            | Usage                |
| ---------------- | -------------------- |
| `tracking-tight` | Headings, brand name |
| `tracking-wider` | Uppercase labels     |

---

## Spacing & Layout

### Sidebar Dimensions

| State         | Width          |
| ------------- | -------------- |
| Expanded      | `w-60` (240px) |
| Collapsed     | `w-14` (56px)  |
| Header height | `h-12` (48px)  |

### Common Spacing Patterns

```tsx
// Navigation items
className="px-3 py-2"

// Section padding
className="p-2"  // Sidebar sections
className="px-6 py-4"  // Content areas

// Gaps
className="gap-2"  // Tight (buttons, small groups)
className="gap-3"  // Normal (nav items, list items)
className="gap-4"  // Spacious (cards, sections)
```

### Border Radius

| Class          | Usage                         |
| -------------- | ----------------------------- |
| `rounded-md`   | Small elements (icon buttons) |
| `rounded-lg`   | Navigation items, list items  |
| `rounded-xl`   | Cards, inputs, buttons        |
| `rounded-full` | Avatars, badges, pills        |

---

## Components

### Navigation Link

```tsx
const navLinkClass = (isActive: boolean) =>
  `flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 ${
    isActive
      ? 'bg-white/10 text-white'
      : 'text-gray-400 hover:text-white hover:bg-white/5'
  }`
```

### Icon Button

```tsx
<button className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
  <Icon size={18} />
</button>
```

### Primary Button (CTA)

```tsx
<button className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl transition-colors">
  Label
</button>
```

### Secondary Button

```tsx
<button className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors text-white">
  Label
</button>
```

### Text Input

```tsx
<input className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/50 focus:bg-white/[0.07] transition-all" />
```

### Card

```tsx
<div className="p-4 bg-white/5 rounded-xl border border-white/5">
  {/* content */}
</div>
```

### Badge/Pill

```tsx
<div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-500 text-sm">
  <Icon size={14} />
  <span>Label</span>
</div>
```

### List Item (with hover reveal)

```tsx
<div className="group px-3 py-2.5 rounded-lg flex items-center justify-between hover:bg-white/5 transition-all">
  <span>Content</span>
  <button className="opacity-0 group-hover:opacity-100 transition-all">
    <Icon size={16} />
  </button>
</div>
```

### User Avatar

```tsx
// With image
<img className="w-8 h-8 rounded-full object-cover ring-2 ring-white/10" />

// Fallback (initials)
<div className="w-8 h-8 rounded-full bg-linear-to-br from-amber-500 to-orange-600 flex items-center justify-center text-sm font-semibold text-white">
  {initial}
</div>
```

### Section Divider

```tsx
<div className="h-px bg-white/5 my-2" />
```

### Section Label

```tsx
<p className="px-3 py-1 text-xs font-medium text-gray-500 uppercase tracking-wider">
  Section Name
</p>
```

---

## Animations & Transitions

### Standard Transitions

| Class                | Usage                        |
| -------------------- | ---------------------------- |
| `transition-colors`  | Color changes (hover states) |
| `transition-all`     | Multiple properties changing |
| `transition-opacity` | Fade in/out                  |

### Durations

| Class          | Usage                         |
| -------------- | ----------------------------- |
| `duration-200` | Quick interactions (hover)    |
| `duration-300` | Standard animations (sidebar) |

### Easing

```tsx
ease-in-out  // Default for most animations
```

### Sidebar Animation

```tsx
className={`transition-all duration-300 ease-in-out ${isExpanded ? 'w-60' : 'w-14'}`}
```

### Reveal on Hover

```tsx
// Parent
className="group"

// Child to reveal
className="opacity-0 group-hover:opacity-100 transition-all"
```

### Progress Bar

```tsx
<div className="h-1 bg-white/5 rounded-full overflow-hidden">
  <div
    className="h-full bg-emerald-500 transition-all duration-300"
    style={{ width: `${percent}%` }}
  />
</div>
```

---

## Icons

### Library

We use **Lucide React** for all icons.

```tsx
import { Home, Settings, ChevronRight } from 'lucide-react'
```

### Sizes

| Size | Usage |
| ------ | ------- |
| `14` | Inline icons, chevrons in compact areas |
| `16` | Small buttons, list item actions |
| `18` | Navigation items, standard buttons |
| `20` | Larger buttons, prominent actions |
| `24` | Feature icons, empty states |
| `48` | Hero illustrations, large empty states |

### Common Icons

| Icon | Usage |
| ------ | ------- |
| `Home` | Home/dashboard navigation |
| `ChevronRight`, `ChevronDown` | Expandable sections |
| `PanelLeftClose`, `PanelLeftOpen` | Sidebar toggle |
| `LogIn`, `LogOut` | Authentication |
| `UserPlus` | Sign up |
| `Circle`, `CheckCircle2` | Task states |
| `Trash2` | Delete action |
| `Plus` | Add/create action |
| `Zap` | Features, highlights |
| `Shield` | Security features |

### Icon Button Pattern

Always use `shrink-0` to prevent icons from shrinking in flex containers:

```tsx
<Icon size={18} className="shrink-0" />
```

---

## Patterns

### Collapsed/Expanded State

Components should adapt to collapsed states gracefully:

```tsx
// Show/hide text based on state
{isExpanded && <span className="text-sm truncate">Label</span>}

// Add tooltips when collapsed
title={isExpanded ? undefined : 'Label'}

// Center content when collapsed
className={isExpanded ? '' : 'justify-center'}
```

### Hydration Safety

For components using browser APIs or auth state, wait for client hydration:

```tsx
const [isMounted, setIsMounted] = useState(false)

useEffect(() => {
  setIsMounted(true)
}, [])

if (!isMounted) {
  return <LoadingSkeleton />
}
```

### LocalStorage Persistence

For UI state that should persist (like sidebar expanded state):

```tsx
useEffect(() => {
  const saved = localStorage.getItem('key')
  if (saved !== null) {
    setState(saved === 'true')
  }
}, [])

const toggle = () => {
  const newState = !state
  setState(newState)
  localStorage.setItem('key', String(newState))
}
```

### Empty States

```tsx
<div className="text-center py-12">
  <Icon size={48} className="mx-auto text-gray-600 mb-4" />
  <p className="text-gray-500">Empty state message</p>
</div>
```

### Loading States

```tsx
// Skeleton placeholder
<div className="w-8 h-8 rounded-full bg-gray-600 animate-pulse" />

// For content areas
<div className="space-y-2">
  <div className="h-4 bg-white/5 rounded animate-pulse" />
  <div className="h-4 bg-white/5 rounded animate-pulse w-3/4" />
</div>
```

---

## Accessibility

### Focus States

Inputs should have visible focus states:

```tsx
focus:outline-none focus:border-amber-500/50
```

### ARIA Labels

Always add aria-labels for icon-only buttons:

```tsx
<button aria-label="Delete task">
  <Trash2 size={16} />
</button>
```

### Keyboard Navigation

Interactive elements should be focusable and have hover states that also apply to focus:

```tsx
className="hover:bg-white/5 focus:bg-white/5"
```

### Screen Reader Text

For actions that rely on visual context, ensure screen readers get full context:

```tsx
<button
  aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
>
```

---

## Quick Reference

### Creating a New Component Checklist

- [ ] Use `#0f0f0f` or `#191919` for backgrounds
- [ ] Use `white/5` for hover states, `white/10` for active
- [ ] Use `text-gray-400` for default, `text-white` for active/hover
- [ ] Use `amber-500/600` for primary accents
- [ ] Add `transition-colors` or `transition-all` for interactions
- [ ] Use `rounded-lg` for containers, `rounded-xl` for cards
- [ ] Use Lucide icons at size 18 for standard buttons
- [ ] Hide secondary actions with `opacity-0 group-hover:opacity-100`
- [ ] Add proper aria-labels for icon buttons
- [ ] Handle hydration with `isMounted` state if using browser APIs

### Color at a Glance

```bash
Backgrounds:    #0f0f0f (page) → #191919 (sidebar) → white/5 (cards)
Text:           white → gray-300 → gray-400 → gray-500
Accent:         amber-500/600 (primary), emerald-500 (success), red-400 (danger)
Borders:        white/5 (subtle) → white/10 (visible)
```
