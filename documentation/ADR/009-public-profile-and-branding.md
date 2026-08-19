# ADR-009: Restaurant public profile and server-resolved branding

## Metadata

| Field             | Value         |
| ----------------- | ------------- |
| **Status**        | Proposed      |
| **Date**          | 2026-08-13    |
| **Author(s)**     | Gerardo Galan |
| **Supersedes**    | —             |
| **Superseded by** | —             |

> **Implementation status.** The **Public profile** half of this ADR is
> implemented. The **Branding** half (brand colour, font, logo, header image)
> is designed and decided here but not yet built — hence _Proposed_ rather than
> _Accepted_. Accept it when the branding work lands.

## Context

A diner ordering through Tavli experienced a generic product, not the
restaurant they were sitting in. Two distinct gaps caused that.

**Nothing told the diner who they were ordering from.** Across the whole
`/r/$slug` tree the restaurant's name appeared in exactly one place — the
reservation page's `<h1>`. There was no contact information anywhere, and no
schema field for a phone, an address, or a social link. The receipt email told
the diner "For a factura, contact the restaurant" while withholding the only
address the system had.

**`supportEmail` was private by construction.** It was documented as "where
dashboard error reports are routed", and `toPublicRestaurant` — the allowlist
of fields anonymous diners may see — deliberately excluded it. A restaurant
owner who filled it in reasonably expected diners to see it; they never did.

**Nothing about the pages looked like the restaurant.** Every colour flows
through CSS custom properties that Tailwind v4 `@theme` aliases, so the
plumbing for per-restaurant colour existed, but no field fed it.

Constraints that shaped the answer: the app is bilingual; `convex/` may never
import from `src/`; nothing in the app prefetches Convex during SSR; and image
uploads had no size or MIME validation anywhere.

## Decision

**1. Vocabulary.** The diner-visible contact details are a restaurant's
**Public profile**. Its visual identity is **Branding**. "Theme" keeps its
existing meaning — light/dark, and nothing else. A **Brand color** composes
with theme rather than replacing it.

**2. `supportEmail` is widened, not split.** It becomes the restaurant's
**Contact email**: one address shown to diners, used as the receipt `reply_to`,
as the dashboard-error-report destination, and as the platform-fee billing
recipient. There is no separate internal support address. Most restaurants run
one inbox, and a second field would have been filled with the same value.

**3. Publication is gated on review.** Every pre-existing `supportEmail` was
entered under copy that described an internal routing address, so some hold an
alias or a personal address. `publicProfileReviewedAt` is stamped the first time
a manager saves the Public profile section, and the address reaches diners only
after that. Publishing to an anonymous page is irreversible for anything
scraped; the other public-profile fields need no gate because they can only have
been entered under the new copy.

**4. Contact values are normalized on write and stored canonical.** These
strings are interpolated into `href`s on a page anonymous diners load, so three
separate renderers treat stored values as trusted. Social URLs are validated
against each platform's own domain, stripped of every query parameter except
`facebook.com/profile.php?id=`, and rewritten to a canonical host
(`twitter.com` → `x.com`). Shortlinks are rejected rather than resolved.
Phone numbers are stored as E.164 and the country code is never inferred.

**5. Branding will be resolved server-side by slug** in a `loader` on the
`/r/$slug` layout and injected as a `<style>` through `head().styles` — this
app's first SSR Convex prefetch. The loader is fault-tolerant: a Convex failure
or timeout degrades to unbranded, never to an error page for a diner mid-order.

**6. The style block is scoped at `:root`**, with `:root:not(.dark)` and
`:root.dark` variants. Tailwind v4's `@theme` aliases are `var()` indirections
resolved on `:root`, so a wrapper-element override retints only part of the UI.

**7. A restaurant stores one brand colour.** The hover shade, the readable ink
drawn on it, and the per-mode legibility adjustment are all derived by a single
pure module, imported by the frontend, the Stripe appearance builder, and the
receipt renderer.

**8. Branding images are uploaded as bytes to a Convex action**, which
validates magic bytes and dimensions and calls `ctx.storage.store()` itself. No
client-supplied `storageId` is ever accepted by a branding endpoint.

## Consequences

### Positive

- A diner can reach the restaurant from the menu page and from their receipt.
  The not-a-CFDI footer stops being a dead end.
- One contact email, one place to edit it, one meaning.
- Stored contact values are canonical, so the three render surfaces contain no
  URL or phone logic at all.
- No existing restaurant's address is published without a human seeing the new
  wording first.

### Negative

- Moving the email out of General is a silent relocation: a manager who knows
  where it lived will not find it there. Section adjacency and a stable input
  id are the only mitigations.
- Normalization discards silently. An unusual profile path loses a parameter we
  strip, and the manager finds out when a diner does.
