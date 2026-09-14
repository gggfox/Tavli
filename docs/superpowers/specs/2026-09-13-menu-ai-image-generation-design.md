# Menu AI image generation — design

**Status:** approved in conversation 2026-09-13, pending implementation plan.
**Scope:** workstream B of the diner-menu redesign (A shipped in `8f7cf13`; C follows).
**Follow-up:** an ADR ("generated dish imagery") under `documentation/ADR/` once shipped.

## Why

62 of vernaculo's 64 menu items have no photo. The diner menu now renders the
mixed-menu layout (variant F): dishes with a photo become image cards, the rest
compact rows. Generated images are the fastest way to turn rows into cards.
The client chose OpenRouter image generation for this, knowing that a
generated image is a plausible plate rather than the restaurant's actual one.
Two consequences are designed in rather than bolted on: **a manager approves
every image before a diner sees it**, and **diners are told the image is
generated**.

## Decisions taken (do not relitigate)

- **Per-item, in place.** A "Generar con IA" button in the item's image panel
  of the menu editor. No batch job, no review queue, no "generate all missing".
- **Manager approval gate.** Nothing generated reaches the diner menu until a
  manager clicks _Usar esta imagen_.
- **Disclosure.** Diner cards and the item detail sheet say the image is
  generated. Staff see an _IA_ badge on the item's thumbnail.
- **Photoreal, one house style per menu.** A fixed plating/lighting brief in
  every prompt so images on one menu look like one shoot.
- **Record regeneration behaviour now, no manager-facing stats surface yet.**
  Attempts, rejections and which attempt was approved are stored; Tavli reads
  them platform-side until the data says what a manager surface should show.
- **Table names carry "AI" so nobody mistakes them for uploads:**
  `menuAIImageGenJobs`, `menuItemAIImageGenDrafts`.
- **Spend cap is per organization, per calendar month, admin-adjustable,
  default 100 generated images.** Not per restaurant, not per day. Platform
  admins set it per organization; managers see how many are left.

## Glossary additions (CONTEXT.md)

- **AI image generation job** — one attempt to generate one image for one
  MenuItem. Attempts for the same item are numbered from 1.
- **AI image draft** — the candidate image an attempt produced. Pending until
  a manager approves, rejects, or regenerates (which supersedes it).
- **Image source** — whether a MenuItem's current image was uploaded by staff
  or approved from an AI draft.

## Data model

### `menuAIImageGenJobs` (one row per attempt)

| field                                    | type                                          | notes                                                                                             |
| ---------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `restaurantId`                           | `id(restaurants)`                             | purge scope                                                                                       |
| `organizationId`                         | `id(organizations)`                           | denormalised from the restaurant at start; the monthly cap counts by it                           |
| `menuItemId`                             | `id(menuItems)`                               |                                                                                                   |
| `attempt`                                | `number`                                      | 1-based per item; `max(existing)+1` at start                                                      |
| `status`                                 | `"queued" \| "running" \| "done" \| "failed"` |                                                                                                   |
| `requestedBy`                            | `string`                                      | Clerk user id                                                                                     |
| `model`                                  | `string`                                      | OpenRouter slug actually used                                                                     |
| `costUsd`                                | `number?`                                     | from `usage.cost`; absent until done                                                              |
| `error`                                  | `string?`                                     | stable code: `credits_exhausted`, `rate_limited`, `provider_error`, `invalid_response`, `timeout` |
| `retries`                                | `number`                                      | 429/5xx retries consumed                                                                          |
| `createdAt`, `startedAt?`, `finishedAt?` | `number`                                      | ms epoch                                                                                          |

Indexes: `by_menuItem`, `by_restaurant`, `by_menuItem_status`,
`by_organization_createdAt` (`["organizationId", "createdAt"]`, for the monthly count).

### `menuItemAIImageGenDrafts` (one row per produced image)

| field                                            | type                                                    | notes                                               |
| ------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------- |
| `restaurantId`, `menuItemId`, `jobId`, `attempt` |                                                         | mirror the job                                      |
| `storageId`                                      | `id("_storage")`                                        | the blob                                            |
| `width`, `height`                                | `number?`                                               | parsed from the JPEG header when possible           |
| `prompt`                                         | `string`                                                | exact prompt sent; kept for audit and prompt tuning |
| `status`                                         | `"pending" \| "approved" \| "rejected" \| "superseded"` |                                                     |
| `reviewedBy?`, `reviewedAt?`                     |                                                         | set on approve/reject/supersede                     |
| `createdAt`                                      | `number`                                                |                                                     |

