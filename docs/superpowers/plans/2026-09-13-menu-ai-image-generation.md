# Menu AI Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manager clicks "Generar con IA" on a menu item, a photoreal dish image is generated through OpenRouter, the manager approves it, and diners see it on the menu with an "AI image" hint — with a per-organization monthly cap admins can adjust.

**Architecture:** One Convex mutation starts a per-item job and schedules one internal action that calls OpenRouter's Image API with plain `fetch`, stores the bytes itself (ADR 009: the client never supplies a storage id), and records a _pending draft_. Approve/reject mutations move a draft onto the item or delete its blob. Every attempt is a job row and every produced image a draft row, kept for analytics. The editor's image panel subscribes to a live query and renders the flow in place; the diner card and detail sheet read `menuItems.imageSource`.

**Tech Stack:** Convex (queries/mutations/internalAction, scheduler, storage), OpenRouter Image API (`POST https://openrouter.ai/api/v1/images`), TanStack Start + React 19, `@convex-dev/react-query`, i18next, Vitest + Testing Library (jsdom), `convex-test`.

**Spec:** `docs/superpowers/specs/2026-09-13-menu-ai-image-generation-design.md`

## Global Constraints

- Package manager is **pnpm**. Run tests with `pnpm test <pattern>` (no `--`). Lint: `pnpm lint`. Format: prettier (tabs) — run `./node_modules/.bin/prettier --write <files>` before every commit; husky runs it too.
- **`convex/` files import only from `convex/`** (ESLint `boundaries`). Never import `src/` from `convex/`.
- Backend errors are **stable codes on `error.name`**, never prose the UI parses. New codes go in `ERROR_NAMES` (`convex/_shared/errors.ts`), then `BACKEND_ERROR_CODES` (`src/global/i18n/keys/errors.ts`), then `errors.<CODE>` in **both** `en.json` and `es.json` (the locale-parity test fails otherwise).
- Every user-facing string goes through i18n keys, in both locales. Exception followed deliberately: `OrganizationFormDialog` uses plain English labels today; the new field matches that file's existing convention.
- Use `TABLE.*` and the new `MENU_*` constants from `convex/constants.ts`; never inline table names or status strings.
- Table names are exactly `menuAIImageGenJobs` and `menuItemAIImageGenDrafts`; the item field is `imageSource` with values `"uploaded" | "generated"`.
- Default model `google/gemini-2.5-flash-image`, overridable by env `MENU_AI_IMAGE_MODEL`. Key is env `OPENROUTER_API_KEY` (already set on the dev deployment). Request: `aspect_ratio "4:3"`, `output_format "jpeg"`, `output_compression 85`, `n 1`, 60 s timeout.
- Monthly cap: per organization, calendar month in **UTC**, default **100**, `organizations.aiImageMonthlyLimit` overrides, `0` disables. Failed attempts do not count.
- Naming note vs spec: the spec writes error codes as `ERROR_AI_IMAGE_*`. `ERROR_NAMES` in `errors.ts` has no `ERROR_` prefix, so the codes are `AI_IMAGE_GENERATION_IN_PROGRESS`, `AI_IMAGE_MONTHLY_LIMIT_REACHED`, `AI_IMAGE_CREDITS_EXHAUSTED`, `AI_IMAGE_GENERATION_FAILED`. Same meaning.
- Spec deviation, deliberate: the admin limit is set through the existing admin-gated `organizations.updateOrganization` (new optional arg `aiImageMonthlyLimit`) rather than a separate `setAiImageMonthlyLimit` mutation — the dialog already calls it.
- The action runs in Convex's **default runtime** (no `"use node"`): it needs only `fetch`, `atob`, `Uint8Array`, `Blob`. Keep it in its own file so the OpenRouter boundary is one place.
- TDD: every step below writes the failing test first and runs it before implementing. The suite must never call OpenRouter: tests stub `globalThis.fetch`.
- Commit after every task with the message given. End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `git stash` is off-limits in this repo (shared stack). Never use it.

---

## File structure

**Create**

- `convex/menuAIImageGenHelpers.ts` — pure: prompt builder, response decoder, JPEG dimensions, failure classification, retry delay, UTC month start.
- `convex/menuAIImageGenHelpers.test.ts` — unit tests for the above.
- `convex/menuAIImageGen.ts` — public `startGeneration`, `getItemGeneration`, `approveDraft`, `rejectDraft`; internal `loadJobContext`, `markJobRunning`, `bumpRetry`, `markJobFailed`, `recordDraft`; monthly-count helpers.
- `convex/menuAIImageGenActions.ts` — internal action `generate` (the only OpenRouter caller).
- `convex/_tests/menuAIImageGen.test.ts` — `convex-test` coverage for jobs, drafts, cap, approve/reject, purge.
- `src/features/menus/components/AIImageGenerationPanel.tsx` + `.test.tsx` — the in-place flow in the item image panel.

**Modify**

- `convex/constants.ts` — tables, statuses, image source, model/limits, failure codes, purge list.
- `convex/schema.ts` — two tables, `menuItems.imageSource`, `organizations.aiImageMonthlyLimit`.
- `convex/_shared/errors.ts` — four error names + `MenuAIImageError`.
- `convex/restaurantPurge.ts` — delete both tables and pending-draft blobs.
- `convex/menuItems.ts` — `create`/`update` set `imageSource: "uploaded"`; `removeImage` clears it.
- `convex/organizations.ts` — `updateOrganization` accepts `aiImageMonthlyLimit`.
- `src/global/i18n/keys/errors.ts`, `keys/menus.ts`, `keys/ordering.ts`, `locales/en.json`, `locales/es.json`.
- `src/features/menus/components/ItemImageManager.tsx` — mounts the panel.
- `src/features/menus/components/MenuItemImagePreview.tsx`, `MenuItemRow.tsx` — the staff _IA_ badge.
- `src/features/ordering/components/MenuBrowser.tsx` (`MenuItemCard`), `ItemDetailSheet.tsx` — diner disclosure.
- `src/features/organizations/components/OrganizationsTable/OrganizationFormDialog.tsx` — the limit field.
- `CONTEXT.md` — glossary terms.

---

### Task 1: Schema, constants, error names, purge

**Files:**

- Modify: `convex/constants.ts` (TABLE map near line 12 and `RESTAURANT_PURGE_DELETED_TABLES` near line 1176)
- Modify: `convex/schema.ts` (`[TABLE.MENU_ITEMS]` at ~line 437, `[TABLE.ORGANIZATIONS]`, and append the two tables)
- Modify: `convex/_shared/errors.ts`
- Modify: `convex/restaurantPurge.ts` (`deleted` map ~line 55 and the menu-tree block ~line 196)
- Modify: `CONTEXT.md`
- Test: `convex/_tests/menuAIImageGen.test.ts` (created here, extended in later tasks)

**Interfaces:**

- Produces constants: `TABLE.MENU_AI_IMAGE_GEN_JOBS = "menuAIImageGenJobs"`, `TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS = "menuItemAIImageGenDrafts"`, `MENU_ITEM_IMAGE_SOURCE`, `MENU_AI_IMAGE_JOB_STATUS`, `MENU_AI_IMAGE_DRAFT_STATUS`, `MENU_AI_IMAGE_FAILURE`, `MENU_AI_IMAGE_DEFAULT_MODEL`, `MENU_AI_IMAGE_DEFAULT_MONTHLY_LIMIT_PER_ORG`, `MENU_AI_IMAGE_STALE_JOB_MS`, `MENU_AI_IMAGE_REQUEST_TIMEOUT_MS`, `MENU_AI_IMAGE_MAX_RETRIES`.
- Produces errors: `ERROR_NAMES.AI_IMAGE_GENERATION_IN_PROGRESS | AI_IMAGE_MONTHLY_LIMIT_REACHED | AI_IMAGE_CREDITS_EXHAUSTED | AI_IMAGE_GENERATION_FAILED`, class `MenuAIImageError(name, message?)` with `.toObject()`.
- Produces schema: tables and fields exactly as below; later tasks insert rows with these shapes.

- [ ] **Step 1: Write the failing purge test**

Create `convex/_tests/menuAIImageGen.test.ts`:

```ts
/**
 * AI menu image generation (workstream B).
 *
 * `fetch` is stubbed in every test that reaches the action: this suite must
 * never call OpenRouter.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { hardDeleteRestaurantDataTyped } from "../restaurantPurge";
import schema from "../schema";
import { MENU_AI_IMAGE_DRAFT_STATUS, MENU_AI_IMAGE_JOB_STATUS, TABLE } from "../constants";

const modules = import.meta.glob("../**/*.ts");
type T = ReturnType<typeof convexTest>;

const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);
const MANAGER = "user_manager";
const ADMIN = "user_admin";
const OUTSIDER = "user_outsider";

/** A 1x1 JPEG (SOF0 at 0xFFC0 with 1x1 dimensions), enough for the decoder and dimension reader. */
export const TINY_JPEG = new Uint8Array([
	0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff,
	0xd9,
]);

export async function seed(t: T, opts: { monthlyLimit?: number } = {}) {
	return t.run(async (ctx) => {
		const organizationId = await ctx.db.insert(TABLE.ORGANIZATIONS, {
			name: "Org",
			slug: "org",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
			...(opts.monthlyLimit !== undefined && { aiImageMonthlyLimit: opts.monthlyLimit }),
		});
		const restaurantId = await ctx.db.insert(TABLE.RESTAURANTS, {
			ownerId: "owner-1",
			organizationId,
			name: "Vernaculo",
			slug: "vernaculo",
			currency: "MXN",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		await ctx.db.insert(TABLE.RESTAURANT_MEMBERS, {
			userId: MANAGER,
			restaurantId,
			organizationId,
			role: "manager",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		await ctx.db.insert(TABLE.USER_ROLES, {
			userId: ADMIN,
			role: "admin",
			createdAt: NOW,
			updatedAt: NOW,
		});
		const menuId = await ctx.db.insert(TABLE.MENUS, {
			restaurantId,
			name: "Main",
			translations: {},
			isActive: true,
			displayOrder: 0,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const categoryId = await ctx.db.insert(TABLE.MENU_CATEGORIES, {
			menuId,
			restaurantId,
			name: "Carnes",
			translations: {},
			displayOrder: 0,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const menuItemId = await ctx.db.insert(TABLE.MENU_ITEMS, {
			categoryId,
			restaurantId,
			name: "Rib eye",
			description: "un delicioso corte de lomo de res",
			translations: {},
			basePrice: 100000,
			isAvailable: true,
			displayOrder: 0,
			createdAt: NOW,
			updatedAt: NOW,
		});
		return { organizationId, restaurantId, menuId, categoryId, menuItemId };
	});
}

export async function storedFileCount(t: T): Promise<number> {
	return t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length);
}

async function insertJobAndDraft(
	t: T,
	ids: {
		restaurantId: Id<"restaurants">;
		organizationId: Id<"organizations">;
		menuItemId: Id<"menuItems">;
	},
	draftStatus: "pending" | "approved"
) {
	return t.run(async (ctx) => {
		const storageId = await ctx.storage.store(new Blob([TINY_JPEG], { type: "image/jpeg" }));
		const jobId = await ctx.db.insert(TABLE.MENU_AI_IMAGE_GEN_JOBS, {
			restaurantId: ids.restaurantId,
			organizationId: ids.organizationId,
			menuItemId: ids.menuItemId,
			attempt: 1,
			status: MENU_AI_IMAGE_JOB_STATUS.DONE,
			requestedBy: MANAGER,
			model: "test/model",
			retries: 0,
			createdAt: NOW,
			finishedAt: NOW,
		});
		const draftId = await ctx.db.insert(TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS, {
			restaurantId: ids.restaurantId,
			menuItemId: ids.menuItemId,
			jobId,
			attempt: 1,
			storageId,
			prompt: "p",
			status: draftStatus,
			createdAt: NOW,
		});
		if (draftStatus === MENU_AI_IMAGE_DRAFT_STATUS.APPROVED) {
			await ctx.db.patch(ids.menuItemId, { imageStorageId: storageId, imageSource: "generated" });
		}
		return { jobId, draftId, storageId };
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("restaurant purge", () => {
	it("deletes jobs, drafts, and the blobs of pending drafts", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		await insertJobAndDraft(t, ids, "pending");
		await insertJobAndDraft(t, ids, "approved");
		expect(await storedFileCount(t)).toBe(2);

		await t.run(async (ctx) => {
			await hardDeleteRestaurantDataTyped(ctx, ids.restaurantId);
		});

		const rows = await t.run(async (ctx) => ({
			jobs: await ctx.db.query(TABLE.MENU_AI_IMAGE_GEN_JOBS).collect(),
			drafts: await ctx.db.query(TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS).collect(),
		}));
		expect(rows.jobs).toHaveLength(0);
		expect(rows.drafts).toHaveLength(0);
		// Pending blob deleted by the draft purge; approved blob deleted with the
		// item that owned it. Neither deleted twice.
		expect(await storedFileCount(t)).toBe(0);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test convex/_tests/menuAIImageGen`
Expected: FAIL — `TABLE.MENU_AI_IMAGE_GEN_JOBS` is undefined / schema has no such table.

- [ ] **Step 3: Add constants**

In `convex/constants.ts`, inside the `TABLE` object (alphabetically near `MENU_ITEMS`):

```ts
	MENU_AI_IMAGE_GEN_JOBS: "menuAIImageGenJobs",
	MENU_ITEM_AI_IMAGE_GEN_DRAFTS: "menuItemAIImageGenDrafts",
```

Add after the `DEFAULT_PREP_STATION` block (anywhere top-level is fine; keep them together):

