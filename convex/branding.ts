/**
 * Branding image upload and retrieval (TAVLI-96, ADR 009).
 *
 * The bytes travel **through** this module. The client never generates an
 * upload URL and never hands back a `storageId`.
 *
 * That shape is not caution, it is the fix for a specific primitive. In the
 * `generateUploadUrl` pattern the client uploads directly and returns an id
 * that the server then trusts. A caller who legitimately manages restaurant A
 * can return an id belonging to restaurant B, and the replace path — which
 * deletes the blob it is superseding — deletes B's file. Nothing distinguishes
 * that call from an honest one, because the id is the only evidence and it is
 * the attacker's to choose (TAVLI-68 documents this on `menuItems`).
 *
 * Routing bytes through an action costs a hop and buys three properties:
 * authorization happens before anything is stored, the server sees the actual
 * bytes and can refuse them, and the `storageId` is the server's own.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import {
	NotAuthenticatedError,
	NotAuthorizedError,
	NotFoundError,
	UserInputValidationError,
} from "./_shared/errors";
import { appendAuditEvent } from "./_util/audit";
import { getCurrentUserId, requireRestaurantManagerOrAbove } from "./_util/auth";
import { BRANDING_ERROR } from "./brandingHelpers";
import {
	BRANDING_IMAGE_SLOTS,
	BRANDING_SLOT_SPECS,
	CONTENT_TYPE,
	checkBrandingImage,
	type BrandingImageRejection,
	type BrandingImageSlot,
} from "./brandingImageHelpers";
import { TABLE } from "./constants";

const SLOT_VALIDATOR = v.union(
	v.literal("logo"),
	v.literal("headerDesktop"),
	v.literal("headerTablet"),
	v.literal("headerPhone")
);

/** Map a rejection to the stable code the frontend turns into an i18n key. */
function rejectionCode(rejection: BrandingImageRejection): string {
	switch (rejection.reason) {
		case "tooLarge":
			return BRANDING_ERROR.IMAGE_TOO_LARGE;
		case "wrongFormat":
			return BRANDING_ERROR.IMAGE_TYPE_INVALID;
		case "unreadableDimensions":
		case "wrongDimensions":
			return BRANDING_ERROR.IMAGE_DIMENSIONS_INVALID;
	}
}

// ============================================================================
// Internal: authorization and the transactional swap
// ============================================================================

/**
 * Authorize the caller for this restaurant, **before** the action touches the
 * uploaded bytes.
 *
 * The ordering is the point. Validating first and authorizing second would
 * turn this endpoint into an oracle: a caller with no rights over any
 * restaurant could learn whether a file passes our checks, and — worse — a
 * naive implementation would already have called `ctx.storage.store()` by the
 * time it discovered the caller had no business here, leaking a blob per
 * probe with no row to ever clean it up.
 */
export const authorizeBrandingUpload = internalQuery({
	args: { restaurantId: v.id(TABLE.RESTAURANTS), userId: v.string() },
	returns: v.boolean(),
	handler: async (ctx, args): Promise<boolean> => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant || restaurant.deletedAt != null) return false;
		const [, error] = await requireRestaurantManagerOrAbove(ctx, args.userId, args.restaurantId);
		return error === null;
	},
});

/**
 * Point a slot at its new blob and delete the one it replaces — in one
 * transaction.
 *
 * Both halves must land together. Patching without deleting orphans the old
 * blob forever (nothing else references it, so nothing will ever find it).
 * Deleting without patching leaves the column pointing at a file that no
 * longer exists, which the public resolver would surface as a broken image on
 * a diner's menu. A Convex mutation is atomic, so the pair cannot half-apply.
 *
 * The previous id is re-read from the row here rather than passed in by the
 * action: between the action's read and this write another manager may have
 * uploaded, and deleting the id the action saw would delete a *live* blob
 * while orphaning the one it did not see.
 */
export const commitBrandingImage = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		slot: SLOT_VALIDATOR,
		storageId: v.id("_storage"),
		width: v.number(),
		height: v.number(),
		userId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args): Promise<null> => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) {
			// The restaurant was deleted between authorization and commit. The
			// blob we just stored has no owner, so drop it rather than leak it.
			await ctx.storage.delete(args.storageId);
			throw new NotFoundError("Restaurant not found");
		}

		const columns = BRANDING_SLOT_SPECS[args.slot as BrandingImageSlot].columns;
		const previous = restaurant[columns.storageId as keyof Doc<"restaurants">] as
			| Id<"_storage">
			| undefined;

		await ctx.db.patch(args.restaurantId, {
			[columns.storageId]: args.storageId,
			[columns.width]: args.width,
			[columns.height]: args.height,
			updatedAt: Date.now(),
			updatedBy: args.userId,
		});

		if (previous && previous !== args.storageId) {
			await ctx.storage.delete(previous);
		}

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANTS,
			aggregateId: args.restaurantId,
			eventType: "restaurants.branding_image_set",
			restaurantId: args.restaurantId,
			payload: {
				restaurantId: args.restaurantId,
				slot: args.slot,
				width: args.width,
				height: args.height,
				replacedPrevious: previous !== undefined,
			},
			userId: args.userId,
		});

		return null;
	},
});