Indexes: `by_menuItem`, `by_restaurant`, `by_menuItem_status`.

Rows are never deleted by review; blobs are. **Blob ownership:** a pending
draft owns its blob. _Approve_ transfers the blob to the item
(`menuItems.imageStorageId`); the draft keeps `storageId` for audit and must
never delete it again. _Reject_ and _supersede_ delete the blob.

### `menuItems.imageSource?: "uploaded" | "generated"`

- Set to `"generated"` by approve.
- Set to `"uploaded"` by every existing path that writes `imageStorageId`
  from an upload (`create`, `update`).
- Cleared by `removeImage`.
- Treat absent as `"uploaded"` at read time (pre-existing rows).

### `organizations.aiImageMonthlyLimit?: number`

Absent means the default (100). Set only by platform admins
(`USER_ROLES.ADMIN`) through `organizations.setAiImageMonthlyLimit`; `0`
switches generation off for the organization. Shown and edited in
Admin → Organizaciones.

### Constants (`convex/constants.ts`)

`TABLE.MENU_AI_IMAGE_GEN_JOBS`, `TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS`,
`MENU_ITEM_IMAGE_SOURCE = { UPLOADED, GENERATED }`,
`MENU_AI_IMAGE_DEFAULT_MODEL = "google/gemini-2.5-flash-image"`,
`MENU_AI_IMAGE_DEFAULT_MONTHLY_LIMIT_PER_ORG = 100`,
`MENU_AI_IMAGE_STALE_JOB_MS = 10 * 60 * 1000`,
`MENU_AI_IMAGE_REQUEST_TIMEOUT_MS = 60_000`,
`MENU_AI_IMAGE_MAX_RETRIES = 3`.

Stable error codes (`convex/_shared/errors.ts` → frontend i18n):
`ERROR_AI_IMAGE_GENERATION_IN_PROGRESS`, `ERROR_AI_IMAGE_MONTHLY_LIMIT_REACHED`,
`ERROR_AI_IMAGE_CREDITS_EXHAUSTED`,
`ERROR_AI_IMAGE_GENERATION_FAILED`.

## Backend

### Modules

- `convex/menuAIImageGen.ts` — public API and internal steps.
- `convex/menuAIImageGenHelpers.ts` — pure, tested: prompt builder, response
  decoder, JPEG dimension reader, error classification, retry policy.
- `convex/restaurantPurge.ts` — claims both tables.

### Public API

**`startGeneration({ menuItemId })` — mutation**

1. `requireRestaurantManagerOrAbove` on the item's restaurant.
2. Refuse if a job for the item is `queued`/`running` and younger than
   `MENU_AI_IMAGE_STALE_JOB_MS` (`ERROR_AI_IMAGE_GENERATION_IN_PROGRESS`).
   An older running job is marked `failed: timeout` and generation proceeds.
3. Supersede any `pending` draft for the item (blob deleted) — a new attempt
   replaces the offer on the table.
4. Spend: count the organization's jobs this calendar month (UTC) via
   `by_organization_createdAt` (`countsTowardMonthlyCap`): `done` always
   counts; `queued`/`running` counts only while fresh (a stale one, past
   `MENU_AI_IMAGE_STALE_JOB_MS`, does not — it is dead and must not hold a
   cap unit forever); `failed` counts only when the error is
   `invalid_response` or `timeout`, because the provider may have generated
   — and billed for — an image in those cases; every other failure reason
   (credits exhausted, rate limited, provider error, item missing) never
   billed and does not count. Refuse with
   `ERROR_AI_IMAGE_MONTHLY_LIMIT_REACHED` when the count is at or above
   `organizations.aiImageMonthlyLimit ?? 100`. Counting the table rather than
   a counter keeps the number auditable and unable to drift from what was
   generated; the read is bounded by the cap itself.
5. Insert the job (`attempt = max(existing attempts)+1`, `status: queued`,
   `organizationId` from the restaurant),
   `ctx.scheduler.runAfter(0, internal.menuAIImageGen.generate, { jobId })`.
6. Returns `{ jobId, attempt, remainingThisMonth }`.