```ts
// ============================================================================
// AI menu image generation (workstream B)
// ============================================================================

/** Where a menu item's current image came from. Absent means uploaded (pre-existing rows). */
export const MENU_ITEM_IMAGE_SOURCE = {
	UPLOADED: "uploaded",
	GENERATED: "generated",
} as const;
export type MenuItemImageSource =
	(typeof MENU_ITEM_IMAGE_SOURCE)[keyof typeof MENU_ITEM_IMAGE_SOURCE];

/** One job = one generation attempt for one item. */
export const MENU_AI_IMAGE_JOB_STATUS = {
	QUEUED: "queued",
	RUNNING: "running",
	DONE: "done",
	FAILED: "failed",
} as const;

/** A draft is the image an attempt produced; only approval reaches diners. */
export const MENU_AI_IMAGE_DRAFT_STATUS = {
	PENDING: "pending",
	APPROVED: "approved",
	REJECTED: "rejected",
	SUPERSEDED: "superseded",
} as const;

/** Stable failure codes stored on a failed job's `error`. */
export const MENU_AI_IMAGE_FAILURE = {
	CREDITS_EXHAUSTED: "credits_exhausted",
	RATE_LIMITED: "rate_limited",
	PROVIDER_ERROR: "provider_error",
	INVALID_RESPONSE: "invalid_response",
	TIMEOUT: "timeout",
} as const;
export type MenuAIImageFailure = (typeof MENU_AI_IMAGE_FAILURE)[keyof typeof MENU_AI_IMAGE_FAILURE];

/** OpenRouter image model unless `MENU_AI_IMAGE_MODEL` overrides it. */
export const MENU_AI_IMAGE_DEFAULT_MODEL = "google/gemini-2.5-flash-image";
/** Generated images per organization per UTC calendar month, unless the org row overrides it. */
export const MENU_AI_IMAGE_DEFAULT_MONTHLY_LIMIT_PER_ORG = 100;
/** A `running` job older than this is treated as dead when a manager clicks again. */
export const MENU_AI_IMAGE_STALE_JOB_MS = 10 * 60 * 1000;
export const MENU_AI_IMAGE_REQUEST_TIMEOUT_MS = 60_000;
export const MENU_AI_IMAGE_MAX_RETRIES = 3;
```

In `RESTAURANT_PURGE_DELETED_TABLES`, under the `// Menu tree` comment after `TABLE.MENU_ITEM_OPTION_GROUPS`, add:

```ts
	TABLE.MENU_AI_IMAGE_GEN_JOBS,
	TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS,
```

- [ ] **Step 4: Add schema**

In `convex/schema.ts`, inside `[TABLE.MENU_ITEMS]` after `imageStorageId`:

```ts
		// Set to "generated" when a manager approves an AI draft, "uploaded" by
		// the upload paths, cleared by removeImage. Absent = uploaded (older rows).
		imageSource: v.optional(
			v.union(v.literal(MENU_ITEM_IMAGE_SOURCE.UPLOADED), v.literal(MENU_ITEM_IMAGE_SOURCE.GENERATED))
		),
```

Inside `[TABLE.ORGANIZATIONS]` after `description`:

```ts
		// Generated images allowed per UTC calendar month. Absent = the
		// platform default; 0 switches generation off for the organization.
		aiImageMonthlyLimit: v.optional(v.number()),
```

Append two tables (after `[TABLE.MENU_ITEM_POPULARITY]` is fine):

```ts
	/**
	 * One row per AI image generation attempt for one MenuItem (workstream B).
	 * Failed attempts are rows too: "how often does this restaurant regenerate"
	 * counts attempts. Never deleted by review; deleted by the restaurant purge.
	 */
	[TABLE.MENU_AI_IMAGE_GEN_JOBS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		// Denormalised from the restaurant at start: the monthly cap counts by it.
		organizationId: v.id(TABLE.ORGANIZATIONS),
		menuItemId: v.id(TABLE.MENU_ITEMS),
		/** 1-based per item. */
		attempt: v.number(),
		status: v.union(
			v.literal(MENU_AI_IMAGE_JOB_STATUS.QUEUED),
			v.literal(MENU_AI_IMAGE_JOB_STATUS.RUNNING),
			v.literal(MENU_AI_IMAGE_JOB_STATUS.DONE),
			v.literal(MENU_AI_IMAGE_JOB_STATUS.FAILED)
		),
		requestedBy: v.string(),
		model: v.string(),
		costUsd: v.optional(v.number()),
		/** One of MENU_AI_IMAGE_FAILURE when status is failed. */
		error: v.optional(v.string()),
		retries: v.number(),
		createdAt: v.number(),
		startedAt: v.optional(v.number()),
		finishedAt: v.optional(v.number()),
	})
		.index("by_menuItem", ["menuItemId"])
		.index("by_restaurant", ["restaurantId"])
		.index("by_menuItem_status", ["menuItemId", "status"])
		.index("by_organization_createdAt", ["organizationId", "createdAt"]),

	/**
	 * The image an attempt produced. A pending draft owns its blob; approve
	 * hands the blob to the item (the row keeps `storageId` for audit and must
	 * never delete it again); reject and supersede delete it.
	 */
	[TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		menuItemId: v.id(TABLE.MENU_ITEMS),
		jobId: v.id(TABLE.MENU_AI_IMAGE_GEN_JOBS),
		attempt: v.number(),
		storageId: v.id("_storage"),
		width: v.optional(v.number()),
		height: v.optional(v.number()),
		/** Exact prompt sent, for audit and prompt tuning. */
		prompt: v.string(),
		status: v.union(
			v.literal(MENU_AI_IMAGE_DRAFT_STATUS.PENDING),
			v.literal(MENU_AI_IMAGE_DRAFT_STATUS.APPROVED),
			v.literal(MENU_AI_IMAGE_DRAFT_STATUS.REJECTED),
			v.literal(MENU_AI_IMAGE_DRAFT_STATUS.SUPERSEDED)
		),
		reviewedBy: v.optional(v.string()),
		reviewedAt: v.optional(v.number()),
		createdAt: v.number(),
	})
		.index("by_menuItem", ["menuItemId"])
		.index("by_restaurant", ["restaurantId"])
		.index("by_menuItem_status", ["menuItemId", "status"]),
```

Add `MENU_ITEM_IMAGE_SOURCE`, `MENU_AI_IMAGE_JOB_STATUS`, `MENU_AI_IMAGE_DRAFT_STATUS` to the existing `import { ... } from "./constants"` at the top of `schema.ts`.

- [ ] **Step 5: Add error names and class**

In `convex/_shared/errors.ts`, add to `ERROR_NAMES`:

```ts
	AI_IMAGE_GENERATION_IN_PROGRESS: "AI_IMAGE_GENERATION_IN_PROGRESS",
	AI_IMAGE_MONTHLY_LIMIT_REACHED: "AI_IMAGE_MONTHLY_LIMIT_REACHED",
	AI_IMAGE_CREDITS_EXHAUSTED: "AI_IMAGE_CREDITS_EXHAUSTED",
	AI_IMAGE_GENERATION_FAILED: "AI_IMAGE_GENERATION_FAILED",
```

and to `DEFAULT_ERROR_MESSAGES`:

```ts
	[ERROR_NAMES.AI_IMAGE_GENERATION_IN_PROGRESS]: "An image is already being generated for this item",
	[ERROR_NAMES.AI_IMAGE_MONTHLY_LIMIT_REACHED]: "This organization has used its generated images for the month",
	[ERROR_NAMES.AI_IMAGE_CREDITS_EXHAUSTED]: "Image generation credits are exhausted",
	[ERROR_NAMES.AI_IMAGE_GENERATION_FAILED]: "Image generation failed",
```

Append after `RateLimitedError`:

```ts
export type MenuAIImageErrorName =
	| typeof ERROR_NAMES.AI_IMAGE_GENERATION_IN_PROGRESS
	| typeof ERROR_NAMES.AI_IMAGE_MONTHLY_LIMIT_REACHED
	| typeof ERROR_NAMES.AI_IMAGE_CREDITS_EXHAUSTED
	| typeof ERROR_NAMES.AI_IMAGE_GENERATION_FAILED;

export type MenuAIImageErrorObject = CustomErrorObject & { name: MenuAIImageErrorName };

/** AI menu image generation refusals (workstream B). The name is the stable code the UI maps. */
export class MenuAIImageError extends CustomError {
	readonly errorName: MenuAIImageErrorName;

	constructor(name: MenuAIImageErrorName, message?: string) {
		super({ message: message ?? DEFAULT_ERROR_MESSAGES[name], name });
		this.errorName = name;
	}

	override toObject(): MenuAIImageErrorObject {
		return { name: this.errorName, message: this.message };
	}
}
```

- [ ] **Step 6: Purge both tables**

In `convex/restaurantPurge.ts`, add to the `deleted` map:

```ts
		[TABLE.MENU_AI_IMAGE_GEN_JOBS]: 0,
		[TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS]: 0,
```

Immediately **before** the menu-tree loop (before the `for (const menu of menus)` that deletes categories/items), add:

```ts
// AI image drafts and jobs (workstream B). Drafts first: a pending draft
// owns its blob, so delete that blob here. An approved draft's blob belongs
// to the item and is deleted with the item below — deleting it here too
// would throw on the second delete.
const aiDrafts = await ctx.db
	.query(TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS)
	.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
	.collect();
for (const draft of aiDrafts) {
	if (draft.status === MENU_AI_IMAGE_DRAFT_STATUS.PENDING) {
		await ctx.storage.delete(draft.storageId);
		storageFilesDeleted++;
	}
	await ctx.db.delete(draft._id);
}
deleted[TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS] += aiDrafts.length;

const aiJobs = await ctx.db
	.query(TABLE.MENU_AI_IMAGE_GEN_JOBS)
	.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
	.collect();
for (const job of aiJobs) await ctx.db.delete(job._id);
deleted[TABLE.MENU_AI_IMAGE_GEN_JOBS] += aiJobs.length;
```

Import `MENU_AI_IMAGE_DRAFT_STATUS` from `./constants` in that file.

- [ ] **Step 7: Run the tests**

Run: `pnpm test convex/_tests/menuAIImageGen convex/restaurantPurgeCoverage convex/_tests/restaurantPurge`
Expected: PASS (the coverage test now sees both tables claimed).
Then: `./node_modules/.bin/tsc --noEmit` — clean.

- [ ] **Step 8: Glossary**

Append to the glossary in `CONTEXT.md` (match the surrounding term format):

```md
- **AI image generation job** — one attempt to generate one image for one MenuItem. Attempts for the same item are numbered from 1. Table `menuAIImageGenJobs`.
- **AI image draft** — the candidate image an attempt produced (`menuItemAIImageGenDrafts`). Pending until a manager approves, rejects, or regenerates (which supersedes it). Diners never see a draft.
- **Image source** — whether a MenuItem's current image was uploaded by staff or approved from an AI draft (`menuItems.imageSource`).
```

- [ ] **Step 9: Commit**

```bash
./node_modules/.bin/prettier --write convex/constants.ts convex/schema.ts convex/_shared/errors.ts convex/restaurantPurge.ts convex/_tests/menuAIImageGen.test.ts CONTEXT.md
git add convex/constants.ts convex/schema.ts convex/_shared/errors.ts convex/restaurantPurge.ts convex/_tests/menuAIImageGen.test.ts CONTEXT.md
git commit -m "feat(ai-images): jobs and drafts tables, imageSource, org monthly limit, purge coverage

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Pure helpers

**Files:**

- Create: `convex/menuAIImageGenHelpers.ts`
- Test: `convex/menuAIImageGenHelpers.test.ts`

**Interfaces (produces):**

```ts
export const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";
export const DISH_IMAGE_STYLE_BRIEF: string;
export function buildDishImagePrompt(input: {
	name: string;
	description?: string;
	categoryName: string;
	restaurantName: string;
}): string;
export type DecodedImage = { bytes: Uint8Array; mediaType: string; costUsd: number | null };
export type DecodeResult =
	| { ok: true; image: DecodedImage }
	| { ok: false; reason: "no_image" | "unsupported_media_type" | "malformed" };
export function decodeImageResponse(body: unknown): DecodeResult;
export function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null;
export function classifyHttpFailure(status: number): { code: MenuAIImageFailure; retry: boolean };
export function retryDelayMs(retries: number): number;
export function monthStartUtc(nowMs: number): number;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { MENU_AI_IMAGE_FAILURE } from "./constants";
import {
	buildDishImagePrompt,
	classifyHttpFailure,
	decodeImageResponse,
	DISH_IMAGE_STYLE_BRIEF,
	monthStartUtc,
	readJpegDimensions,
	retryDelayMs,
} from "./menuAIImageGenHelpers";

describe("buildDishImagePrompt", () => {
	it("names the dish, the category, the restaurant, and the fixed style brief", () => {
		const prompt = buildDishImagePrompt({
			name: "Rib eye",
			description: "un delicioso corte de lomo de res",
			categoryName: "Carnes",
			restaurantName: "Vernaculo",
		});
		expect(prompt).toBe(
			`Professional restaurant food photograph of Rib eye: un delicioso corte de lomo de res. A Carnes dish served at Vernaculo. ${DISH_IMAGE_STYLE_BRIEF}`
		);
	});

	it("omits the description clause when there is none", () => {
		const prompt = buildDishImagePrompt({
			name: "Agua",
			categoryName: "Bebidas",
			restaurantName: "V",
		});
		expect(
			prompt.startsWith("Professional restaurant food photograph of Agua. A Bebidas dish")
		).toBe(true);
	});

	// Dish text is the only user-controlled input; keep it short and flat so a
	// pasted paragraph cannot become the prompt.
	it("collapses whitespace and caps each field", () => {
		const prompt = buildDishImagePrompt({
			name: "  Tacos\n\n al  pastor  " + "x".repeat(200),
			description: "y".repeat(500),
			categoryName: "c".repeat(100),
			restaurantName: "r".repeat(100),
		});
		expect(prompt).not.toMatch(/\n|  /);
		expect(prompt).toContain("Tacos al pastor " + "x".repeat(80 - "Tacos al pastor ".length));
		expect(prompt).toContain("y".repeat(300));
		expect(prompt).not.toContain("y".repeat(301));
		expect(prompt).toContain("c".repeat(60));
		expect(prompt).not.toContain("c".repeat(61));
	});
});