/** Clear a slot: drop the column trio and delete the blob, transactionally. */
export const clearBrandingImageInternal = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		slot: SLOT_VALIDATOR,
		userId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args): Promise<null> => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) throw new NotFoundError("Restaurant not found");

		const columns = BRANDING_SLOT_SPECS[args.slot as BrandingImageSlot].columns;
		const previous = restaurant[columns.storageId as keyof Doc<"restaurants">] as
			| Id<"_storage">
			| undefined;
		if (!previous) return null;

		await ctx.db.patch(args.restaurantId, {
			[columns.storageId]: undefined,
			[columns.width]: undefined,
			[columns.height]: undefined,
			updatedAt: Date.now(),
			updatedBy: args.userId,
		});
		await ctx.storage.delete(previous);

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANTS,
			aggregateId: args.restaurantId,
			eventType: "restaurants.branding_image_cleared",
			restaurantId: args.restaurantId,
			payload: { restaurantId: args.restaurantId, slot: args.slot },
			userId: args.userId,
		});

		return null;
	},
});

// ============================================================================
// Public
// ============================================================================

/**
 * Upload one branding image.
 *
 * The order of the steps below is the security property, not an
 * implementation detail:
 *
 *   1. authenticate  — who is calling
 *   2. authorize     — may they touch this restaurant (BEFORE the bytes)
 *   3. byte cap      — a length comparison, so a hostile upload is refused
 *                      without any parser walking into it
 *   4. magic bytes   — what the file *is*, never what it claims to be
 *   5. dimensions    — parsed from the file, so the stored width/height
 *                      actually describe the blob the renderer will fetch
 *   6. store         — only now does a blob exist
 *   7. commit        — patch and delete-previous, atomically
 *
 * Steps 3–5 all run before step 6, so a rejected upload leaves nothing behind.
 */
export const setBrandingImage = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		slot: SLOT_VALIDATOR,
		/** Raw file bytes. Not a `storageId` — see the module note. */
		bytes: v.bytes(),
	},
	returns: v.null(),
	handler: async (ctx, args): Promise<null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new NotAuthenticatedError();
		const userId = identity.subject;

		const authorized = await ctx.runQuery(internal.branding.authorizeBrandingUpload, {
			restaurantId: args.restaurantId,
			userId,
		});
		if (!authorized) throw new NotAuthorizedError("NOT_AUTHORIZED");

		const bytes = new Uint8Array(args.bytes);
		const verdict = checkBrandingImage(bytes, args.slot as BrandingImageSlot);
		if (!verdict.ok) {
			throw new UserInputValidationError({
				fields: [{ field: args.slot, message: rejectionCode(verdict.rejection) }],
			});
		}

		// The content type comes from the sniffed format, never from anything
		// the client said — storing a client-declared type would reintroduce
		// the confusion the magic-byte check just removed.
		const storageId = await ctx.storage.store(
			new Blob([bytes], { type: CONTENT_TYPE[verdict.format] })
		);

		try {
			await ctx.runMutation(internal.branding.commitBrandingImage, {
				restaurantId: args.restaurantId,
				slot: args.slot,
				storageId,
				width: verdict.dimensions.width,
				height: verdict.dimensions.height,
				userId,
			});
		} catch (error) {
			// The blob exists but nothing references it. Actions are not
			// transactional, so without this the failure leaves an orphan that
			// no purge will ever find — there is no row pointing at it.
			await ctx.storage.delete(storageId);
			throw error;
		}

		return null;
	},
});

/** Clear one slot. Manager or above, same gate as setting it. */
export const clearBrandingImage = action({
	args: { restaurantId: v.id(TABLE.RESTAURANTS), slot: SLOT_VALIDATOR },
	returns: v.null(),
	handler: async (ctx, args): Promise<null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new NotAuthenticatedError();

		const authorized = await ctx.runQuery(internal.branding.authorizeBrandingUpload, {
			restaurantId: args.restaurantId,
			userId: identity.subject,
		});
		if (!authorized) throw new NotAuthorizedError("NOT_AUTHORIZED");

		await ctx.runMutation(internal.branding.clearBrandingImageInternal, {
			restaurantId: args.restaurantId,
			slot: args.slot,
			userId: identity.subject,
		});
		return null;
	},
});

/**
 * Resolved branding image URLs for the settings section.
 *
 * Settings is fed a raw `Doc<"restaurants">`, which carries storage *ids* — an
 * id renders nothing in an `<img>`. This is the manager-side counterpart to
 * `resolvePublicBranding`, and unlike that one it is behind the same
 * manager-or-above gate as editing.
 */
export const getBrandingImages = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) throw error;
		const [, permError] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (permError) throw permError;

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) throw new NotFoundError("Restaurant not found");

		const images: Partial<
			Record<BrandingImageSlot, { url: string; width: number; height: number }>
		> = {};

		for (const slot of BRANDING_IMAGE_SLOTS) {
			const columns = BRANDING_SLOT_SPECS[slot].columns;
			const storageId = restaurant[columns.storageId as keyof Doc<"restaurants">] as
				| Id<"_storage">
				| undefined;
			const width = restaurant[columns.width as keyof Doc<"restaurants">] as number | undefined;
			const height = restaurant[columns.height as keyof Doc<"restaurants">] as number | undefined;
			if (!storageId || width === undefined || height === undefined) continue;

			const url = await ctx.storage.getUrl(storageId);
			// A null url means the blob is gone while the column still points at
			// it. Report the slot as empty so the manager can re-upload, rather
			// than rendering a broken image they cannot explain.
			if (url === null) continue;
			images[slot] = { url, width, height };
		}

		return images;
	},
});