**`getItemGeneration({ menuItemId })` — query, live.** Returns the newest job
(if `queued`/`running` and fresh, `failed` within the last hour, or
`queued`/`running` but stale — reported as `failed: timeout` without writing
to the DB, since a query cannot, so the button is always reachable instead of
an unresolvable spinner) and the `pending` draft with a resolved `imageUrl`,
plus `attemptCount` and `remainingThisMonth` (the organization's limit minus
this month's counted jobs). Manager-or-above
only.

**`approveDraft({ draftId })` — mutation.** Manager-or-above. Draft must be
`pending`. Deletes the item's previous blob if any; if that blob came from an
approved draft, marks that draft `superseded` (without deleting the blob
twice). Patches the item: `imageStorageId = draft.storageId`,
`imageSource = "generated"`, `stampUpdated`. Draft → `approved`. Audit event
`menuItems.aiImageApproved` `{ attempt, jobId }`.

**`rejectDraft({ draftId })` — mutation.** Manager-or-above, pending only.
Deletes the blob, draft → `rejected`, audit `menuItems.aiImageRejected`.

_Regenerate_ is `startGeneration` again; step 3 supersedes the pending draft.

### Internal steps

**`generate({ jobId })` — internalAction.**

1. `internalLoadJob` → job, item, category, restaurant; abort if job is no
   longer `queued`/`running`.
2. Mark `running` (`startedAt`).
3. `buildDishImagePrompt({ name, description, categoryName, restaurantName })`.
4. `POST https://openrouter.ai/api/v1/images` with `fetch` (the AI SDK chat
   client in `menuImport.ts` cannot reach this endpoint):
   ```json
   {
   	"model": "<MENU_AI_IMAGE_MODEL ?? default>",
   	"prompt": "...",
   	"aspect_ratio": "4:3",
   	"output_format": "jpeg",
   	"output_compression": 85,
   	"n": 1
   }
   ```
   Headers: `Authorization: Bearer $OPENROUTER_API_KEY`,
   `Content-Type: application/json`. `AbortController` at 60 s.
5. Decode `data[0].b64_json` + `data[0].media_type` + `usage.cost`
   (`decodeImageResponse`, rejects anything that is not one image of a
   raster type). `readJpegDimensions` best-effort.
6. `ctx.storage.store(new Blob([bytes], { type }))` — bytes travel through
   the action; the client never supplies a storage id (ADR 009).
7. `internalRecordDraft` (mutation): insert draft `pending`, job → `done`
   with `costUsd`, `finishedAt`.
8. Failure handling (`classifyOpenRouterError`):
   - `402` → job `failed: credits_exhausted`. No retry.
   - `429` or `5xx`/network → if `retries < 3`, increment and
     `runAfter(2^retries * 2000 ms, generate)`; else `failed: rate_limited` /
     `provider_error`.
   - Timeout → `failed: timeout` after the same retry budget.
   - Unparseable body → `failed: invalid_response`.
     A failed job never leaves a blob behind (store happens after decode).

### Prompt (`buildDishImagePrompt`)

Inputs are the item's base-language `name` and `description` (the menu's
default language), the category name, the restaurant name. Each is trimmed,
whitespace-collapsed, and capped (name 80, description 300, others 60). No
other user text is ever included.

```
Professional restaurant food photograph of {name}{: {description}}.
A {category} dish served at {restaurant}.
Plated on a simple ceramic plate, shot from a 45-degree angle, soft natural
light, shallow depth of field, neutral wooden table, appetizing and realistic.
No text, no logos, no people, no hands, no watermark.
```

The brief is a constant so every image on a menu shares a style; it is the
one thing to tune if results look wrong, and the exact prompt is stored on
each draft so tuning can be compared against history.

### Spend and safety

- One cap: per organization per calendar month, default 100, admin-adjustable
  per organization, enforced at `startGeneration`; metered from `usage.cost`.
  At ~$0.04/image (OpenRouter docs example) the default is ≤ $4 per
  organization per month. No per-restaurant or per-day cap in v1. Failed
  attempts with `invalid_response`/`timeout` count toward the cap because the
  provider may have generated (and billed for) an image despite Tavli being
  unable to use it; every other failure reason does not count because it
  never billed. A stale active (`queued`/`running`) job never counts.
- One in-flight job per item; stale-job recovery at 10 min. A stale job is
  also reported as `failed: timeout` by `getItemGeneration` before the next
  `startGeneration` call actually flips it, so the panel's button is always
  reachable instead of showing a spinner that can never resolve.