describe("decodeImageResponse", () => {
	const b64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

	it("decodes one jpeg with its cost", () => {
		const result = decodeImageResponse({
			created: 1,
			data: [{ b64_json: b64, media_type: "image/jpeg" }],
			usage: { cost: 0.039 },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(Array.from(result.image.bytes)).toEqual([0xff, 0xd8, 0xff, 0xd9]);
		expect(result.image.mediaType).toBe("image/jpeg");
		expect(result.image.costUsd).toBe(0.039);
	});

	it("reports a missing image", () => {
		expect(decodeImageResponse({ data: [] })).toEqual({ ok: false, reason: "no_image" });
		expect(decodeImageResponse({})).toEqual({ ok: false, reason: "no_image" });
	});

	it("refuses a non-raster media type", () => {
		expect(decodeImageResponse({ data: [{ b64_json: b64, media_type: "image/svg+xml" }] })).toEqual(
			{ ok: false, reason: "unsupported_media_type" }
		);
	});

	it("reports malformed base64 and non-object bodies", () => {
		expect(decodeImageResponse({ data: [{ b64_json: "%%%", media_type: "image/png" }] })).toEqual({
			ok: false,
			reason: "malformed",
		});
		expect(decodeImageResponse(null)).toEqual({ ok: false, reason: "no_image" });
	});

	it("leaves cost null when usage is absent", () => {
		const result = decodeImageResponse({ data: [{ b64_json: b64, media_type: "image/webp" }] });
		expect(result.ok && result.image.costUsd).toBeNull();
	});
});

describe("readJpegDimensions", () => {
	it("reads width and height from the SOF0 marker", () => {
		// SOI, SOF0 (length 11, precision 8, height 0x0001, width 0x0002, 1 component), EOI
		const bytes = new Uint8Array([
			0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00,
			0xff, 0xd9,
		]);
		expect(readJpegDimensions(bytes)).toEqual({ width: 2, height: 1 });
	});

	it("skips non-SOF segments to find the frame header", () => {
		// SOI, APP0 (length 4, two payload bytes), SOF2 with 3x4, EOI
		const bytes = new Uint8Array([
			0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc2, 0x00, 0x0b, 0x08, 0x00, 0x04,
			0x00, 0x03, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
		]);
		expect(readJpegDimensions(bytes)).toEqual({ width: 3, height: 4 });
	});

	it("returns null for anything that is not a JPEG", () => {
		expect(readJpegDimensions(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
		expect(readJpegDimensions(new Uint8Array([]))).toBeNull();
	});
});

describe("classifyHttpFailure", () => {
	it("treats 402 as exhausted credits, never retried", () => {
		expect(classifyHttpFailure(402)).toEqual({
			code: MENU_AI_IMAGE_FAILURE.CREDITS_EXHAUSTED,
			retry: false,
		});
	});
	it("retries 429 and 5xx", () => {
		expect(classifyHttpFailure(429)).toEqual({
			code: MENU_AI_IMAGE_FAILURE.RATE_LIMITED,
			retry: true,
		});
		expect(classifyHttpFailure(502)).toEqual({
			code: MENU_AI_IMAGE_FAILURE.PROVIDER_ERROR,
			retry: true,
		});
	});
	it("does not retry other 4xx", () => {
		expect(classifyHttpFailure(400)).toEqual({
			code: MENU_AI_IMAGE_FAILURE.PROVIDER_ERROR,
			retry: false,
		});
	});
});

describe("retryDelayMs", () => {
	it("backs off exponentially from two seconds", () => {
		expect([0, 1, 2].map(retryDelayMs)).toEqual([2000, 4000, 8000]);
	});
});

describe("monthStartUtc", () => {
	it("returns the first instant of the UTC month", () => {
		expect(monthStartUtc(Date.UTC(2026, 8, 13, 23, 59))).toBe(Date.UTC(2026, 8, 1));
		expect(monthStartUtc(Date.UTC(2026, 0, 1, 0, 0, 1))).toBe(Date.UTC(2026, 0, 1));
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test menuAIImageGenHelpers`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`convex/menuAIImageGenHelpers.ts`:

```ts
/**
 * Pure pieces of AI menu image generation (workstream B): everything that can
 * be tested without Convex or the network.
 */
import { MENU_AI_IMAGE_FAILURE, type MenuAIImageFailure } from "./constants";

export const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";

/**
 * The one house style for every image on a menu. It is a constant so images
 * look like one shoot, and the exact prompt is stored on every draft so a
 * change here can be compared against history.
 */
export const DISH_IMAGE_STYLE_BRIEF =
	"Plated on a simple ceramic plate, shot from a 45-degree angle, soft natural light, " +
	"shallow depth of field, neutral wooden table, appetizing and realistic. " +
	"No text, no logos, no people, no hands, no watermark.";

const NAME_MAX = 80;
const DESCRIPTION_MAX = 300;
const OTHER_MAX = 60;

function clean(value: string | undefined, max: number): string {
	return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Dish name and description are the only user-controlled text that reaches
 * the model; they are flattened and capped so a pasted paragraph cannot take
 * the prompt over.
 */
export function buildDishImagePrompt(input: {
	name: string;
	description?: string;
	categoryName: string;
	restaurantName: string;
}): string {
	const name = clean(input.name, NAME_MAX);
	const description = clean(input.description, DESCRIPTION_MAX);
	const category = clean(input.categoryName, OTHER_MAX);
	const restaurant = clean(input.restaurantName, OTHER_MAX);
	const subject = description ? `${name}: ${description}` : name;
	return `Professional restaurant food photograph of ${subject}. A ${category} dish served at ${restaurant}. ${DISH_IMAGE_STYLE_BRIEF}`;
}

export type DecodedImage = { bytes: Uint8Array; mediaType: string; costUsd: number | null };
export type DecodeResult =
	| { ok: true; image: DecodedImage }
	| { ok: false; reason: "no_image" | "unsupported_media_type" | "malformed" };

const RASTER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Parse an OpenRouter `/images` body: exactly one raster image in `data[0]`. */
export function decodeImageResponse(body: unknown): DecodeResult {
	if (typeof body !== "object" || body === null) return { ok: false, reason: "no_image" };
	const data = (body as { data?: unknown }).data;
	const first = Array.isArray(data) ? data[0] : undefined;
	if (typeof first !== "object" || first === null) return { ok: false, reason: "no_image" };
	const { b64_json: b64, media_type: mediaType } = first as {
		b64_json?: unknown;
		media_type?: unknown;
	};
	if (typeof b64 !== "string" || b64.length === 0) return { ok: false, reason: "no_image" };
	if (typeof mediaType !== "string" || !RASTER_TYPES.has(mediaType)) {
		return { ok: false, reason: "unsupported_media_type" };
	}
	let bytes: Uint8Array;
	try {
		if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw new Error("not base64");
		const binary = atob(b64.replace(/\s/g, ""));
		bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	} catch {
		return { ok: false, reason: "malformed" };
	}
	const usage = (body as { usage?: { cost?: unknown } }).usage;
	const costUsd = typeof usage?.cost === "number" ? usage.cost : null;
	return { ok: true, image: { bytes, mediaType, costUsd } };
}

/**
 * Width and height from a JPEG's frame header (SOFn), best effort. Walks the
 * segments after SOI; returns null for anything that is not a JPEG or has no
 * frame header before the scan starts.
 */
export function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let offset = 2;
	while (offset + 3 < bytes.length) {
		if (bytes[offset] !== 0xff) return null;
		const marker = bytes[offset + 1];
		// Standalone markers carry no length.
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			offset += 2;
			continue;
		}
		if (marker === 0xd9 || marker === 0xda) return null; // EOI / start of scan without SOF
		const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
		const isSof =
			marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isSof) {
			if (offset + 8 >= bytes.length) return null;
			const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
			const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
			return width > 0 && height > 0 ? { width, height } : null;
		}
		offset += 2 + length;
	}
	return null;
}

/** 402 is a credits problem nothing here can fix; 429 and 5xx are worth a retry. */
export function classifyHttpFailure(status: number): { code: MenuAIImageFailure; retry: boolean } {
	if (status === 402) return { code: MENU_AI_IMAGE_FAILURE.CREDITS_EXHAUSTED, retry: false };
	if (status === 429) return { code: MENU_AI_IMAGE_FAILURE.RATE_LIMITED, retry: true };
	if (status >= 500) return { code: MENU_AI_IMAGE_FAILURE.PROVIDER_ERROR, retry: true };
	return { code: MENU_AI_IMAGE_FAILURE.PROVIDER_ERROR, retry: false };
}

export function retryDelayMs(retries: number): number {
	return 2000 * 2 ** retries;
}

/** First instant of the UTC calendar month containing `nowMs`. */
export function monthStartUtc(nowMs: number): number {
	const d = new Date(nowMs);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test menuAIImageGenHelpers`
Expected: PASS (15 tests). Then `./node_modules/.bin/tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
./node_modules/.bin/prettier --write convex/menuAIImageGenHelpers.ts convex/menuAIImageGenHelpers.test.ts
git add convex/menuAIImageGenHelpers.ts convex/menuAIImageGenHelpers.test.ts
git commit -m "feat(ai-images): prompt builder, response decoder, JPEG dimensions, failure policy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Internal steps and the OpenRouter action

**Files:**

- Create: `convex/menuAIImageGen.ts` (internal functions only in this task; public API added in Task 4)
- Create: `convex/menuAIImageGenActions.ts`
- Test: `convex/_tests/menuAIImageGen.test.ts` (append)

**Interfaces:**

- Consumes: Task 1 constants/schema, Task 2 helpers.
- Produces:
  - `internal.menuAIImageGen.loadJobContext({ jobId }) → { job: Doc<"menuAIImageGenJobs">; prompt: string } | null`
  - `internal.menuAIImageGen.markJobRunning({ jobId }) → null`
  - `internal.menuAIImageGen.bumpRetry({ jobId }) → null`
  - `internal.menuAIImageGen.markJobFailed({ jobId, error }) → null`
  - `internal.menuAIImageGen.recordDraft({ jobId, storageId, width?, height?, prompt, costUsd? }) → Id<"menuItemAIImageGenDrafts">`
  - `internal.menuAIImageGenActions.generate({ jobId }) → null`

- [ ] **Step 1: Write the failing tests**

Append to `convex/_tests/menuAIImageGen.test.ts`:

```ts
async function insertQueuedJob(
	t: T,
	ids: {
		restaurantId: Id<"restaurants">;
		organizationId: Id<"organizations">;
		menuItemId: Id<"menuItems">;
	},
	overrides: Partial<{ retries: number; status: "queued" | "running" }> = {}
) {
	return t.run(async (ctx) =>
		ctx.db.insert(TABLE.MENU_AI_IMAGE_GEN_JOBS, {
			restaurantId: ids.restaurantId,
			organizationId: ids.organizationId,
			menuItemId: ids.menuItemId,
			attempt: 1,
			status: overrides.status ?? MENU_AI_IMAGE_JOB_STATUS.QUEUED,
			requestedBy: MANAGER,
			model: "test/model",
			retries: overrides.retries ?? 0,
			createdAt: NOW,
		})
	);
}

function okImageResponse(cost = 0.04) {
	return new Response(
		JSON.stringify({
			created: 1,
			data: [{ b64_json: Buffer.from(TINY_JPEG).toString("base64"), media_type: "image/jpeg" }],
			usage: { cost },
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } }
	);
}

describe("generate action", () => {
	it("stores the image, records a pending draft with dimensions and cost, marks the job done", async () => {
		const fetchMock = vi.fn(async () => okImageResponse(0.04));
		vi.stubGlobal("fetch", fetchMock);
		vi.stubEnv("OPENROUTER_API_KEY", "test-key");
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const jobId = await insertQueuedJob(t, ids);

		await t.action(internal.menuAIImageGenActions.generate, { jobId });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("https://openrouter.ai/api/v1/images");
		const body = JSON.parse(String(init.body));
		expect(body).toMatchObject({
			model: "test/model",
			aspect_ratio: "4:3",
			output_format: "jpeg",
			n: 1,
		});
		expect(body.prompt).toContain("Rib eye");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");

		const { job, drafts } = await t.run(async (ctx) => ({
			job: await ctx.db.get(jobId),
			drafts: await ctx.db.query(TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS).collect(),
		}));
		expect(job?.status).toBe(MENU_AI_IMAGE_JOB_STATUS.DONE);
		expect(job?.costUsd).toBe(0.04);
		expect(drafts).toHaveLength(1);
		expect(drafts[0].status).toBe(MENU_AI_IMAGE_DRAFT_STATUS.PENDING);
		expect(drafts[0].width).toBe(1);
		expect(drafts[0].height).toBe(1);
		expect(drafts[0].prompt).toBe(body.prompt);
		expect(await storedFileCount(t)).toBe(1);
	});

	it("fails on 402 without retrying and stores nothing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("", { status: 402 }))
		);
		vi.stubEnv("OPENROUTER_API_KEY", "test-key");
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const jobId = await insertQueuedJob(t, ids);

		await t.action(internal.menuAIImageGenActions.generate, { jobId });

		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe(MENU_AI_IMAGE_JOB_STATUS.FAILED);
		expect(job?.error).toBe("credits_exhausted");
		expect(await storedFileCount(t)).toBe(0);
	});

	it("schedules a retry on 429 while retries remain, then fails when they run out", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("", { status: 429 }))
		);
		vi.stubEnv("OPENROUTER_API_KEY", "test-key");
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const jobId = await insertQueuedJob(t, ids, { retries: 2 });

		await t.action(internal.menuAIImageGenActions.generate, { jobId });
		let job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe(MENU_AI_IMAGE_JOB_STATUS.RUNNING);
		expect(job?.retries).toBe(3);

		// The scheduled retry is the same action; run it and let it exhaust.
		await t.finishInProgressScheduledFunctions();
		job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe(MENU_AI_IMAGE_JOB_STATUS.FAILED);
		expect(job?.error).toBe("rate_limited");
	});

	it("fails with invalid_response when the body has no image", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
		);
		vi.stubEnv("OPENROUTER_API_KEY", "test-key");
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const jobId = await insertQueuedJob(t, ids);

		await t.action(internal.menuAIImageGenActions.generate, { jobId });

		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.error).toBe("invalid_response");
		expect(await storedFileCount(t)).toBe(0);
	});

	it("does nothing for a job that is no longer runnable", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const jobId = await insertQueuedJob(t, ids);
		await t.run(async (ctx) => ctx.db.patch(jobId, { status: MENU_AI_IMAGE_JOB_STATUS.FAILED }));

		await t.action(internal.menuAIImageGenActions.generate, { jobId });

		expect(fetchMock).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test convex/_tests/menuAIImageGen`
Expected: FAIL — `internal.menuAIImageGenActions` undefined.

- [ ] **Step 3: Implement the internal functions**

`convex/menuAIImageGen.ts`:

```ts
/**
 * AI menu image generation (workstream B): jobs, drafts, approval.
 *
 * The bytes travel through the action in `menuAIImageGenActions.ts` and are
 * stored server-side (ADR 009): a client never hands back a storage id. A
 * manager approves every image before a diner sees it.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { MENU_AI_IMAGE_DRAFT_STATUS, MENU_AI_IMAGE_JOB_STATUS, TABLE } from "./constants";
import { buildDishImagePrompt } from "./menuAIImageGenHelpers";

// ============================================================================
// Internal: the steps the action calls
// ============================================================================

/** Everything the action needs, or null when the job must not run. */
export const loadJobContext = internalQuery({
	args: { jobId: v.id(TABLE.MENU_AI_IMAGE_GEN_JOBS) },
	handler: async (
		ctx,
		{ jobId }
	): Promise<{ job: Doc<"menuAIImageGenJobs">; prompt: string } | null> => {
		const job = await ctx.db.get(jobId);
		if (!job) return null;
		if (
			job.status !== MENU_AI_IMAGE_JOB_STATUS.QUEUED &&
			job.status !== MENU_AI_IMAGE_JOB_STATUS.RUNNING
		) {
			return null;
		}
		const item = await ctx.db.get(job.menuItemId);
		if (!item) return null;
		const category = await ctx.db.get(item.categoryId);
		const restaurant = await ctx.db.get(job.restaurantId);
		if (!category || !restaurant) return null;
		return {
			job,
			prompt: buildDishImagePrompt({
				name: item.name,
				description: item.description,
				categoryName: category.name,
				restaurantName: restaurant.name,
			}),
		};
	},
});

export const markJobRunning = internalMutation({
	args: { jobId: v.id(TABLE.MENU_AI_IMAGE_GEN_JOBS) },
	returns: v.null(),
	handler: async (ctx, { jobId }) => {
		const job = await ctx.db.get(jobId);
		if (!job || job.status !== MENU_AI_IMAGE_JOB_STATUS.QUEUED) return null;
		await ctx.db.patch(jobId, { status: MENU_AI_IMAGE_JOB_STATUS.RUNNING, startedAt: Date.now() });
		return null;
	},
});

export const bumpRetry = internalMutation({
	args: { jobId: v.id(TABLE.MENU_AI_IMAGE_GEN_JOBS) },
	returns: v.null(),
	handler: async (ctx, { jobId }) => {
		const job = await ctx.db.get(jobId);
		if (!job) return null;
		await ctx.db.patch(jobId, { retries: job.retries + 1 });
		return null;
	},
});

export const markJobFailed = internalMutation({
	args: { jobId: v.id(TABLE.MENU_AI_IMAGE_GEN_JOBS), error: v.string() },
	returns: v.null(),
	handler: async (ctx, { jobId, error }) => {
		const job = await ctx.db.get(jobId);
		if (!job) return null;
		await ctx.db.patch(jobId, {
			status: MENU_AI_IMAGE_JOB_STATUS.FAILED,
			error,
			finishedAt: Date.now(),
		});
		return null;
	},
});

/** The action stored the blob; write the draft and close the job together. */
export const recordDraft = internalMutation({
	args: {
		jobId: v.id(TABLE.MENU_AI_IMAGE_GEN_JOBS),
		storageId: v.id("_storage"),
		width: v.optional(v.number()),
		height: v.optional(v.number()),
		prompt: v.string(),
		costUsd: v.optional(v.number()),
	},
	handler: async (ctx, args): Promise<Id<"menuItemAIImageGenDrafts">> => {
		const job = await ctx.db.get(args.jobId);
		if (!job) {
			// The job vanished (restaurant purged mid-flight). Drop the blob rather
			// than leak it: nothing would ever reference it.
			await ctx.storage.delete(args.storageId);
			throw new Error("Job not found");
		}
		const now = Date.now();
		const draftId = await ctx.db.insert(TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS, {
			restaurantId: job.restaurantId,
			menuItemId: job.menuItemId,
			jobId: job._id,
			attempt: job.attempt,
			storageId: args.storageId,
			width: args.width,
			height: args.height,
			prompt: args.prompt,
			status: MENU_AI_IMAGE_DRAFT_STATUS.PENDING,
			createdAt: now,
		});
		await ctx.db.patch(job._id, {
			status: MENU_AI_IMAGE_JOB_STATUS.DONE,
			costUsd: args.costUsd,
			finishedAt: now,
		});
		return draftId;
	},
});
```

- [ ] **Step 4: Implement the action**

`convex/menuAIImageGenActions.ts`:

```ts
/**
 * The only place Tavli talks to OpenRouter's Image API (workstream B).
 *
 * Default Convex runtime on purpose: `fetch`, `atob`, `Uint8Array` and `Blob`
 * are all it needs, and keeping it off Node keeps cold starts short. One
 * action = one attempt; retries reschedule this same action.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
	MENU_AI_IMAGE_FAILURE,
	MENU_AI_IMAGE_MAX_RETRIES,
	MENU_AI_IMAGE_REQUEST_TIMEOUT_MS,
	TABLE,
	type MenuAIImageFailure,
} from "./constants";
import {
	classifyHttpFailure,
	decodeImageResponse,
	OPENROUTER_IMAGES_URL,
	readJpegDimensions,
	retryDelayMs,
} from "./menuAIImageGenHelpers";

export const generate = internalAction({
	args: { jobId: v.id(TABLE.MENU_AI_IMAGE_GEN_JOBS) },
	returns: v.null(),
	handler: async (ctx, { jobId }): Promise<null> => {
		const context = await ctx.runQuery(internal.menuAIImageGen.loadJobContext, { jobId });
		if (!context) return null;
		const { job, prompt } = context;
		await ctx.runMutation(internal.menuAIImageGen.markJobRunning, { jobId });

		const fail = (error: MenuAIImageFailure) =>
			ctx.runMutation(internal.menuAIImageGen.markJobFailed, { jobId, error });
		const retryOrFail = async (error: MenuAIImageFailure, retry: boolean) => {
			if (retry && job.retries < MENU_AI_IMAGE_MAX_RETRIES) {
				await ctx.runMutation(internal.menuAIImageGen.bumpRetry, { jobId });
				await ctx.scheduler.runAfter(
					retryDelayMs(job.retries),
					internal.menuAIImageGenActions.generate,
					{
						jobId,
					}
				);
				return;
			}
			await fail(error);
		};

		const apiKey = process.env.OPENROUTER_API_KEY;
		if (!apiKey) {
			await fail(MENU_AI_IMAGE_FAILURE.PROVIDER_ERROR);
			return null;
		}

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), MENU_AI_IMAGE_REQUEST_TIMEOUT_MS);
		let response: Response;
		try {
			response = await fetch(OPENROUTER_IMAGES_URL, {
				method: "POST",
				headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
				body: JSON.stringify({
					model: job.model,
					prompt,
					aspect_ratio: "4:3",
					output_format: "jpeg",
					output_compression: 85,
					n: 1,
				}),
				signal: controller.signal,
			});
		} catch (err) {
			clearTimeout(timer);
			const timedOut = err instanceof Error && err.name === "AbortError";
			await retryOrFail(
				timedOut ? MENU_AI_IMAGE_FAILURE.TIMEOUT : MENU_AI_IMAGE_FAILURE.PROVIDER_ERROR,
				true
			);
			return null;
		}
		clearTimeout(timer);

		if (!response.ok) {
			const { code, retry } = classifyHttpFailure(response.status);
			await retryOrFail(code, retry);
			return null;
		}

		const decoded = decodeImageResponse(await response.json().catch(() => null));
		if (!decoded.ok) {
			await fail(MENU_AI_IMAGE_FAILURE.INVALID_RESPONSE);
			return null;
		}

		// Store only after the bytes decoded: a failed attempt must never leave a
		// blob that no row references.
		const storageId = await ctx.storage.store(
			new Blob([decoded.image.bytes], { type: decoded.image.mediaType })
		);
		const dims = readJpegDimensions(decoded.image.bytes);
		await ctx.runMutation(internal.menuAIImageGen.recordDraft, {
			jobId,
			storageId,
			width: dims?.width,
			height: dims?.height,
			prompt,
			costUsd: decoded.image.costUsd ?? undefined,
		});
		return null;
	},
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test convex/_tests/menuAIImageGen`
Expected: PASS (purge test + 5 action tests). `./node_modules/.bin/tsc --noEmit` clean.
If `t.finishInProgressScheduledFunctions` is not available in the installed `convex-test`, use `await t.finishAllScheduledFunctions(vi.runAllTimers)` with `vi.useFakeTimers()` at the top of that test and `vi.useRealTimers()` after — pick whichever the installed version exports (check `node_modules/convex-test/dist/index.d.ts`).

- [ ] **Step 6: Commit**

```bash
./node_modules/.bin/prettier --write convex/menuAIImageGen.ts convex/menuAIImageGenActions.ts convex/_tests/menuAIImageGen.test.ts
git add convex/menuAIImageGen.ts convex/menuAIImageGenActions.ts convex/_tests/menuAIImageGen.test.ts
git commit -m "feat(ai-images): generation action against the OpenRouter Image API, drafts recorded server-side

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Public API — start, live view, approve, reject, monthly cap, image source

**Files:**

- Modify: `convex/menuAIImageGen.ts` (append public functions + cap helpers)
- Modify: `convex/menuItems.ts` (`create` ~line 61, `update` ~line 117, `removeImage` ~line 190)
- Modify: `convex/organizations.ts` (`updateOrganization` ~line 146)
- Test: `convex/_tests/menuAIImageGen.test.ts` (append)

**Interfaces (produces):**

```ts
api.menuAIImageGen.startGeneration({ menuItemId }) → AsyncReturn<{ jobId; attempt; remainingThisMonth }, AuthErrors | NotFoundErrorObject | MenuAIImageErrorObject>
api.menuAIImageGen.getItemGeneration({ menuItemId }) → ItemGenerationView   // throws on auth failure, like branding.getBrandingImages
api.menuAIImageGen.approveDraft({ draftId }) → AsyncReturn<null, ...>
api.menuAIImageGen.rejectDraft({ draftId }) → AsyncReturn<null, ...>
export interface ItemGenerationView {
  activeJob: { jobId; status: "queued" | "running" | "failed"; attempt; error?: string } | null;
  pendingDraft: { draftId; imageUrl: string; attempt; prompt } | null;
  attemptCount: number;
  remainingThisMonth: number;
  monthlyLimit: number;
}
api.organizations.updateOrganization({ id, aiImageMonthlyLimit?: number, ... })
```

- [ ] **Step 1: Write the failing tests**

Append:

```ts
import { MENU_ITEM_IMAGE_SOURCE, MENU_AI_IMAGE_DEFAULT_MONTHLY_LIMIT_PER_ORG } from "../constants";

function asManager(t: T) {
	return t.withIdentity({ subject: MANAGER });
}

describe("startGeneration", () => {
	it("creates attempt 1 as queued, schedules the action, and reports what is left this month", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => okImageResponse())
		);
		vi.stubEnv("OPENROUTER_API_KEY", "test-key");
		const t = convexTest(schema, modules);
		const ids = await seed(t);

		const [result, error] = await asManager(t).mutation(api.menuAIImageGen.startGeneration, {
			menuItemId: ids.menuItemId,
		});
		expect(error).toBeNull();
		expect(result?.attempt).toBe(1);
		expect(result?.remainingThisMonth).toBe(MENU_AI_IMAGE_DEFAULT_MONTHLY_LIMIT_PER_ORG - 1);

		await t.finishInProgressScheduledFunctions();
		const job = await t.run(async (ctx) => ctx.db.get(result!.jobId));
		expect(job?.status).toBe(MENU_AI_IMAGE_JOB_STATUS.DONE);
		expect(job?.organizationId).toBe(ids.organizationId);
	});

	it("refuses an outsider", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const [, error] = await t
			.withIdentity({ subject: OUTSIDER })
			.mutation(api.menuAIImageGen.startGeneration, { menuItemId: ids.menuItemId });
		expect(error).not.toBeNull();
	});

	it("refuses while an attempt is in flight, but recovers from a stale one", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const runningId = await insertQueuedJob(t, ids, { status: "running" });

		const [, error] = await asManager(t).mutation(api.menuAIImageGen.startGeneration, {
			menuItemId: ids.menuItemId,
		});
		expect(error?.name).toBe("AI_IMAGE_GENERATION_IN_PROGRESS");

		// Age the running job past the stale threshold; the next click proceeds.
		await t.run(async (ctx) =>
			ctx.db.patch(runningId, { startedAt: NOW - 11 * 60 * 1000, createdAt: NOW - 11 * 60 * 1000 })
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => okImageResponse())
		);
		vi.stubEnv("OPENROUTER_API_KEY", "test-key");
		const [result, error2] = await asManager(t).mutation(api.menuAIImageGen.startGeneration, {
			menuItemId: ids.menuItemId,
		});
		expect(error2).toBeNull();
		expect(result?.attempt).toBe(2);
		const stale = await t.run(async (ctx) => ctx.db.get(runningId));
		expect(stale?.status).toBe(MENU_AI_IMAGE_JOB_STATUS.FAILED);
		expect(stale?.error).toBe("timeout");
	});

	it("supersedes a pending draft and deletes its blob when regenerating", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => okImageResponse())
		);
		vi.stubEnv("OPENROUTER_API_KEY", "test-key");
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const { draftId } = await insertJobAndDraft(t, ids, "pending");
		expect(await storedFileCount(t)).toBe(1);

		const [result] = await asManager(t).mutation(api.menuAIImageGen.startGeneration, {
			menuItemId: ids.menuItemId,
		});
		expect(result?.attempt).toBe(2);
		const draft = await t.run(async (ctx) => ctx.db.get(draftId));
		expect(draft?.status).toBe(MENU_AI_IMAGE_DRAFT_STATUS.SUPERSEDED);
		expect(await storedFileCount(t)).toBe(0);
	});

	it("enforces the organization's monthly limit, ignoring failed attempts", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t, { monthlyLimit: 2 });
		await insertJobAndDraft(t, ids, "approved"); // done, counts
		await t.run(async (ctx) =>
			ctx.db.insert(TABLE.MENU_AI_IMAGE_GEN_JOBS, {
				restaurantId: ids.restaurantId,
				organizationId: ids.organizationId,
				menuItemId: ids.menuItemId,
				attempt: 2,
				status: MENU_AI_IMAGE_JOB_STATUS.FAILED,
				error: "provider_error",
				requestedBy: MANAGER,
				model: "m",
				retries: 0,
				createdAt: NOW,
				finishedAt: NOW,
			})
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => okImageResponse())
		);
		vi.stubEnv("OPENROUTER_API_KEY", "test-key");

		// 1 counted + this one = 2 = limit → allowed, remaining 0.
		const [first, e1] = await asManager(t).mutation(api.menuAIImageGen.startGeneration, {
			menuItemId: ids.menuItemId,
		});
		expect(e1).toBeNull();
		expect(first?.remainingThisMonth).toBe(0);
		await t.finishInProgressScheduledFunctions();

		const [, e2] = await asManager(t).mutation(api.menuAIImageGen.startGeneration, {
			menuItemId: ids.menuItemId,
		});
		expect(e2?.name).toBe("AI_IMAGE_MONTHLY_LIMIT_REACHED");
	});

	it("is switched off by a limit of 0", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t, { monthlyLimit: 0 });
		const [, error] = await asManager(t).mutation(api.menuAIImageGen.startGeneration, {
			menuItemId: ids.menuItemId,
		});
		expect(error?.name).toBe("AI_IMAGE_MONTHLY_LIMIT_REACHED");
	});

	it("does not count last month's jobs", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t, { monthlyLimit: 1 });
		await t.run(async (ctx) =>
			ctx.db.insert(TABLE.MENU_AI_IMAGE_GEN_JOBS, {
				restaurantId: ids.restaurantId,
				organizationId: ids.organizationId,
				menuItemId: ids.menuItemId,
				attempt: 1,
				status: MENU_AI_IMAGE_JOB_STATUS.DONE,
				requestedBy: MANAGER,
				model: "m",
				retries: 0,
				createdAt: Date.UTC(2020, 0, 15),
				finishedAt: Date.UTC(2020, 0, 15),
			})
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => okImageResponse())
		);
		vi.stubEnv("OPENROUTER_API_KEY", "test-key");
		const [, error] = await asManager(t).mutation(api.menuAIImageGen.startGeneration, {
			menuItemId: ids.menuItemId,
		});
		expect(error).toBeNull();
	});
});

