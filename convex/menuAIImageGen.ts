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
