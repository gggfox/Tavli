/**
 * AI menu image generation (workstream B): jobs, drafts, approval.
 *
 * The bytes travel through the action in `menuAIImageGenActions.ts` and are
 * stored server-side (ADR 009): a client never hands back a storage id. A
 * manager approves every image before a diner sees it.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
	ConflictError,
	ConflictErrorObject,
	ERROR_NAMES,
	MenuAIImageError,
	MenuAIImageErrorObject,
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { appendAuditEvent, stampUpdated } from "./_util/audit";
import { getCurrentUserId, requireRestaurantManagerOrAbove } from "./_util/auth";
import {
	MENU_AI_IMAGE_DEFAULT_MODEL,
	MENU_AI_IMAGE_DEFAULT_MONTHLY_LIMIT_PER_ORG,
	MENU_AI_IMAGE_DRAFT_STATUS,
	MENU_AI_IMAGE_FAILURE,
	MENU_AI_IMAGE_JOB_STATUS,
	MENU_AI_IMAGE_STALE_JOB_MS,
	MENU_ITEM_IMAGE_SOURCE,
	TABLE,
} from "./constants";
import {
	buildDishImagePrompt,
	countsTowardMonthlyCap,
	monthStartUtc,
} from "./menuAIImageGenHelpers";

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
	args: {
		jobId: v.id(TABLE.MENU_AI_IMAGE_GEN_JOBS),
		error: v.union(
			v.literal(MENU_AI_IMAGE_FAILURE.CREDITS_EXHAUSTED),
			v.literal(MENU_AI_IMAGE_FAILURE.RATE_LIMITED),
			v.literal(MENU_AI_IMAGE_FAILURE.CONTENT_BLOCKED),
			v.literal(MENU_AI_IMAGE_FAILURE.PROVIDER_ERROR),
			v.literal(MENU_AI_IMAGE_FAILURE.INVALID_RESPONSE),
			v.literal(MENU_AI_IMAGE_FAILURE.TIMEOUT),
			v.literal(MENU_AI_IMAGE_FAILURE.ITEM_MISSING)
		),
	},
	returns: v.null(),
	handler: async (ctx, { jobId, error }) => {
		const job = await ctx.db.get(jobId);
		if (
			!job ||
			(job.status !== MENU_AI_IMAGE_JOB_STATUS.QUEUED &&
				job.status !== MENU_AI_IMAGE_JOB_STATUS.RUNNING)
		) {
			// Never clobber a job that already reached a terminal state (done, or
			// already failed): the action calls this unconditionally when a job
			// turns out not to be runnable, and that must be a no-op there.
			return null;
		}
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
	handler: async (ctx, args): Promise<Id<"menuItemAIImageGenDrafts"> | null> => {
		const job = await ctx.db.get(args.jobId);
		if (!job) {
			// The job vanished (restaurant purged mid-flight). Drop the blob rather
			// than leak it: nothing would ever reference it.
			await ctx.storage.delete(args.storageId);
			throw new Error("Job not found");
		}
		if (
			job.status !== MENU_AI_IMAGE_JOB_STATUS.QUEUED &&
			job.status !== MENU_AI_IMAGE_JOB_STATUS.RUNNING
		) {
			// The job already reached a terminal state while the action was in
			// flight (e.g. stale-job recovery marked it failed on the next
			// `startGeneration` click): the draft would dangle with nothing to
			// review it, so drop the blob and stop, mirroring `markJobFailed`'s
			// own guard.
			await ctx.storage.delete(args.storageId);
			return null;
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

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

// ============================================================================
// Monthly cap
// ============================================================================

export function monthlyLimitFor(org: Doc<"organizations"> | null): number {
	return org?.aiImageMonthlyLimit ?? MENU_AI_IMAGE_DEFAULT_MONTHLY_LIMIT_PER_ORG;
}

/**
 * Jobs that count against this month: `done`; fresh `queued`/`running`
 * (a stale one is dead and must not hold a cap unit forever); `failed` only
 * when the error is `invalid_response` or `timeout`, since the provider may
 * have generated — and billed for — an image in those cases. See
 * `countsTowardMonthlyCap` for the exact rule. Counted from the table rather
 * than a counter so the number can never drift from what was generated; the
 * read is bounded by the cap itself.
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
	return jobs.filter((job) => countsTowardMonthlyCap(job, now)).length;
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
		const jobs = await ctx.db
			.query(TABLE.MENU_AI_IMAGE_GEN_JOBS)
			.withIndex("by_menuItem", (q) => q.eq("menuItemId", menuItemId))
			.collect();
		for (const job of jobs) {
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

		const attempt = jobs.reduce((max, job) => Math.max(max, job.attempt), 0) + 1;
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
			const isRunningOrQueued =
				latest.status === MENU_AI_IMAGE_JOB_STATUS.QUEUED ||
				latest.status === MENU_AI_IMAGE_JOB_STATUS.RUNNING;
			const isStale =
				isRunningOrQueued &&
				now - (latest.startedAt ?? latest.createdAt) >= MENU_AI_IMAGE_STALE_JOB_MS;
			if (isStale) {
				// A queued/running job past the staleness window is dead, but
				// nothing has marked it `failed` yet — that only happens on the
				// next `startGeneration` call. Report it as failed here too, so the
				// panel shows the button (and this failure) instead of a spinner
				// that can never resolve without a click that never becomes
				// possible.
				activeJob = {
					jobId: latest._id,
					status: "failed",
					attempt: latest.attempt,
					error: MENU_AI_IMAGE_FAILURE.TIMEOUT,
				};
			} else if (
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
): Promise<
	| { userId: string; draft: Doc<"menuItemAIImageGenDrafts"> }
	| { error: AuthErrors | NotFoundErrorObject | ConflictErrorObject }
> {
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