describe("getItemGeneration", () => {
	it("reports the pending draft with a url, the attempt count, and what is left", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		await insertJobAndDraft(t, ids, "pending");

		const view = await asManager(t).query(api.menuAIImageGen.getItemGeneration, {
			menuItemId: ids.menuItemId,
		});
		expect(view.pendingDraft?.imageUrl).toMatch(/^https?:\/\//);
		expect(view.pendingDraft?.attempt).toBe(1);
		expect(view.attemptCount).toBe(1);
		expect(view.activeJob).toBeNull();
		expect(view.monthlyLimit).toBe(MENU_AI_IMAGE_DEFAULT_MONTHLY_LIMIT_PER_ORG);
		expect(view.remainingThisMonth).toBe(MENU_AI_IMAGE_DEFAULT_MONTHLY_LIMIT_PER_ORG - 1);
	});

	it("surfaces a recent failure so the panel can explain it", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const jobId = await insertQueuedJob(t, ids);
		await t.run(async (ctx) =>
			ctx.db.patch(jobId, {
				status: MENU_AI_IMAGE_JOB_STATUS.FAILED,
				error: "credits_exhausted",
				finishedAt: Date.now(),
			})
		);
		const view = await asManager(t).query(api.menuAIImageGen.getItemGeneration, {
			menuItemId: ids.menuItemId,
		});
		expect(view.activeJob).toMatchObject({ status: "failed", error: "credits_exhausted" });
	});

	it("refuses an outsider", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		await expect(
			t
				.withIdentity({ subject: OUTSIDER })
				.query(api.menuAIImageGen.getItemGeneration, { menuItemId: ids.menuItemId })
		).rejects.toThrow();
	});
});

