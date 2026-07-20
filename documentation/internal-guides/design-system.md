# Design System Guide

How to colour, space and compose UI in Tavli. The source of truth is
[`src/global/styles/`](../../src/global/styles) — this document explains it;
where the two disagree, the CSS wins.

> **This guide was rewritten.** The previous version described a dark-only,
> hard-coded palette (`bg-[#0f0f0f]`, `white/5`, `amber-500`) from before the
> theme system existed. None of that applies any more. If you find code that
> still looks like it, it predates the token system and should be migrated.

## Table of Contents

- [How theming works](#how-theming-works)
- [Colour tokens](#colour-tokens)
- [Using colour in components](#using-colour-in-components)
- [Escape hatches](#escape-hatches)
- [Typography](#typography)
- [Spacing, radius and layout](#spacing-radius-and-layout)
- [Interaction utilities](#interaction-utilities)
- [Icons](#icons)
- [Shared components](#shared-components)
- [Accessibility](#accessibility)
- [Checklist for a new component](#checklist-for-a-new-component)

---

## How theming works

Tailwind v4, no `tailwind.config.js`. Everything is declared in CSS:

```
src/global/styles/index.css      @import "tailwindcss" + the three files below
src/global/styles/theme.css      the tokens (this is the one you care about)
src/global/styles/base.css       document defaults, scrollbars, theme transition
src/global/styles/utilities.css  hover/animation helper classes
```

Colour is declared in **two layers**:

1. **CSS custom properties** on `:root` (light) and `.dark` (dark). A single
   class flip on `<html>` restyles the whole tree — no JS re-render, no
   per-component theme branching. The `.dark` class is applied before first
   paint by an inline script in `src/routes/__root.tsx`.
2. **A Tailwind `@theme` block** that aliases each custom property under the
   `--color-*` namespace. That is what generates the utilities you actually
   write: `--color-background` produces `bg-background`, `text-background`,
   `border-background`, and so on.

Because the `@theme` values are `var(...)` references, Tailwind generates each
utility exactly once and the cascade does the light/dark switching.

**Light mode is the default.** Dark mode is opt-in via the `.dark` class.

---

## Colour tokens

Names are hybrid: shadcn/ui canonical names where a surface maps cleanly,
custom flat names where the palette is richer than shadcn's.

### Surfaces

| Utility         | Token            | Use                                |
| --------------- | ---------------- | ---------------------------------- |
| `bg-background` | `--bg-primary`   | Page and main content background   |
| `bg-card`       | `--bg-elevated`  | Cards, modals, popovers            |
| `bg-muted`      | `--bg-secondary` | Panels, table chrome, inset areas  |
| `bg-tertiary`   | `--bg-tertiary`  | Third-level fills                  |
| `bg-hover`      | `--bg-hover`     | Hover fill (translucent)           |
| `bg-active`     | `--bg-active`    | Selected/active fill (translucent) |

### Text

| Utility                   | Token              | Use                                                        |
| ------------------------- | ------------------ | ---------------------------------------------------------- |
| `text-foreground`         | `--text-primary`   | Primary copy, headings                                     |
| `text-muted-foreground`   | `--text-secondary` | Secondary copy, labels                                     |
| `text-soft-foreground`    | `--text-tertiary`  | Tertiary copy                                              |
| `text-faint-foreground`   | `--text-muted`     | Placeholders, disabled-looking meta text                   |
| `text-inverse-foreground` | `--text-inverse`   | Text on an inverted **surface** — flips with the theme     |
| `text-on-accent`          | `--text-on-accent` | Text on a saturated **accent fill** — white in both themes |

`--text-inverse` and `--text-on-accent` are not interchangeable. A status pill
filled with `--accent-info` stays saturated in dark mode, so its label wants
`text-on-accent` (always white); `text-inverse-foreground` would turn it dark
and destroy the contrast.

### Borders

| Utility                | Token              |
| ---------------------- | ------------------ |
| `border-border`        | `--border-default` |
| `border-border-strong` | `--border-strong`  |

### Interactive

| Utility                     | Token                  |
| --------------------------- | ---------------------- |
| `bg-primary`                | `--btn-primary-bg`     |
| `text-primary-foreground`   | `--btn-primary-text`   |
| `bg-secondary`              | `--btn-secondary-bg`   |
| `text-secondary-foreground` | `--btn-secondary-text` |
| `bg-disabled`               | `--btn-disabled-bg`    |
| `text-disabled-foreground`  | `--btn-disabled-text`  |

Inputs: `bg-input`, `border-input-border`, `border-input-border-focus`,
`text-input-placeholder`.

### Status

Every status tone comes as a saturated colour plus a `-subtle` tint for
backgrounds:

| Tone        | Foreground              | Subtle background       |
| ----------- | ----------------------- | ----------------------- |
| Success     | `text-success`          | `bg-success-subtle`     |
| Warning     | `text-warning`          | `bg-warning-subtle`     |
| Destructive | `text-destructive`      | `bg-destructive-subtle` |
| Info        | `text-info`             | `bg-info-subtle`        |
| Neutral     | `text-muted-foreground` | `bg-neutral-subtle`     |

Prep-station tones (`--station-kitchen*`, `--station-bar*`) are intentionally
distinct from the status tones so the two filter rows on the OrderDashboard
read as orthogonal concerns — see ADR 005.

### Other

`--shadow-sm/md/lg`, `--scrollbar-thumb`, `--overlay-scrim` (scrim behind
controls floating over imagery, where neither theme's surfaces apply).

---

## Using colour in components

**Reach for a utility class.**

```tsx
<div className="bg-card border border-border rounded-xl p-4">
	<h3 className="text-foreground font-semibold">Title</h3>
	<p className="text-muted-foreground text-sm">Body</p>
</div>
```

Do **not** write raw hex, `rgba()`, or Tailwind's stock palette
(`bg-gray-800`, `text-red-500`, `amber-500`). Those do not follow the theme,
and a colour that looks fine in dark mode is usually unreadable in light.

```tsx
// ✗ wrong — none of these respond to the theme
<div className="bg-[#191919]" />
<p style={{ color: "#dc2626" }} />
<span style={{ backgroundColor: "rgba(217, 119, 6, 0.1)" }} />

// ✓ right
<div className="bg-card" />
<p className="text-destructive" />
<span className="bg-warning-subtle" />
```

---

## Escape hatches

There are exactly two legitimate reasons to leave the utility classes.

**1. A value computed at runtime.** Palette maps that pick a colour from data
(`STATUS_TONE_PALETTE`, `STATION_CONFIG`) hold `var(--…)` strings and are
applied via inline `style`. The value is still a token — only the _choice_ is
dynamic:

```ts
solidBg: "var(--accent-info)",
solidFg: "var(--text-on-accent)",
```

**2. A surface that cannot read our CSS.** Stripe Elements renders in a
cross-origin iframe, so `var(--bg-elevated)` resolves to nothing inside it and
Stripe's `Appearance.variables` only accepts literal colours. That single case
lives in `src/features/ordering/stripeAppearanceTokens.ts` — one map, keyed by
the token each value mirrors, rather than hexes scattered through the checkout
component.

Anything else is a bug.

---

## Typography

The body font stack is set once on `html, body` in `base.css` (system UI
stack); `code` gets a monospace stack. Components should not set
`font-family`.

| Class                         | Use                                     |
| ----------------------------- | --------------------------------------- |
| `text-[10px]` / `text-[11px]` | Dense badge/meta text                   |
| `text-xs`                     | Labels, badges, meta                    |
| `text-sm`                     | Navigation, form labels, most body text |
| `text-base`                   | Emphasised body                         |
| `text-lg`                     | Card and section headings               |
| `text-xl`                     | Page headings                           |
| `text-2xl`                    | Route-level titles                      |

Weights: `font-medium` (nav items, card titles), `font-semibold` (headings),
`font-bold` (numbers, totals, page heroes). Use `tabular-nums` for anything
numeric that sits in a column.

---

## Spacing, radius and layout

Standard paddings: `px-3 py-2` (nav/list rows), `px-4 py-3` (table cells,
notices), `p-4` (cards), `p-6` (page shells). Gaps: `gap-2` tight, `gap-3`
normal, `gap-4` spacious.

Radius: `rounded-md` (icon buttons), `rounded-lg` (rows, inputs, notices),
`rounded-xl` (cards, primary buttons), `rounded-full` (avatars, pills).

**Scrolling.** The app shell is `h-dvh` with `overflow-hidden`; scrolling
happens in one designated container per page (`AdminPageLayout`'s inner
`overflow-y-auto` column, or the root `<main>`). Do not add a second
`overflow-auto` inside it — nested scrollbars break sticky chrome. Long lists
should virtualize instead: use `VirtualGrid`, which reuses the ancestor
scroller.

Flex columns that need to scroll need `min-h-0 flex-1` on every level, or the
child will grow past its parent instead of scrolling.

---

## Interaction utilities

`utilities.css` provides composite hover classes so components do not
re-implement hover colours (and never with JS handlers):

| Class                 | Behaviour                                     |
| --------------------- | --------------------------------------------- |
| `hover-icon`          | Tertiary → primary text, hover fill           |
| `hover-secondary`     | Secondary → primary text, hover fill          |
| `hover-bg`            | Transparent → hover fill                      |
| `hover-btn-primary`   | Filled primary button, incl. its hover colour |
| `hover-btn-secondary` | Filled secondary button                       |
| `hover-btn-danger`    | Filled destructive button                     |
| `hover-btn-ghost`     | Transparent until hover                       |
| `hover-danger`        | Muted → destructive (delete affordances)      |
| `hover-opacity`       | Fade to 70 % (dismiss buttons)                |
| `animate-slide-up`    | Bottom-sheet entry                            |

A primary button is just `className="px-6 py-2.5 rounded-lg font-medium hover-btn-primary"` —
the class already carries background _and_ foreground.

Transitions: `transition-colors` for colour changes, `transition-all` when
several properties move, `duration-200`/`duration-300`. Reveal-on-hover uses
`group` on the parent and `opacity-0 group-hover:opacity-100` on the child.

---

## Icons

[Lucide React](https://lucide.dev). Sizes: `12`–`14` inline/badges, `16` list
actions, `18` standard buttons and nav, `20` prominent actions, `24`–`48`
empty states and hero illustrations. Always `shrink-0` inside a flex row.
Icons inherit `currentColor`, so colour them with a text utility
(`text-muted-foreground`), never a `color` style.

---

## Shared components

Prefer these over rebuilding the pattern (all from `@/global/components`):

| Component                              | For                                                       |
| -------------------------------------- | --------------------------------------------------------- |
| `AdminPageLayout`                      | Admin page shell: sticky breadcrumb/actions/toolbar row   |
| `DashboardShell`                       | loading → error → content triad with localized error copy |
| `EmptyState`                           | Empty and "nothing matched" states                        |
| `ErrorBoundary`                        | Render-error boundary                                     |
| `RouteErrorComponent`                  | Router error boundary (wired as `defaultErrorComponent`)  |
| `InlineError`                          | Inline, dismissible error notice                          |
| `Modal` / `Dialog`                     | Overlays                                                  |
| `AdminTable`, `Pagination`, `SortIcon` | Data tables                                               |
| `StatusBadge`, `StatusFilterChips`     | Status pills and filter rows                              |
| `SearchInput`                          | Debounced search field                                    |
| `Skeleton`                             | Loading placeholders                                      |
| `VirtualGrid`                          | Long card grids (virtualized)                             |
| `Avatar`                               | User avatars, with initials fallback                      |

---

## Accessibility

- Icon-only buttons need `aria-label`; label them with a translated string,
  not English prose.
- Focus must be visible: `focus:outline-none focus:ring-2 focus:ring-offset-2`
  (or `focus-visible:` variants), never `outline-none` alone.
- Toggle buttons need `aria-pressed`; the current nav item needs
  `aria-current="page"`.
- Filter groups are a `<fieldset>` with an `sr-only` `<legend>`.
- Purely decorative SVG gets `aria-hidden="true"`.
- Every user-facing string goes through i18next (`t(SomeKeys.X)`) — the app is
  bilingual. Never hard-code English in a component.

---

## Checklist for a new component

- [ ] Colour comes from token utilities only — no hex, no `rgba()`, no
      `gray-*`/`amber-*`.
- [ ] Verified in **both** light and dark mode.
- [ ] Hover/active states use a `hover-*` utility rather than bespoke classes.
- [ ] Radius and spacing match the scales above.
- [ ] Lucide icons at a standard size, with `shrink-0`.
- [ ] All copy routed through i18next keys.
- [ ] `aria-label` on icon-only buttons; visible focus ring.
- [ ] No new nested scroll container; long lists virtualized.
- [ ] Placed in the right layer (`global/` if shared, `features/<name>/` if
      not) — the ESLint `boundaries` plugin enforces this.
