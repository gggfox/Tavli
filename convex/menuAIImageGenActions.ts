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
		if (!context) {
			// Not runnable: either already terminal (markJobFailed below is then a
			// no-op) or an orphan whose item/category/restaurant is gone — in the
			// latter case this is what actually terminates it, instead of leaving
			// a queued/running job to dangle forever and keep consuming a unit of
			// the organization's monthly cap.
			await ctx.runMutation(internal.menuAIImageGen.markJobFailed, {
				jobId,
				error: MENU_AI_IMAGE_FAILURE.ITEM_MISSING,
			});
			return null;
		}
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
		//
		// `decodeImageResponse` types its output as a bare `Uint8Array`, which
		// this TypeScript/lib version widens to `Uint8Array<ArrayBufferLike>`
		// (it could in principle back onto a `SharedArrayBuffer`). `BlobPart`
		// requires the narrower `Uint8Array<ArrayBuffer>`; the decoder always
		// builds the bytes with `Uint8Array.from`, which never uses a
		// `SharedArrayBuffer`, so this assertion just tells the compiler what
		// is already true at runtime.
		const storageId = await ctx.storage.store(
			new Blob([decoded.image.bytes as Uint8Array<ArrayBuffer>], {
				type: decoded.image.mediaType,
			})
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