describe("approveDraft / rejectDraft", () => {
	it("approve moves the blob onto the item, marks it generated, and supersedes an older approved draft", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const older = await insertJobAndDraft(t, ids, "approved"); // item currently shows this blob
		const newer = await insertJobAndDraft(t, ids, "pending");
		expect(await storedFileCount(t)).toBe(2);

		const [, error] = await asManager(t).mutation(api.menuAIImageGen.approveDraft, {
			draftId: newer.draftId,
		});
		expect(error).toBeNull();

		const { item, olderDraft, newerDraft } = await t.run(async (ctx) => ({
			item: await ctx.db.get(ids.menuItemId),
			olderDraft: await ctx.db.get(older.draftId),
			newerDraft: await ctx.db.get(newer.draftId),
		}));
		expect(item?.imageStorageId).toBe(newer.storageId);
		expect(item?.imageSource).toBe(MENU_ITEM_IMAGE_SOURCE.GENERATED);
		expect(newerDraft?.status).toBe(MENU_AI_IMAGE_DRAFT_STATUS.APPROVED);
		expect(newerDraft?.reviewedBy).toBe(MANAGER);
		expect(olderDraft?.status).toBe(MENU_AI_IMAGE_DRAFT_STATUS.SUPERSEDED);
		// The older blob was the item's image and is gone; the newer one is the item's now.
		expect(await storedFileCount(t)).toBe(1);
	});

	it("approve refuses a draft that is not pending", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const { draftId } = await insertJobAndDraft(t, ids, "approved");
		const [, error] = await asManager(t).mutation(api.menuAIImageGen.approveDraft, { draftId });
		expect(error?.name).toBe("CONFLICT");
	});

	it("reject deletes the blob and keeps the row", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const { draftId } = await insertJobAndDraft(t, ids, "pending");

		const [, error] = await asManager(t).mutation(api.menuAIImageGen.rejectDraft, { draftId });
		expect(error).toBeNull();
		const draft = await t.run(async (ctx) => ctx.db.get(draftId));
		expect(draft?.status).toBe(MENU_AI_IMAGE_DRAFT_STATUS.REJECTED);
		expect(await storedFileCount(t)).toBe(0);
	});
});

describe("imageSource on the upload paths", () => {
	it("update with an uploaded image marks the source uploaded, and removeImage clears it", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		await insertJobAndDraft(t, ids, "approved");
		const uploaded = await t.run(async (ctx) =>
			ctx.storage.store(new Blob([TINY_JPEG], { type: "image/jpeg" }))
		);

		const [, e1] = await asManager(t).mutation(api.menuItems.update, {
			itemId: ids.menuItemId,
			imageStorageId: uploaded,
		});
		expect(e1).toBeNull();
		let item = await t.run(async (ctx) => ctx.db.get(ids.menuItemId));
		expect(item?.imageSource).toBe(MENU_ITEM_IMAGE_SOURCE.UPLOADED);

		const [, e2] = await asManager(t).mutation(api.menuItems.removeImage, {
			itemId: ids.menuItemId,
		});
		expect(e2).toBeNull();
		item = await t.run(async (ctx) => ctx.db.get(ids.menuItemId));
		expect(item?.imageSource).toBeUndefined();
		expect(item?.imageStorageId).toBeUndefined();
	});
});

describe("organizations.updateOrganization aiImageMonthlyLimit", () => {
	it("lets an admin set it and refuses a manager", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const [, e1] = await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.organizations.updateOrganization, {
				id: ids.organizationId,
				aiImageMonthlyLimit: 250,
			});
		expect(e1).toBeNull();
		const org = await t.run(async (ctx) => ctx.db.get(ids.organizationId));
		expect(org?.aiImageMonthlyLimit).toBe(250);

		const [, e2] = await asManager(t).mutation(api.organizations.updateOrganization, {
			id: ids.organizationId,
			aiImageMonthlyLimit: 5,
		});
		expect(e2).not.toBeNull();
	});

	it("rejects a negative or non-integer limit", async () => {
		const t = convexTest(schema, modules);
		const ids = await seed(t);
		const [, error] = await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.organizations.updateOrganization, {
				id: ids.organizationId,
				aiImageMonthlyLimit: -1,
			});
		expect(error?.name).toBe("VALIDATION_ERROR");
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test convex/_tests/menuAIImageGen`
Expected: FAIL — `api.menuAIImageGen.startGeneration` undefined, etc.

- [ ] **Step 3: Implement the public API**

Append to `convex/menuAIImageGen.ts` (extend the imports: `mutation, query` from `./_generated/server`; `internal` from `./_generated/api`; `MenuAIImageError, NotFoundError, ConflictError, ERROR_NAMES` and object types from `./_shared/errors`; `AsyncReturn` from `./_shared/types`; `getCurrentUserId, requireRestaurantManagerOrAbove` from `./_util/auth`; `appendAuditEvent, stampUpdated` from `./_util/audit`; `MENU_AI_IMAGE_DEFAULT_MODEL, MENU_AI_IMAGE_DEFAULT_MONTHLY_LIMIT_PER_ORG, MENU_AI_IMAGE_FAILURE, MENU_AI_IMAGE_STALE_JOB_MS, MENU_ITEM_IMAGE_SOURCE` from `./constants`; `monthStartUtc` from `./menuAIImageGenHelpers`; `QueryCtx, MutationCtx` types):

```ts
// ============================================================================
// Monthly cap
// ============================================================================

export function monthlyLimitFor(org: Doc<"organizations"> | null): number {
	return org?.aiImageMonthlyLimit ?? MENU_AI_IMAGE_DEFAULT_MONTHLY_LIMIT_PER_ORG;
}

/**
 * Jobs that count against this month: queued, running, done. Failed attempts
 * cost nothing and do not count. Counted from the table rather than a
 * counter so the number can never drift from what was generated; the read
 * is bounded by the cap itself.
 */
export async function countMonthlyGenerations(
	ctx: QueryCtx | MutationCtx,
	organizationId: Id<"organizations">,
	now: number
): Promise<number> {
	const since = monthStartUtc(now);
	const jobs = await ctx.db
		.query(TABLE.MENU_AI_IMAGE_GEN_JOBS)
		.withIndex("by_organization_createdAt", (q) =>
			q.eq("organizationId", organizationId).gte("createdAt", since)
		)
		.collect();
	return jobs.filter((job) => job.status !== MENU_AI_IMAGE_JOB_STATUS.FAILED).length;
}

async function supersedePendingDrafts(
	ctx: MutationCtx,
	menuItemId: Id<"menuItems">,
	userId: string
) {
	const pending = await ctx.db
		.query(TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS)
		.withIndex("by_menuItem_status", (q) =>
			q.eq("menuItemId", menuItemId).eq("status", MENU_AI_IMAGE_DRAFT_STATUS.PENDING)
		)
		.collect();
	const now = Date.now();
	for (const draft of pending) {
		await ctx.storage.delete(draft.storageId);
		await ctx.db.patch(draft._id, {
			status: MENU_AI_IMAGE_DRAFT_STATUS.SUPERSEDED,
			reviewedBy: userId,
			reviewedAt: now,
		});
	}
}

// ============================================================================
// Public
// ============================================================================

export const startGeneration = mutation({
	args: { menuItemId: v.id(TABLE.MENU_ITEMS) },
	handler: async function (
		ctx,
		{ menuItemId }
	): AsyncReturn<
		{ jobId: Id<"menuAIImageGenJobs">; attempt: number; remainingThisMonth: number },
		AuthErrors | NotFoundErrorObject | MenuAIImageErrorObject
	> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];
		const item = await ctx.db.get(menuItemId);
		if (!item) return [null, new NotFoundError("Menu item not found").toObject()];
		const [restaurant, permError] = await requireRestaurantManagerOrAbove(
			ctx,
			userId,
			item.restaurantId
		);
		if (permError) return [null, permError];

		const now = Date.now();
		const inFlight = await ctx.db
			.query(TABLE.MENU_AI_IMAGE_GEN_JOBS)
			.withIndex("by_menuItem", (q) => q.eq("menuItemId", menuItemId))
			.collect();
		for (const job of inFlight) {
			const active =
				job.status === MENU_AI_IMAGE_JOB_STATUS.QUEUED ||
				job.status === MENU_AI_IMAGE_JOB_STATUS.RUNNING;
			if (!active) continue;
			if (now - (job.startedAt ?? job.createdAt) < MENU_AI_IMAGE_STALE_JOB_MS) {
				return [null, new MenuAIImageError(ERROR_NAMES.AI_IMAGE_GENERATION_IN_PROGRESS).toObject()];
			}
			// A crashed action would otherwise lock the item forever.
			await ctx.db.patch(job._id, {
				status: MENU_AI_IMAGE_JOB_STATUS.FAILED,
				error: MENU_AI_IMAGE_FAILURE.TIMEOUT,
				finishedAt: now,
			});
		}

		const org = await ctx.db.get(restaurant.organizationId);
		const limit = monthlyLimitFor(org);
		const used = await countMonthlyGenerations(ctx, restaurant.organizationId, now);
		if (used >= limit) {
			return [null, new MenuAIImageError(ERROR_NAMES.AI_IMAGE_MONTHLY_LIMIT_REACHED).toObject()];
		}

		await supersedePendingDrafts(ctx, menuItemId, userId);

		const attempt = inFlight.reduce((max, job) => Math.max(max, job.attempt), 0) + 1;
		const jobId = await ctx.db.insert(TABLE.MENU_AI_IMAGE_GEN_JOBS, {
			restaurantId: item.restaurantId,
			organizationId: restaurant.organizationId,
			menuItemId,
			attempt,
			status: MENU_AI_IMAGE_JOB_STATUS.QUEUED,
			requestedBy: userId,
			model: process.env.MENU_AI_IMAGE_MODEL ?? MENU_AI_IMAGE_DEFAULT_MODEL,
			retries: 0,
			createdAt: now,
		});
		await ctx.scheduler.runAfter(0, internal.menuAIImageGenActions.generate, { jobId });
		return [{ jobId, attempt, remainingThisMonth: limit - used - 1 }, null];
	},
});