- `supportEmail` becomes scrapeable once reviewed.
- Branding (when built) gives customer HTML a hard runtime dependency on Convex
  reachability, and puts a Convex round-trip on the TTFB critical path.

### Neutral

- The audit payload records the raw typed phone, and `allEvents` is
  purge-exempt, so it outlives a hard delete. That is also the only forensic
  trail for a normalization that discarded something.
- Social links are excluded from the receipt email: it is a transactional
  document, and five more blocked images would hurt deliverability.

## Alternatives Considered

### Option 1: A separate public `contactEmail`, leaving `supportEmail` internal

**Pros:** Precise control; a restaurant could route errors to IT and diners to
the front desk.

**Cons:** Two email fields to explain in settings; most restaurants would fill
both with the same address; every consumer would need to decide which to read.

**Why not chosen:** The split solves a problem few restaurants have, at a cost
every restaurant pays. The review gate handles the real risk — publishing an
address entered under different expectations — without a second field.

### Option 2: Apply branding client-side after hydration

**Pros:** No new infrastructure; nothing in the app prefetches Convex today.

**Cons:** The diner sees platform blue until the Convex WebSocket resolves,
then watches it repaint.

**Why not chosen:** That repaint lands on the first frame of the one screen
meant to feel like the restaurant's.

### Option 3: Scope the branding CSS variables on the `/r/` wrapper `<div>`

**Pros:** Obviously scoped; no risk of leaking into staff UI.

**Cons:** Verified broken. `@theme` compiles to
`:root { --color-primary: var(--btn-primary-bg) }`, and custom properties
substitute at computed-value time on the element carrying the declaration. A
wrapper override retints `hover-btn-primary` and inline `var()` styles but
leaves every `bg-primary` utility on the platform blue.

**Why not chosen:** It produces a partly-branded UI with no error anywhere —
the highest-risk trap in the feature.

### Option 4: A full theme editor (background, text, border, or preset palettes)

**Pros:** More expressive; a restaurant could build a dark, moody menu.

**Cons:** Multiplies the contrast combinations a restaurant can break, and none
of it is recoverable by a derivation.

**Why not chosen:** One colour plus derived tokens keeps every combination
legible by construction. Presets, at the other extreme, cannot match a real
brand colour, which is the entire ask.

### Option 5: Arbitrary Google Fonts

**Pros:** Maximum choice.

**Cons:** A manager-controlled family name or URL would flow into an SSR'd
`<style>` and a preload on an anonymous page — an out-of-bound fetch from every
diner's phone, plus a privacy exposure and an unbounded quality floor.

**Why not chosen:** A closed union of self-hosted woff2 makes the legal set
enforceable at Convex's argument-validation layer.

### Option 6: `generateUploadUrl` + a client-supplied `storageId` (the `menuItems` template)

**Pros:** Consistent with every other upload in the codebase.

**Cons:** Storage ids are readable from the public URLs of every menu photo, so
accepting one gives any manager a cross-tenant blob-delete primitive. Rejecting
an id without deleting it leaks orphaned blobs with no reaper.

**Why not chosen:** Bytes-through-the-action has neither failure mode — nothing
exists until the server creates it. (The existing `menuItems` path has this
vulnerability today; it is tracked separately.)

## Implementation

Public profile, as built:

- `convex/publicProfileHelpers.ts` — pure normalization and validation, with
  `convex/publicProfileHelpers.test.ts` covering the paste shapes owners
  actually produce.
- `convex/schema.ts` — `address`, `phone`, `phoneHasWhatsApp`, five `*Url`
  columns, and `publicProfileReviewedAt` on `restaurants`.
- `convex/restaurants.ts` — validation in `update`, and `toPublicContact`
  feeding a new `contact` block on `PublicRestaurant`.
- `src/features/restaurants/components/settings/PublicProfileSection.tsx` —
  the settings section, which stamps the review on save.
- `src/features/ordering/components/RestaurantContactBar.tsx` — the diner
  surface: a two-row bar pinned below the order bar (social links at the end of
  a long scroll were unreachable in practice), returning `null` when the
  restaurant has published nothing so an unconfigured menu loses no space.
- `src/routes/r/$slug.tsx` — the restaurant's name in the sticky customer
  header, on its own line: inline it truncates to nothing at 375px.
- `convex/emails/` — the receipt contact block, plus explicit `html-to-text`
  selectors so `tel:` and `wa.me` hrefs do not print raw in the plain-text part.

## References

- [`CONTEXT.md`](../../CONTEXT.md) — Public profile, Contact email, Social link
- [ADR-005](./005-menu-item-prep-station.md) — station colours the brand colour must not override
- [ADR-008](./008-customer-borne-commission-and-pay-at-submit.md) — the receipt this footer belongs to

---

## Change Log

| Date       | Author        | Description                                 |
| ---------- | ------------- | ------------------------------------------- |
| 2026-08-13 | Gerardo Galan | Initial version; public profile implemented |