- The action is the only caller of OpenRouter; the key never reaches a client.
- Purge: `restaurantPurge` deletes both tables' rows and the blobs of
  `pending` drafts only (approved blobs belong to the item and go with it;
  rejected/superseded blobs are already gone). `restaurantPurgeCoverage.test`
  enforces the table claim.

## Frontend

### Menu editor (`src/features/menus`)

- `ItemImageManager` gains **Generar con IA** beside _Subir imagen_ and the
  paste hint. It renders a new `AIImageGenerationPanel` that subscribes to
  `getItemGeneration` and shows one of: idle button · _Generando… (intento N)_
  with spinner · pending draft preview with **Usar esta imagen / Generar otra /
  Descartar** · failure line with the mapped error (limits, credits, generic)
  and a retry. "Quedan N este mes" is shown once `remainingThisMonth` is
  under 20, and the button is disabled at 0 with the limit message.
- `MenuItemImagePreview` / `MenuItemRow`: an **IA** badge on the thumbnail when
  `item.imageSource === "generated"`, tooltip "Imagen generada con IA".
- `getByMenu`/editor item queries already spread the doc, so `imageSource`
  needs no resolver change.

### Admin → Organizaciones

A numeric field **"Límite mensual de imágenes IA"** per organization (default
100, `0` = off), platform admins only, saved through
`organizations.setAiImageMonthlyLimit`.

### Diner menu (`src/features/ordering`)

- `MenuItemCard`: when `imageSource === "generated"`, a small corner hint
  (`ordering.menu.generatedImage`: "Imagen generada" / "AI image").
- `ItemDetailSheet`: one line under the photo
  (`ordering.menu.generatedImageDetail`: "Esta imagen fue generada con IA y
  puede diferir del platillo real." / "This image was AI-generated and may
  differ from the actual dish.").
- Rows (no image) are untouched.

### i18n

`menus.aiImage.*` (button, generating, attempt, use, regenerate, discard,
badge, errors) and `ordering.menu.generatedImage*`, in `en.json` and
`es.json`. Backend error codes map through `ERROR_CODE_KEYS`.

## What is recorded (analytics, no surface in v1)

Per item: number of attempts (jobs), outcome of each (done/failed and the
failure code), cost per attempt, which attempt's draft was approved, how many
were rejected. Per restaurant: sums of the above. "Satisfied with the first"
is `approved draft with attempt === 1`. Read platform-side with a one-off
query until a manager-facing surface is designed.

## Testing

- Pure (`menuAIImageGenHelpers.test.ts`): prompt builder (caps, whitespace,
  no extra text), response decoder (happy path, missing image, wrong media
  type, `n>1`), JPEG dimension reader, error classification and retry
  decisions.
- `convex-test` (`convex/_tests/menuAIImageGen.test.ts`): start (auth,
  in-progress refusal, stale recovery, supersede on regenerate, attempt
  numbering, monthly org cap at the default and at an admin-set value, stale
  active jobs not counting, only `invalid_response`/`timeout` failures
  counting, `0` switching generation off), `getItemGeneration` reporting a
  stale active job as failed, record draft (including the guard when the job
  is no longer runnable), approve (image patched, `imageSource`, old blob
  deleted, previous approved draft superseded, audit), reject (blob deleted),
  `menuItems.remove` (AI jobs/drafts and the pending draft's blob deleted),
  purge (rows gone, pending blobs gone, approved blobs untouched),
  `setAiImageMonthlyLimit` (admin only). `fetch` is stubbed; the suite never
  calls OpenRouter.
- Components: `AIImageGenerationPanel` states; `MenuItemImagePreview` badge;
  `MenuItemCard` hint; `ItemDetailSheet` line.
- Real run before merge: one item, two attempts, in dev against OpenRouter
  (~$0.08), screenshots of the panel and the diner card.

## Out of scope (v1)

Batch generation, a review queue, manager-facing regeneration stats, style
presets, reference-image editing, a spend dashboard, per-language prompts.

## Risks

- Generated ≠ real plate → approval gate + disclosure.
- Cost → caps at start, metered per attempt, key never client-side.
- Dish text in prompts → capped and plain; image models have no tool surface.
- Storage growth → reject/supersede delete blobs; purge covers pending.
- Model deprecation → `MENU_AI_IMAGE_MODEL` env override; the slug used is
  stored on every job.