export interface ItemGenerationView {
	activeJob: {
		jobId: Id<"menuAIImageGenJobs">;
		status: "queued" | "running" | "failed";
		attempt: number;
		error?: string;
	} | null;
	pendingDraft: {
		draftId: Id<"menuItemAIImageGenDrafts">;
		imageUrl: string;
		attempt: number;
		prompt: string;
	} | null;
	attemptCount: number;
	remainingThisMonth: number;
	monthlyLimit: number;
}

const RECENT_FAILURE_MS = 60 * 60 * 1000;

/** Live view for the item's image panel. Throws on auth failure (like branding.getBrandingImages). */
export const getItemGeneration = query({
	args: { menuItemId: v.id(TABLE.MENU_ITEMS) },
	handler: async (ctx, { menuItemId }): Promise<ItemGenerationView> => {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) throw authError;
		const item = await ctx.db.get(menuItemId);
		if (!item) throw new NotFoundError("Menu item not found");
		const [restaurant, permError] = await requireRestaurantManagerOrAbove(
			ctx,
			userId,
			item.restaurantId
		);
		if (permError) throw permError;

		const now = Date.now();
		const jobs = await ctx.db
			.query(TABLE.MENU_AI_IMAGE_GEN_JOBS)
			.withIndex("by_menuItem", (q) => q.eq("menuItemId", menuItemId))
			.collect();
		const latest = jobs.reduce<Doc<"menuAIImageGenJobs"> | null>(
			(best, job) => (!best || job.createdAt > best.createdAt ? job : best),
			null
		);
		let activeJob: ItemGenerationView["activeJob"] = null;
		if (latest) {
			if (
				latest.status === MENU_AI_IMAGE_JOB_STATUS.QUEUED ||
				latest.status === MENU_AI_IMAGE_JOB_STATUS.RUNNING
			) {
				activeJob = { jobId: latest._id, status: latest.status, attempt: latest.attempt };
			} else if (
				latest.status === MENU_AI_IMAGE_JOB_STATUS.FAILED &&
				now - (latest.finishedAt ?? latest.createdAt) < RECENT_FAILURE_MS
			) {
				activeJob = {
					jobId: latest._id,
					status: "failed",
					attempt: latest.attempt,
					error: latest.error,
				};
			}
		}

		const pending = await ctx.db
			.query(TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS)
			.withIndex("by_menuItem_status", (q) =>
				q.eq("menuItemId", menuItemId).eq("status", MENU_AI_IMAGE_DRAFT_STATUS.PENDING)
			)
			.first();
		const imageUrl = pending ? await ctx.storage.getUrl(pending.storageId) : null;

		const org = await ctx.db.get(restaurant.organizationId);
		const monthlyLimit = monthlyLimitFor(org);
		const used = await countMonthlyGenerations(ctx, restaurant.organizationId, now);
		return {
			activeJob,
			pendingDraft:
				pending && imageUrl
					? { draftId: pending._id, imageUrl, attempt: pending.attempt, prompt: pending.prompt }
					: null,
			attemptCount: jobs.length,
			remainingThisMonth: Math.max(0, monthlyLimit - used),
			monthlyLimit,
		};
	},
});

async function loadPendingDraftForReview(
	ctx: MutationCtx,
	draftId: Id<"menuItemAIImageGenDrafts">
) {
	const [userId, authError] = await getCurrentUserId(ctx);
	if (authError) return { error: authError } as const;
	const draft = await ctx.db.get(draftId);
	if (!draft) return { error: new NotFoundError("Draft not found").toObject() } as const;
	const [, permError] = await requireRestaurantManagerOrAbove(ctx, userId, draft.restaurantId);
	if (permError) return { error: permError } as const;
	if (draft.status !== MENU_AI_IMAGE_DRAFT_STATUS.PENDING) {
		return { error: new ConflictError("Draft is no longer pending").toObject() } as const;
	}
	return { userId, draft } as const;
}

export const approveDraft = mutation({
	args: { draftId: v.id(TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS) },
	handler: async function (
		ctx,
		{ draftId }
	): AsyncReturn<null, AuthErrors | NotFoundErrorObject | ConflictErrorObject> {
		const loaded = await loadPendingDraftForReview(ctx, draftId);
		if ("error" in loaded) return [null, loaded.error];
		const { userId, draft } = loaded;
		const item = await ctx.db.get(draft.menuItemId);
		if (!item) return [null, new NotFoundError("Menu item not found").toObject()];
		const now = Date.now();

		// The item's previous image goes. If it was an approved draft, that row
		// becomes superseded — its blob is deleted exactly once, here.
		if (item.imageStorageId) {
			await ctx.storage.delete(item.imageStorageId);
			const approvedBefore = await ctx.db
				.query(TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS)
				.withIndex("by_menuItem_status", (q) =>
					q.eq("menuItemId", item._id).eq("status", MENU_AI_IMAGE_DRAFT_STATUS.APPROVED)
				)
				.collect();
			for (const old of approvedBefore) {
				await ctx.db.patch(old._id, {
					status: MENU_AI_IMAGE_DRAFT_STATUS.SUPERSEDED,
					reviewedBy: userId,
					reviewedAt: now,
				});
			}
		}

		await ctx.db.patch(item._id, {
			imageStorageId: draft.storageId,
			imageSource: MENU_ITEM_IMAGE_SOURCE.GENERATED,
			...stampUpdated(userId),
		});
		await ctx.db.patch(draft._id, {
			status: MENU_AI_IMAGE_DRAFT_STATUS.APPROVED,
			reviewedBy: userId,
			reviewedAt: now,
		});
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.MENU_ITEMS,
			aggregateId: item._id,
			eventType: "menuItems.aiImageApproved",
			restaurantId: item.restaurantId,
			payload: { draftId: draft._id, jobId: draft.jobId, attempt: draft.attempt },
			userId,
		});
		return [null, null];
	},
});

export const rejectDraft = mutation({
	args: { draftId: v.id(TABLE.MENU_ITEM_AI_IMAGE_GEN_DRAFTS) },
	handler: async function (
		ctx,
		{ draftId }
	): AsyncReturn<null, AuthErrors | NotFoundErrorObject | ConflictErrorObject> {
		const loaded = await loadPendingDraftForReview(ctx, draftId);
		if ("error" in loaded) return [null, loaded.error];
		const { userId, draft } = loaded;
		await ctx.storage.delete(draft.storageId);
		await ctx.db.patch(draft._id, {
			status: MENU_AI_IMAGE_DRAFT_STATUS.REJECTED,
			reviewedBy: userId,
			reviewedAt: Date.now(),
		});
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.MENU_ITEMS,
			aggregateId: draft.menuItemId,
			eventType: "menuItems.aiImageRejected",
			restaurantId: draft.restaurantId,
			payload: { draftId: draft._id, jobId: draft.jobId, attempt: draft.attempt },
			userId,
		});
		return [null, null];
	},
});
```

`AuthErrors`, `NotFoundErrorObject`, `ConflictErrorObject`, `MenuAIImageErrorObject` come from `./_shared/errors` / `./_shared/types` — mirror the imports at the top of `convex/menuItems.ts`. `requireRestaurantManagerOrAbove` returns `[restaurant, null]` on success (see `convex/_util/auth.ts:150`), which is why `restaurant` is destructured above.

- [ ] **Step 4: Upload paths set `imageSource`**

In `convex/menuItems.ts`:

- `create`: in the `ctx.db.insert(TABLE.MENU_ITEMS, {...})` add `...(args.imageStorageId && { imageSource: MENU_ITEM_IMAGE_SOURCE.UPLOADED }),`.
- `update`: in the `ctx.db.patch` add `...(args.imageStorageId !== undefined && { imageSource: MENU_ITEM_IMAGE_SOURCE.UPLOADED }),` right after the `imageStorageId` spread.
- `removeImage`: change the patch to `{ imageStorageId: undefined, imageSource: undefined, ...stampUpdated(userId) }`.
  Import `MENU_ITEM_IMAGE_SOURCE` from `./constants`.

- [ ] **Step 5: Admin-adjustable limit**

In `convex/organizations.ts` `updateOrganization`: add arg `aiImageMonthlyLimit: v.optional(v.number())`; after the name validation add

```ts
if (
	args.aiImageMonthlyLimit !== undefined &&
	(!Number.isInteger(args.aiImageMonthlyLimit) ||
		args.aiImageMonthlyLimit < 0 ||
		args.aiImageMonthlyLimit > 100000)
) {
	return [
		null,
		new UserInputValidationError({
			fields: [
				{ field: "aiImageMonthlyLimit", message: "Must be a whole number between 0 and 100000" },
			],
		}).toObject(),
	];
}
```

and include `...(args.aiImageMonthlyLimit !== undefined && { aiImageMonthlyLimit: args.aiImageMonthlyLimit })` in the existing `ctx.db.patch`.

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm test convex/_tests/menuAIImageGen convex/_tests/restaurantPurge convex/restaurantPurgeCoverage`
Expected: PASS. Then `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/eslint convex`.

- [ ] **Step 7: Commit**

```bash
./node_modules/.bin/prettier --write convex/menuAIImageGen.ts convex/menuItems.ts convex/organizations.ts convex/_tests/menuAIImageGen.test.ts
git add convex/menuAIImageGen.ts convex/menuItems.ts convex/organizations.ts convex/_tests/menuAIImageGen.test.ts
git commit -m "feat(ai-images): start/approve/reject with the per-organization monthly cap and imageSource

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Error codes and i18n

**Files:**

- Modify: `src/global/i18n/keys/errors.ts` (`BACKEND_ERROR_CODES`, ~line 22)
- Modify: `src/global/i18n/keys/menus.ts` (near `FORM_IMAGE_HEADER`, ~line 101)
- Modify: `src/global/i18n/keys/ordering.ts` (after `MENU_FULL_MENU_CLOSE`, line 48)
- Modify: `src/global/i18n/locales/en.json`, `src/global/i18n/locales/es.json`
- Test: `src/global/i18n/locales.test.ts` (existing parity test) + one new assertion file below

**Interfaces (produces):**

```ts
MenusKeys.AI_IMAGE_GENERATE |
	AI_IMAGE_GENERATING |
	AI_IMAGE_ATTEMPT |
	AI_IMAGE_USE |
	AI_IMAGE_REGENERATE |
	AI_IMAGE_DISCARD |
	AI_IMAGE_BADGE |
	AI_IMAGE_BADGE_TOOLTIP |
	AI_IMAGE_REMAINING |
	AI_IMAGE_LIMIT_OFF |
	AI_IMAGE_FAILED;
OrderingKeys.MENU_GENERATED_IMAGE | MENU_GENERATED_IMAGE_DETAIL;
BACKEND_ERROR_CODES +=
	"AI_IMAGE_GENERATION_IN_PROGRESS" |
	"AI_IMAGE_MONTHLY_LIMIT_REACHED" |
	"AI_IMAGE_CREDITS_EXHAUSTED" |
	"AI_IMAGE_GENERATION_FAILED";
```

- [ ] **Step 1: Write the failing test**

Create `src/global/i18n/aiImageKeys.test.ts`:

```ts
/* eslint-disable boundaries/no-unknown-files */
import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import es from "./locales/es.json";
import { ERROR_CODE_KEYS } from "./keys/errors";
import { MenusKeys } from "./keys/menus";
import { OrderingKeys } from "./keys/ordering";

function resolve(locale: unknown, key: string): unknown {
	return key.split(".").reduce<any>((o, k) => o?.[k], locale);
}

describe("AI image i18n", () => {
	it.each([
		MenusKeys.AI_IMAGE_GENERATE,
		MenusKeys.AI_IMAGE_GENERATING,
		MenusKeys.AI_IMAGE_ATTEMPT,
		MenusKeys.AI_IMAGE_USE,
		MenusKeys.AI_IMAGE_REGENERATE,
		MenusKeys.AI_IMAGE_DISCARD,
		MenusKeys.AI_IMAGE_BADGE,
		MenusKeys.AI_IMAGE_BADGE_TOOLTIP,
		MenusKeys.AI_IMAGE_REMAINING,
		MenusKeys.AI_IMAGE_LIMIT_OFF,
		MenusKeys.AI_IMAGE_FAILED,
		OrderingKeys.MENU_GENERATED_IMAGE,
		OrderingKeys.MENU_GENERATED_IMAGE_DETAIL,
		ERROR_CODE_KEYS.AI_IMAGE_GENERATION_IN_PROGRESS,
		ERROR_CODE_KEYS.AI_IMAGE_MONTHLY_LIMIT_REACHED,
		ERROR_CODE_KEYS.AI_IMAGE_CREDITS_EXHAUSTED,
		ERROR_CODE_KEYS.AI_IMAGE_GENERATION_FAILED,
	])("%s resolves in both locales", (key) => {
		expect(typeof resolve(en, key)).toBe("string");
		expect(typeof resolve(es, key)).toBe("string");
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test aiImageKeys`
Expected: FAIL — keys undefined.

- [ ] **Step 3: Add keys**

`keys/errors.ts` — append to `BACKEND_ERROR_CODES` under a comment `// AI menu images — convex/_shared/errors.ts`:

```ts
	"AI_IMAGE_GENERATION_IN_PROGRESS",
	"AI_IMAGE_MONTHLY_LIMIT_REACHED",
	"AI_IMAGE_CREDITS_EXHAUSTED",
	"AI_IMAGE_GENERATION_FAILED",
```

`keys/menus.ts` — after `FORM_IMAGE_HEADER`:

```ts
	AI_IMAGE_GENERATE: "menus.aiImage.generate",
	AI_IMAGE_GENERATING: "menus.aiImage.generating",
	AI_IMAGE_ATTEMPT: "menus.aiImage.attempt",
	AI_IMAGE_USE: "menus.aiImage.use",
	AI_IMAGE_REGENERATE: "menus.aiImage.regenerate",
	AI_IMAGE_DISCARD: "menus.aiImage.discard",
	AI_IMAGE_BADGE: "menus.aiImage.badge",
	AI_IMAGE_BADGE_TOOLTIP: "menus.aiImage.badgeTooltip",
	AI_IMAGE_REMAINING: "menus.aiImage.remaining",
	AI_IMAGE_LIMIT_OFF: "menus.aiImage.limitOff",
	AI_IMAGE_FAILED: "menus.aiImage.failed",
```

`keys/ordering.ts` — after `MENU_FULL_MENU_CLOSE`:

```ts
	MENU_GENERATED_IMAGE: "ordering.menu.generatedImage",
	MENU_GENERATED_IMAGE_DETAIL: "ordering.menu.generatedImageDetail",
```

`en.json` — under `menus` add an `aiImage` object; under `ordering.menu` add two keys; under `errors` add four:

```json
"aiImage": {
	"generate": "Generate with AI",
	"generating": "Generating…",
	"attempt": "Attempt {{n}}",
	"use": "Use this image",
	"regenerate": "Generate another",
	"discard": "Discard",
	"badge": "AI",
	"badgeTooltip": "AI-generated image, attempt {{n}}",
	"remaining": "{{count}} left this month",
	"limitOff": "AI images are switched off for this organization",
	"failed": "Couldn't generate an image. Try again."
}
```

```json
"generatedImage": "AI image",
"generatedImageDetail": "This image was AI-generated and may differ from the actual dish."
```

```json
"AI_IMAGE_GENERATION_IN_PROGRESS": "An image is already being generated for this item.",
"AI_IMAGE_MONTHLY_LIMIT_REACHED": "This organization has used all its AI images for the month.",
"AI_IMAGE_CREDITS_EXHAUSTED": "AI image credits are exhausted. Contact Tavli support.",
"AI_IMAGE_GENERATION_FAILED": "Couldn't generate an image. Try again."
```

`es.json` — the same keys:

```json
"aiImage": {
	"generate": "Generar con IA",
	"generating": "Generando…",
	"attempt": "Intento {{n}}",
	"use": "Usar esta imagen",
	"regenerate": "Generar otra",
	"discard": "Descartar",
	"badge": "IA",
	"badgeTooltip": "Imagen generada con IA, intento {{n}}",
	"remaining": "Quedan {{count}} este mes",
	"limitOff": "Las imágenes con IA están desactivadas para esta organización",
	"failed": "No se pudo generar la imagen. Inténtalo de nuevo."
}
```

```json
"generatedImage": "Imagen generada",
"generatedImageDetail": "Esta imagen fue generada con IA y puede diferir del platillo real."
```

```json
"AI_IMAGE_GENERATION_IN_PROGRESS": "Ya se está generando una imagen para este producto.",
"AI_IMAGE_MONTHLY_LIMIT_REACHED": "Esta organización ya usó todas sus imágenes con IA del mes.",
"AI_IMAGE_CREDITS_EXHAUSTED": "Se agotaron los créditos de imágenes con IA. Contacta a soporte de Tavli.",
"AI_IMAGE_GENERATION_FAILED": "No se pudo generar la imagen. Inténtalo de nuevo."
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test aiImageKeys src/global/i18n/locales`
Expected: PASS, including the existing parity test.

- [ ] **Step 5: Commit**

```bash
./node_modules/.bin/prettier --write src/global/i18n
git add src/global/i18n
git commit -m "feat(ai-images): error codes and i18n for generation, badge and diner disclosure

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The in-place generation panel

**Files:**

- Create: `src/features/menus/components/AIImageGenerationPanel.tsx`
- Test: `src/features/menus/components/AIImageGenerationPanel.test.tsx`
- Modify: `src/features/menus/components/ItemImageManager.tsx` (render the panel inside the controls row)

**Interfaces:**

- Consumes: `api.menuAIImageGen.getItemGeneration`, `startGeneration`, `approveDraft`, `rejectDraft` (Task 4); `MenusKeys.AI_IMAGE_*` (Task 5); `useConvexMutate` from `@/global/hooks`; `getErrorMessage(err, t, fallbackKey)` from `@/global/utils/errorMessages`; `unwrapResult` from `@/global/utils/unwrapResult`.
- Produces: `export function AIImageGenerationPanel({ itemId }: { readonly itemId: Id<"menuItems"> })`.

- [ ] **Step 1: Write the failing tests**

```tsx
/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	view: null as any,
	start: vi.fn(async () => [{ jobId: "j1", attempt: 1, remainingThisMonth: 99 }, null]),
	approve: vi.fn(async () => [null, null]),
	reject: vi.fn(async () => [null, null]),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: any, args: any) => ({ ref, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: hoisted.view }) }));
vi.mock("convex/_generated/api", () => ({
	api: {
		menuAIImageGen: {
			getItemGeneration: { name: "getItemGeneration" },
			startGeneration: { name: "startGeneration" },
			approveDraft: { name: "approveDraft" },
			rejectDraft: { name: "rejectDraft" },
		},
	},
}));
vi.mock("@/global/hooks", () => ({
	useConvexMutate: (ref: any) => {
		const fn =
			ref.name === "startGeneration"
				? hoisted.start
				: ref.name === "approveDraft"
					? hoisted.approve
					: hoisted.reject;
		return { mutateAsync: fn, isPending: false };
	},
}));

import { AIImageGenerationPanel } from "./AIImageGenerationPanel";

const ITEM = "menuItems:1" as any;

describe("AIImageGenerationPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hoisted.view = {
			activeJob: null,
			pendingDraft: null,
			attemptCount: 0,
			remainingThisMonth: 100,
			monthlyLimit: 100,
		};
	});

	it("offers to generate and starts an attempt on click", async () => {
		render(<AIImageGenerationPanel itemId={ITEM} />);
		fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));
		await waitFor(() => expect(hoisted.start).toHaveBeenCalledWith({ menuItemId: ITEM }));
	});

	it("shows progress with the attempt number while a job runs", () => {
		hoisted.view = { ...hoisted.view, activeJob: { jobId: "j", status: "running", attempt: 2 } };
		render(<AIImageGenerationPanel itemId={ITEM} />);
		expect(screen.getByText(/generating/i)).toBeTruthy();
		expect(screen.getByText(/attempt 2/i)).toBeTruthy();
		expect(screen.queryByRole("button", { name: /generate with ai/i })).toBeNull();
	});

	it("previews a pending draft with use / generate another / discard", async () => {
		hoisted.view = {
			...hoisted.view,
			attemptCount: 1,
			pendingDraft: { draftId: "d1", imageUrl: "https://x/d1.jpg", attempt: 1, prompt: "p" },
		};
		render(<AIImageGenerationPanel itemId={ITEM} />);
		expect((screen.getByRole("img") as HTMLImageElement).src).toBe("https://x/d1.jpg");

		fireEvent.click(screen.getByRole("button", { name: /use this image/i }));
		await waitFor(() => expect(hoisted.approve).toHaveBeenCalledWith({ draftId: "d1" }));

		fireEvent.click(screen.getByRole("button", { name: /generate another/i }));
		await waitFor(() => expect(hoisted.start).toHaveBeenCalledWith({ menuItemId: ITEM }));

		fireEvent.click(screen.getByRole("button", { name: /discard/i }));
		await waitFor(() => expect(hoisted.reject).toHaveBeenCalledWith({ draftId: "d1" }));
	});

	it("explains a recent failure and offers a retry", () => {
		hoisted.view = {
			...hoisted.view,
			activeJob: { jobId: "j", status: "failed", attempt: 1, error: "credits_exhausted" },
		};
		render(<AIImageGenerationPanel itemId={ITEM} />);
		expect(screen.getByText(/credits are exhausted/i)).toBeTruthy();
		expect(screen.getByRole("button", { name: /generate with ai/i })).toBeTruthy();
	});

	it("shows what is left once it is scarce and disables the button at zero", () => {
		hoisted.view = { ...hoisted.view, remainingThisMonth: 3 };
		const { unmount } = render(<AIImageGenerationPanel itemId={ITEM} />);
		expect(screen.getByText(/3 left this month/i)).toBeTruthy();
		unmount();

		hoisted.view = { ...hoisted.view, remainingThisMonth: 0 };
		render(<AIImageGenerationPanel itemId={ITEM} />);
		expect(
			(screen.getByRole("button", { name: /generate with ai/i }) as HTMLButtonElement).disabled
		).toBe(true);
	});

	it("says generation is switched off when the limit is zero", () => {
		hoisted.view = { ...hoisted.view, remainingThisMonth: 0, monthlyLimit: 0 };
		render(<AIImageGenerationPanel itemId={ITEM} />);
		expect(screen.getByText(/switched off/i)).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test AIImageGenerationPanel`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the panel**

```tsx
/**
 * "Generar con IA" for one menu item, in place (workstream B).
 *
 * Subscribes to the item's generation state and renders one of: the button,
 * progress with the attempt number, a pending draft with approve / regenerate
 * / discard, or a recent failure with a retry. A draft only reaches diners
 * through *Usar esta imagen* — approval is the whole point.
 */
import { useConvexMutate } from "@/global/hooks";
import { MenusKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const SCARCE_THRESHOLD = 20;

const FAILURE_KEYS: Record<string, string> = {
	credits_exhausted: "errors.AI_IMAGE_CREDITS_EXHAUSTED",
};

export function AIImageGenerationPanel({ itemId }: Readonly<{ readonly itemId: Id<"menuItems"> }>) {
	const { t } = useTranslation();
	const { data: view } = useQuery(
		convexQuery(api.menuAIImageGen.getItemGeneration, { menuItemId: itemId })
	);
	const start = useConvexMutate(api.menuAIImageGen.startGeneration);
	const approve = useConvexMutate(api.menuAIImageGen.approveDraft);
	const reject = useConvexMutate(api.menuAIImageGen.rejectDraft);
	const [error, setError] = useState<string | null>(null);

	const run = async (fn: () => Promise<unknown>) => {
		setError(null);
		try {
			unwrapResult(await fn());
		} catch (err) {
			setError(getErrorMessage(err, t, MenusKeys.AI_IMAGE_FAILED));
		}
	};
	const generate = () => run(() => start.mutateAsync({ menuItemId: itemId }));

	if (!view) return null;
	const busy = start.isPending || approve.isPending || reject.isPending;
	const switchedOff = view.monthlyLimit === 0;
	const exhausted = view.remainingThisMonth <= 0;

	const generateButton = (
		<button
			type="button"
			onClick={() => void generate()}
			disabled={busy || exhausted}
			className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs hover:bg-hover border border-border text-muted-foreground disabled:opacity-50"
		>
			<Sparkles size={14} />
			{t(MenusKeys.AI_IMAGE_GENERATE)}
		</button>
	);

	if (view.activeJob && view.activeJob.status !== "failed") {
		return (
			<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
				<Loader2 size={14} className="animate-spin" />
				{t(MenusKeys.AI_IMAGE_GENERATING)} ·{" "}
				{t(MenusKeys.AI_IMAGE_ATTEMPT, { n: view.activeJob.attempt })}
			</span>
		);
	}

	if (view.pendingDraft) {
		const draft = view.pendingDraft;
		return (
			<div className="flex items-center gap-2">
				<img
					src={draft.imageUrl}
					alt={t(MenusKeys.AI_IMAGE_ATTEMPT, { n: draft.attempt })}
					className="w-16 h-12 rounded object-cover"
				/>
				<span className="text-[11px] text-faint-foreground">
					{t(MenusKeys.AI_IMAGE_ATTEMPT, { n: draft.attempt })}
				</span>
				<button
					type="button"
					onClick={() => void run(() => approve.mutateAsync({ draftId: draft.draftId }))}
					disabled={busy}
					className="px-2 py-1 rounded text-xs font-medium hover-btn-primary disabled:opacity-50"
				>
					{t(MenusKeys.AI_IMAGE_USE)}
				</button>
				<button
					type="button"
					onClick={() => void generate()}
					disabled={busy || exhausted}
					className="px-2 py-1 rounded text-xs hover-btn-secondary disabled:opacity-50"
				>
					{t(MenusKeys.AI_IMAGE_REGENERATE)}
				</button>
				<button
					type="button"
					onClick={() => void run(() => reject.mutateAsync({ draftId: draft.draftId }))}
					disabled={busy}
					className="px-2 py-1 rounded text-xs text-destructive hover:bg-hover disabled:opacity-50"
				>
					{t(MenusKeys.AI_IMAGE_DISCARD)}
				</button>
				{error ? <span className="text-xs text-destructive">{error}</span> : null}
			</div>
		);
	}

	const failure = view.activeJob?.status === "failed" ? view.activeJob.error : null;
	return (
		<div className="flex flex-wrap items-center gap-2">
			{generateButton}
			{switchedOff ? (
				<span className="text-xs text-faint-foreground">{t(MenusKeys.AI_IMAGE_LIMIT_OFF)}</span>
			) : view.remainingThisMonth < SCARCE_THRESHOLD ? (
				<span className="text-xs text-faint-foreground">
					{t(MenusKeys.AI_IMAGE_REMAINING, { count: view.remainingThisMonth })}
				</span>
			) : null}
			{failure ? (
				<span className="text-xs text-destructive">
					{t(FAILURE_KEYS[failure] ?? MenusKeys.AI_IMAGE_FAILED)}
				</span>
			) : null}
			{error ? <span className="text-xs text-destructive">{error}</span> : null}
		</div>
	);
}
```

In `ItemImageManager.tsx`, inside `<div className="flex items-center gap-3">`, after the paste-hint span (still inside the `{!preview && (...)}` group is wrong — place it as a sibling after the `{preview && (...)}` block so it is always visible):

```tsx
<AIImageGenerationPanel itemId={itemId} />
```

with `import { AIImageGenerationPanel } from "./AIImageGenerationPanel";`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test AIImageGenerationPanel ItemImageManager`
Expected: PASS. `tsc` clean. If `t(MenusKeys.AI_IMAGE_ATTEMPT, { n })` interpolation shows "Attempt {{n}}" in a test, the key is missing `n` — check the locale JSON from Task 5.

- [ ] **Step 5: Commit**

```bash
./node_modules/.bin/prettier --write src/features/menus/components/AIImageGenerationPanel.tsx src/features/menus/components/AIImageGenerationPanel.test.tsx src/features/menus/components/ItemImageManager.tsx
git add src/features/menus/components/AIImageGenerationPanel.tsx src/features/menus/components/AIImageGenerationPanel.test.tsx src/features/menus/components/ItemImageManager.tsx
git commit -m "feat(ai-images): in-place Generate with AI panel in the item image manager

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Staff badge and diner disclosure

**Files:**

- Modify: `src/features/menus/components/MenuItemImagePreview.tsx` (add `imageSource` prop, badge)
- Modify: `src/features/menus/components/MenuItemRow.tsx` (line ~70, pass `imageSource={item.imageSource}`)
- Modify: `src/features/ordering/components/MenuBrowser.tsx` (`MenuItemCard`, ~line 785)
- Modify: `src/features/ordering/components/ItemDetailSheet.tsx` (~line 152)
- Test: `src/features/menus/components/MenuItemImagePreview.test.tsx` (new), `src/features/ordering/components/MenuBrowser.test.tsx` (append), `src/features/ordering/components/ItemDetailSheet.test.tsx` (new)

**Interfaces:**

- `MenuItemImagePreview` gains `readonly imageSource?: "uploaded" | "generated"`.
- `MenuItemWithImage` already spreads the doc, so `item.imageSource` is typed.

- [ ] **Step 1: Write the failing tests**

`MenuItemImagePreview.test.tsx`:

```tsx
/* eslint-disable boundaries/no-unknown-files */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MenuItemImagePreview } from "./MenuItemImagePreview";

describe("MenuItemImagePreview", () => {
	it("marks a generated image with an AI badge", () => {
		render(
			<MenuItemImagePreview imageUrl="https://x/a.jpg" itemName="Rib eye" imageSource="generated" />
		);
		expect(screen.getByText("AI")).toBeTruthy();
	});

	it("shows no badge for an uploaded image", () => {
		render(
			<MenuItemImagePreview imageUrl="https://x/a.jpg" itemName="Rib eye" imageSource="uploaded" />
		);
		expect(screen.queryByText("AI")).toBeNull();
	});
});
```

Append to `MenuBrowser.test.tsx` (uses the existing `overrides`/`QUERY_DATA` harness):

```tsx
it("tells the diner when a card's image is AI-generated", () => {
	overrides["menuItems:getByMenu"] = [
		{
			...(QUERY_DATA["menuItems:getByMenu"] as any[])[0],
			imageUrl: "https://x/rib.jpg",
			imageSource: "generated",
		},
	];
	render(
		<MenuBrowser
			restaurantId={"restaurants:test" as any}
			onSubmitOrder={() => {}}
			isSubmitting={false}
		/>
	);
	expect(screen.getByTestId("menu-item-card").textContent).toContain("AI image");
});
```

`ItemDetailSheet.test.tsx`:

```tsx
/* eslint-disable boundaries/no-unknown-files, @typescript-eslint/no-explicit-any */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/react-query", () => ({ convexQuery: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }) }));
vi.mock("convex/_generated/api", () => ({
	api: { optionGroups: { getForMenuItem: {} }, menuItems: {} },
}));

import { ItemDetailSheet } from "./ItemDetailSheet";

const item = {
	_id: "menuItems:1",
	name: "Rib eye",
	basePrice: 100000,
	imageUrl: "https://x/rib.jpg",
	imageSource: "generated",
	isAvailable: true,
} as any;

describe("ItemDetailSheet", () => {
	it("discloses an AI-generated image", () => {
		render(<ItemDetailSheet item={item} onClose={() => {}} onAddToCart={() => {}} />);
		expect(screen.getByText(/AI-generated/i)).toBeTruthy();
	});
});
```

If `ItemDetailSheet` requires more props or queries than mocked here, mirror the mocks used by `MenuBrowser.test.tsx` (it already mounts `ItemDetailSheet` through the mock there) — read the component's props block first and pass exactly what it requires.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test MenuItemImagePreview MenuBrowser ItemDetailSheet`
Expected: the three new tests FAIL (badge/hint text absent).

- [ ] **Step 3: Implement**

`MenuItemImagePreview.tsx`: add `imageSource?: "uploaded" | "generated"` to props; wrap the thumbnail `<img>` in `<span className="relative inline-block">` and after it render

```tsx
{
	imageSource === MENU_ITEM_IMAGE_SOURCE.GENERATED ? (
		<span
			className="absolute -bottom-1 -right-1 rounded px-1 text-[9px] font-bold leading-4 bg-primary text-primary-foreground pointer-events-none"
			title={t(MenusKeys.AI_IMAGE_BADGE_TOOLTIP, { n: "" }).replace(/,?\s*$/, "")}
		>
			{t(MenusKeys.AI_IMAGE_BADGE)}
		</span>
	) : null;
}
```

(The row does not know the attempt number; the tooltip key is reused without it. Import `MENU_ITEM_IMAGE_SOURCE` from `convex/constants`.)

`MenuItemRow.tsx` line ~70: `<MenuItemImagePreview imageUrl={item.imageUrl} itemName={item.name} imageSource={item.imageSource} />`.

`MenuBrowser.tsx` `MenuItemCard`: add `const { t } = useTranslation();` at the top of the function and, inside the `<button>` after the image element:

```tsx
{
	item.imageSource === MENU_ITEM_IMAGE_SOURCE.GENERATED ? (
		<span className="absolute bottom-[calc(100%-100%)] left-2 top-2 h-5 rounded px-1.5 text-[10px] font-medium leading-5 bg-black/60 text-white">
			{t(OrderingKeys.MENU_GENERATED_IMAGE)}
		</span>
	) : null;
}
```

Position it top-left only when there is no quantity chip there: use `left-2 top-2` when `!isSelected`, else `left-2 top-10`. Import `MENU_ITEM_IMAGE_SOURCE` from `convex/constants`.

`ItemDetailSheet.tsx`: after the price `<p>` (line ~156):

```tsx
{
	item.imageSource === MENU_ITEM_IMAGE_SOURCE.GENERATED ? (
		<p className="text-xs mt-1.5 text-faint-foreground">
			{t(OrderingKeys.MENU_GENERATED_IMAGE_DETAIL)}
		</p>
	) : null;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test MenuItemImagePreview MenuBrowser ItemDetailSheet`
Expected: PASS. `tsc` clean.

- [ ] **Step 5: Commit**

```bash
./node_modules/.bin/prettier --write src/features/menus/components src/features/ordering/components
git add src/features/menus/components/MenuItemImagePreview.tsx src/features/menus/components/MenuItemImagePreview.test.tsx src/features/menus/components/MenuItemRow.tsx src/features/ordering/components/MenuBrowser.tsx src/features/ordering/components/MenuBrowser.test.tsx src/features/ordering/components/ItemDetailSheet.tsx src/features/ordering/components/ItemDetailSheet.test.tsx
git commit -m "feat(ai-images): AI badge for staff, generated-image disclosure for diners

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Admin-adjustable limit in the organization dialog

**Files:**

- Modify: `src/features/organizations/components/OrganizationsTable/OrganizationFormDialog.tsx` (defaultValues ~line 53, submit args ~line 63, fields ~line 155)
- Test: `src/features/organizations/components/OrganizationsTable/OrganizationFormDialog.test.tsx` (new)

**Interfaces:** consumes `api.organizations.updateOrganization({ id, aiImageMonthlyLimit })` from Task 4.

- [ ] **Step 1: Write the failing test**

```tsx
/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ update: vi.fn(async () => ["organizations:1", null]) }));
vi.mock("@convex-dev/react-query", () => ({
	useConvexMutation: (ref: any) => (ref?.name === "update" ? hoisted.update : vi.fn()),
}));
vi.mock("@tanstack/react-query", () => ({
	useMutation: ({ mutationFn }: any) => ({ mutateAsync: mutationFn, isPending: false }),
}));
vi.mock("convex/_generated/api", () => ({
	api: {
		organizations: {
			createOrganization: { name: "create" },
			updateOrganization: { name: "update" },
		},
	},
}));

import { OrganizationFormDialog } from "./OrganizationFormDialog";

describe("OrganizationFormDialog", () => {
	it("saves the AI image monthly limit as a number", async () => {
		render(
			<OrganizationFormDialog
				organization={
					{ _id: "organizations:1", name: "Org", isActive: true, aiImageMonthlyLimit: 100 } as any
				}
				onClose={() => {}}
				onSuccess={() => {}}
			/>
		);
		const input = screen.getByLabelText(/AI images per month/i) as HTMLInputElement;
		expect(input.value).toBe("100");
		fireEvent.change(input, { target: { value: "250" } });
		fireEvent.submit(input.closest("form")!);
		await waitFor(() =>
			expect(hoisted.update).toHaveBeenCalledWith(
				expect.objectContaining({ id: "organizations:1", aiImageMonthlyLimit: 250 })
			)
		);
	});
});
```

If the dialog's props differ (e.g. an `open` prop), read its props block and pass what it requires; the assertion is what matters.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test OrganizationFormDialog`
Expected: FAIL — no "AI images per month" field.

- [ ] **Step 3: Implement**

In `OrganizationFormDialog.tsx`:

- `defaultValues`: add `aiImageMonthlyLimit: String(organization?.aiImageMonthlyLimit ?? 100),` (and in the reset block at ~line 89 if the form is reset there).
- In `onSubmit`, when `isEditing`, spread `aiImageMonthlyLimit: Number(value.aiImageMonthlyLimit)` into the update call only: `unwrapResult(await updateMutation.mutateAsync({ id: organization._id, ...args, aiImageMonthlyLimit: Number(value.aiImageMonthlyLimit) }));` (create keeps the default; the field is still rendered on create but ignored).
- After the description field:

```tsx
<form.Field
	name="aiImageMonthlyLimit"
	children={(field) => (
		<TextInput
			id="org-ai-image-limit"
			type="number"
			min={0}
			step={1}
			label="AI images per month (0 = off)"
			value={field.state.value}
			onChange={(e) => field.handleChange(e.target.value)}
			onBlur={field.handleBlur}
			error={fieldErrors.aiImageMonthlyLimit}
		/>
	)}
/>
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test OrganizationFormDialog`
Expected: PASS. `tsc` clean.

- [ ] **Step 5: Commit**

```bash
./node_modules/.bin/prettier --write src/features/organizations/components/OrganizationsTable
git add src/features/organizations/components/OrganizationsTable
git commit -m "feat(ai-images): admin-adjustable monthly AI image limit per organization

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Full verification and one real generation

**Files:** none new. Produces screenshots and a go/no-go.

- [ ] **Step 1: Whole suite, types, lint, format**

Run: `pnpm test` → all green. `./node_modules/.bin/tsc --noEmit` → clean. `pnpm lint` → 0 errors. `./node_modules/.bin/prettier --check 'src/**/*.{ts,tsx,json}' convex` → clean.

- [ ] **Step 2: Deploy the schema to the dev deployment**

The dev server in this repo is started as `infisical run --projectId=da9416bf-a247-4f41-b4c0-14b22f0aaff0 --env=dev --silent -- ./node_modules/.bin/vite dev --port 3001` (vite only). The new tables need `convex dev` to push once: run `infisical run --projectId=da9416bf-a247-4f41-b4c0-14b22f0aaff0 --env=dev --silent -- npx convex dev --once` from this worktree, and confirm in the Convex dashboard (`blessed-weasel-428`) that `menuAIImageGenJobs` and `menuItemAIImageGenDrafts` exist and that `OPENROUTER_API_KEY` is set.

- [ ] **Step 3: One real attempt, two clicks (~$0.08)**

In the admin Menus editor for `vernaculo`, expand an item without a photo (e.g. "arracheras"), click **Generar con IA**, watch _Generando… · Intento 1_, then the preview. Click **Generar otra** once (_Intento 2_). Approve one. Verify:

- the row thumbnail shows the **IA** badge;
- `/r/vernaculo-spgg/en/menu` renders the item as a card with the "AI image" hint, and the detail sheet has the disclosure line;
- in the dashboard, two job rows (attempt 1 superseded draft with its blob gone, attempt 2 approved) and `costUsd` populated;
- the organization's remaining count dropped by 2.
  Save screenshots of the panel (pending draft), the row badge, the diner card, and the detail sheet.

- [ ] **Step 4: Cap behaviour**

In Admin → Organizaciones set the organization's limit to the number already used this month, click Generar con IA on another item → the "used all its AI images" error and a disabled button. Set it back to 100.

- [ ] **Step 5: Report**

Post the four screenshots, the two jobs' `costUsd`, and any prompt-quality notes (the brief in `DISH_IMAGE_STYLE_BRIEF` is the one string to tune).

---

## Self-review notes

- **Spec coverage:** data model (T1), prompt/decoder/failure policy (T2), action with retries and bytes-through-action (T3), start/in-flight/stale/supersede/monthly cap/approve/reject/imageSource/admin limit (T4), error codes + i18n (T5), in-place panel with remaining/limit-off/failure (T6), staff badge + diner card hint + detail line (T7), admin dialog (T8), real run + cap check (T9), purge (T1), glossary (T1), analytics — recorded by the tables' design, no surface (spec: out of scope) ✓.
- **Type consistency:** `startGeneration` returns `{ jobId, attempt, remainingThisMonth }` (T4, mocked in T6 the same way); `ItemGenerationView` fields used by the panel match T4; `MenuAIImageError` names match `BACKEND_ERROR_CODES` (T5) and the test assertions in T4; `TINY_JPEG`/`okImageResponse`/`insertQueuedJob`/`insertJobAndDraft` are defined in T1/T3 before use in T4.
- **Known judgement calls:** the SVG media type is refused (raster only); `output_compression` is sent even though not every provider honours it; `RECENT_FAILURE_MS` = 1 h keeps a failure visible without pinning it forever.
