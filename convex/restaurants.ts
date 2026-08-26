import { v } from "convex/values";
import { internal } from "./_generated/api";
import { normalizeBrandColor } from "./_shared/brandColor";
import { BRANDING_ERROR, resolvePublicBranding, type PublicBranding } from "./brandingHelpers";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalQuery, mutation, query } from "./_generated/server";
import {
	ConflictError,
	ConflictErrorObject,
	NotAuthenticatedErrorObject,
	NotAuthorizedError,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { appendAuditEvent, stampUpdated } from "./_util/audit";
import {
	fetchUserRoleRecordsByUserId,
	getCurrentUserId,
	isAdmin,
	requireOwnerRole,
	requireRestaurantManagerOrAbove,
	requireRestaurantOwnerOrAdmin,
	RoleErrorMessages,
} from "./_util/auth";
import {
	RESTAURANT_MEMBER_ROLE,
	RESTAURANT_SLUG_MAX_COLLISION_ATTEMPTS,
	RESTAURANT_SOFT_DELETE_RETENTION_MS,
	TABLE,
	USER_ROLES,
} from "./constants";
import { insertMenuForRestaurant } from "./menus";
import {
	isValidContactEmail,
	MAX_ADDRESS_LENGTH,
	normalizeRestaurantPhone,
	normalizeSocialUrl,
	PUBLIC_PROFILE_ERROR,
	SOCIAL_FIELD,
	SOCIAL_PLATFORMS,
	toWhatsAppUrl,
	type SocialField,
	type SocialPlatform,
} from "./publicProfileHelpers";
import {
	buildCandidateSlug,
	normalizeRestaurantSlug,
	SLUG_ERROR,
	slugifyRestaurantName,
} from "./slugHelpers";
import { isValidIanaTimezone, resolveRestaurantTimezone } from "./_util/timezone";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

function tombstoneSlug(restaurantId: Id<"restaurants">, slug: string): string {
	const safe = slug.replace(/[^a-zA-Z0-9_-]/g, "_");
	return `${safe}__deleted__${restaurantId}`;
}

/** Field-scoped validation error so the settings form can pin it to the input. */
function slugError(code: string): UserInputValidationErrorObject {
	return new UserInputValidationError({ fields: [{ field: "slug", message: code }] }).toObject();
}

/**
 * Convex has no unique index, so slug uniqueness is a mutation-time rule.
 * A soft-deleted row never counts as an occupant — it has been tombstoned
 * (`slug__deleted__<id>`) and its public address is free to reuse.
 */
async function isSlugFree(
	ctx: QueryCtx,
	slug: string,
	exceptId?: Id<"restaurants">
): Promise<boolean> {
	const existing = await ctx.db
		.query(TABLE.RESTAURANTS)
		.withIndex("by_slug", (q) => q.eq("slug", slug))
		.first();
	if (!existing) return true;
	if (exceptId && existing._id === exceptId) return true;
	return existing.deletedAt != null;
}

/**
 * Resolves the slug a new restaurant is created with.
 *
 * Nothing in the product asks for a slug any more: it is derived from the
 * name and de-duplicated with a dash counter. An explicitly supplied slug is
 * still honoured (API clients, fixtures) but goes through the same
 * normalization, so no un-normalized value can reach the table.
 */
async function resolveCreateSlug(
	ctx: QueryCtx,
	name: string,
	requested: string | undefined
): Promise<[string, null] | [null, UserInputValidationErrorObject]> {
	if (requested !== undefined) {
		const normalized = normalizeRestaurantSlug(requested);
		if (!normalized) return [null, slugError(SLUG_ERROR.INVALID)];
		if (!(await isSlugFree(ctx, normalized))) return [null, slugError(SLUG_ERROR.TAKEN)];
		return [normalized, null];
	}

	const base = slugifyRestaurantName(name);
	for (let attempt = 0; attempt < RESTAURANT_SLUG_MAX_COLLISION_ATTEMPTS; attempt++) {
		const candidate = buildCandidateSlug(base, attempt);
		if (await isSlugFree(ctx, candidate)) return [candidate, null];
	}
	// Every candidate up to the bound is occupied — report it as "taken", which
	// is exactly what the operator needs to hear: pick a different name.
	return [null, slugError(SLUG_ERROR.TAKEN)];
}

/** The diner-visible contact details of a restaurant. Every part is optional. */
export type PublicContact = {
	email?: string;
	phone?: string;
	/** Ready-to-use `wa.me` link, derived from `phone`. Absent unless flagged. */
	whatsAppUrl?: string;
	address?: string;
	socials?: Partial<Record<SocialPlatform, string>>;
};

/** Fields safe to expose to anonymous diners (ordering / public reservation pages). */
export type PublicRestaurant = {
	_id: Id<"restaurants">;
	name: string;
	slug: string;
	description?: string;
	currency: string;
	timezone?: string;
	openTime?: string;
	closeTime?: string;
	defaultLanguage?: string;
	supportedLanguages?: string[];
	isActive: boolean;
	// Geofence for ordering (TAVLI-6). Coordinates are public information;
	// the bypass code is intentionally NOT exposed here.
	latitude?: number;
	longitude?: number;
	geofenceRadiusMeters?: number;
	/** Public profile. Absent entirely when the restaurant has published nothing. */
	contact?: PublicContact;
	/**
	 * Visual identity (TAVLI-88). Absent entirely when the restaurant has set
	 * nothing, so the SSR emitter can skip its `<style>` and the header renders
	 * the name rather than an empty logo slot.
	 *
	 * Only populated by the async `getBySlug` path — resolving it costs storage
	 * URL lookups, and `toPublicRestaurant` is also called from synchronous
	 * contexts that have no use for the images.
	 */
	branding?: PublicBranding;
};

/**
 * Build the diner-visible contact block, or `undefined` when there is nothing
 * to show — the info block renders nothing rather than an empty shell.
 *
 * `supportEmail` is gated on `publicProfileReviewedAt`: it predates the public
 * profile and older rows may hold an internal alias. See the schema comment.
 */
function toPublicContact(r: Doc<"restaurants">): PublicContact | undefined {
	const socials: Partial<Record<SocialPlatform, string>> = {};
	for (const platform of SOCIAL_PLATFORMS) {
		const url = r[SOCIAL_FIELD[platform]];
		if (url) socials[platform] = url;
	}
	const hasSocials = Object.keys(socials).length > 0;

	const email = r.publicProfileReviewedAt != null ? r.supportEmail : undefined;
	const whatsAppUrl =
		r.phone && r.phoneHasWhatsApp ? (toWhatsAppUrl(r.phone) ?? undefined) : undefined;

	if (!email && !r.phone && !r.address && !hasSocials) return undefined;

	return {
		...(email && { email }),
		...(r.phone && { phone: r.phone }),
		...(whatsAppUrl && { whatsAppUrl }),
		...(r.address && { address: r.address }),
		...(hasSocials && { socials }),
	};
}

export function toPublicRestaurant(r: Doc<"restaurants">): PublicRestaurant {
	return {
		_id: r._id,
		name: r.name,
		slug: r.slug,
		description: r.description,
		currency: r.currency,
		timezone: r.timezone,
		openTime: r.openTime,
		closeTime: r.closeTime,
		defaultLanguage: r.defaultLanguage,
		supportedLanguages: r.supportedLanguages,
		isActive: r.isActive,
		latitude: r.latitude,
		longitude: r.longitude,
		geofenceRadiusMeters: r.geofenceRadiusMeters,
		contact: toPublicContact(r),
	};
}

/** Clerk JWT `sub` for a user — prefix `user_` plus base62 id (see Clerk user id format). */
const CLERK_USER_SUBJECT_PATTERN = /^user_[a-zA-Z0-9]{20,64}$/;

function validateSharedEmployeeClerkSubject(
	clerkSubject: string
): UserInputValidationErrorObject | null {
	const trimmed = clerkSubject.trim();
	if (!trimmed || !CLERK_USER_SUBJECT_PATTERN.test(trimmed)) {
		return new UserInputValidationError({
			fields: [{ field: "clerkSubject", message: "ERROR_INVALID_SHARED_EMPLOYEE_CLERK_SUBJECT" }],
		}).toObject();
	}
	return null;
}

export const softDelete = mutation({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<null, AuthErrors | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return [null, new NotFoundError("Restaurant not found").toObject()];
		if (restaurant.deletedAt != null) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "restaurantId", message: "Restaurant is already deleted" }],
				}).toObject(),
			];
		}

		const [, permErr] = await requireRestaurantOwnerOrAdmin(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		const now = Date.now();
		const newSlug = tombstoneSlug(args.restaurantId, restaurant.slug);

		await ctx.db.patch(args.restaurantId, {
			deletedAt: now,
			deletedBy: userId,
			hardDeleteAfterAt: now + RESTAURANT_SOFT_DELETE_RETENTION_MS,
			slugBeforeSoftDelete: restaurant.slug,
			slug: newSlug,
			isActive: false,
			stripeAccountId: undefined,
			stripeOnboardingComplete: undefined,
			...stampUpdated(userId),
		});

		// Stop Tavli billing a restaurant the operator just deleted. Mutations
		// never call Stripe, so the cancel runs as a scheduled action; it is
		// best-effort by design (see
		// `billing.cancelSubscriptionForDeletedRestaurant`). Without this the
		// subscription stayed live while `billingHelpers.isBillable` refused to
		// record any of its webhooks — invisible charges.
		if (restaurant.stripeSubscriptionId) {
			await ctx.scheduler.runAfter(0, internal.billing.cancelSubscriptionForDeletedRestaurant, {
				restaurantId: args.restaurantId,
				stripeSubscriptionId: restaurant.stripeSubscriptionId,
				userId,
			});
		}

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANTS,
			aggregateId: String(args.restaurantId),
			eventType: "restaurants.soft_deleted",
			restaurantId: args.restaurantId,
			payload: { slugBefore: restaurant.slug, slugAfter: newSlug },
			userId,
		});

		return [null, null];
	},
});

export const restore = mutation({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<null, AuthErrors | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return [null, new NotFoundError("Restaurant not found").toObject()];
		if (restaurant.deletedAt == null) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "restaurantId", message: "Restaurant is not deleted" }],
				}).toObject(),
			];
		}

		const [, permErr] = await requireRestaurantOwnerOrAdmin(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		const previous = restaurant.slugBeforeSoftDelete ?? restaurant.slug;
		let nextSlug = restaurant.slug;
		if (previous && previous !== restaurant.slug) {
			const occupant = await ctx.db
				.query(TABLE.RESTAURANTS)
				.withIndex("by_slug", (q) => q.eq("slug", previous))
				.first();
			if (!occupant || occupant._id === args.restaurantId) {
				nextSlug = previous;
			}
		}

		await ctx.db.patch(args.restaurantId, {
			deletedAt: undefined,
			deletedBy: undefined,
			hardDeleteAfterAt: undefined,
			slugBeforeSoftDelete: undefined,
			slug: nextSlug,
			...stampUpdated(userId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANTS,
			aggregateId: String(args.restaurantId),
			eventType: "restaurants.restored",
			restaurantId: args.restaurantId,
			payload: { slug: nextSlug },
			userId,
		});

		return [null, null];
	},
});

export const create = mutation({
	args: {
		name: v.string(),
		/**
		 * Optional since TAVLI-71: the create form no longer asks for a slug —
		 * it is derived from `name` and de-duplicated (`la-cocina`,
		 * `la-cocina-2`, …). Still accepted for API callers and fixtures, and
		 * normalized through the same rules when supplied.
		 */
		slug: v.optional(v.string()),
		description: v.optional(v.string()),
		currency: v.string(),
		timezone: v.optional(v.string()),
		organizationId: v.id(TABLE.ORGANIZATIONS),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"restaurants">, AuthErrors | UserInputValidationErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

		const [slug, slugErr] = await resolveCreateSlug(ctx, args.name, args.slug);
		if (slugErr) return [null, slugErr];

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.RESTAURANTS, {
			ownerId: userId,
			organizationId: args.organizationId,
			name: args.name,
			slug,
			description: args.description,
			currency: args.currency,
			timezone: resolveRestaurantTimezone(args.timezone),
			isActive: false,
			createdAt: now,
			updatedAt: now,
			updatedBy: userId,
		});

		// Named after the restaurant, not the slug: a derived slug carries the
		// collision counter, and "La Cocina" must not seed a menu called
		// "la-cocina-2".
		await insertMenuForRestaurant(ctx, {
			restaurantId: id,
			name: args.name,
			userId,
		});

		return [id, null];
	},
});

export const update = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.optional(v.string()),
		slug: v.optional(v.string()),
		description: v.optional(v.string()),
		currency: v.optional(v.string()),
		supportEmail: v.optional(v.string()),
		// Informational tax block for restaurant-branded receipts (ADR 008 /
		// TAVLI-71 Phase 3C). NOT CFDI data — display-only on receipt emails.
		// Same access tier as supportEmail (manager or above); empty string clears.
		rfc: v.optional(v.string()),
		razonSocial: v.optional(v.string()),
		fiscalAddress: v.optional(v.string()),
		// Public profile (diner-visible contact details). Empty string clears —
		// the section form resubmits every input it owns, so an emptied box
		// arrives as "" naturally, and none of these can legitimately BE "".
		address: v.optional(v.string()),
		phone: v.optional(v.string()),
		phoneHasWhatsApp: v.optional(v.boolean()),
		instagramUrl: v.optional(v.string()),
		facebookUrl: v.optional(v.string()),
		tiktokUrl: v.optional(v.string()),
		xUrl: v.optional(v.string()),
		youtubeUrl: v.optional(v.string()),
		/**
		 * Set by the Public profile section on save. Stamps
		 * `publicProfileReviewedAt`, which is what lets `supportEmail` reach
		 * diners. Never unset — reviewing is one-way.
		 */
		markPublicProfileReviewed: v.optional(v.boolean()),
		timezone: v.optional(v.string()),
		openTime: v.optional(v.string()),
		closeTime: v.optional(v.string()),
		defaultLanguage: v.optional(v.string()),
		supportedLanguages: v.optional(v.array(v.string())),
		orderDayStartMinutesFromMidnight: v.optional(v.number()),
		orderNumberResetFrequency: v.optional(
			v.union(v.literal("daily"), v.literal("weekly"), v.literal("biweekly"), v.literal("monthly"))
		),
		/**
		 * Cash policy (TAVLI-81). Manager-or-above like the rest of this form —
		 * deliberately NOT admin-gated the way `orderNumberResetFrequency` is:
		 * this is the restaurant's own call about whether it trusts its tables,
		 * and it is the whole point of the setting that the people running the
		 * floor can flip it.
		 */
		releaseCashOrdersImmediately: v.optional(v.boolean()),
		// Geofence for customer ordering (TAVLI-6). Pass null to clear.
		latitude: v.optional(v.union(v.number(), v.null())),
		longitude: v.optional(v.union(v.number(), v.null())),
		geofenceRadiusMeters: v.optional(v.union(v.number(), v.null())),
		geofenceBypassCode: v.optional(v.union(v.string(), v.null())),
		// ── Branding (TAVLI-88). Colour and font only, and that boundary is
		//    load-bearing: images never travel through this mutation. They go
		//    bytes-through-`setBrandingImage`, which authorizes before it touches
		//    the bytes and validates magic bytes server-side. Accepting an
		//    `Id<"_storage">` here would recreate the cross-tenant blob-delete
		//    primitive TAVLI-68 documents on `menuItems` — a caller could point a
		//    restaurant they manage at another tenant's blob and have the replace
		//    path delete it. `restaurants.update.test.ts` asserts this statically.
		//
		//    `null` clears; `undefined` leaves untouched. Unlike the public-profile
		//    fields above, empty string is NOT the clear signal — a colour input
		//    that is mid-edit legitimately reads "" and must not wipe the stored
		//    brand on an autosave.
		brandingColor: v.optional(v.union(v.string(), v.null())),
		brandingFontId: v.optional(
			v.union(v.literal("inter"), v.literal("fraunces"), v.literal("spaceGrotesk"), v.null())
		),
		organizationId: v.id(TABLE.ORGANIZATIONS),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<
		Id<"restaurants">,
		AuthErrors | NotFoundErrorObject | UserInputValidationErrorObject
	> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return [null, new NotFoundError("Restaurant not found").toObject()];
		if (restaurant.deletedAt != null) {
			return [null, new NotFoundError("Restaurant not found").toObject()];
		}

		const [, permErr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		if (
			args.organizationId !== undefined &&
			args.organizationId !== restaurant.organizationId &&
			!(await isAdmin(ctx, userId))
		) {
			return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
		}

		// orderNumberResetFrequency is an internal experiment knob — only platform
		// admins may flip it while we're still gathering client feedback on the
		// right cadence. Owners/managers can keep using the rest of the form.
		if (
			args.orderNumberResetFrequency !== undefined &&
			args.orderNumberResetFrequency !== restaurant.orderNumberResetFrequency &&
			!(await isAdmin(ctx, userId))
		) {
			return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
		}

		if (
			args.orderDayStartMinutesFromMidnight !== undefined &&
			(args.orderDayStartMinutesFromMidnight < 0 || args.orderDayStartMinutesFromMidnight > 1439)
		) {
			return [
				null,
				new UserInputValidationError({
					fields: [
						{
							field: "orderDayStartMinutesFromMidnight",
							message: "Order day start must be between 0 and 1439 minutes from midnight",
						},
					],
				}).toObject(),
			];
		}

		// Normalize BEFORE deciding anything: the previous version guarded the
		// conflict check with `args.slug &&` but patched on `!== undefined`, so
		// an empty string skipped the check and was written verbatim, leaving a
		// restaurant reachable at `/r//en/menu`.
		let nextSlug: string | undefined;
		if (args.slug !== undefined) {
			const normalized = normalizeRestaurantSlug(args.slug);
			if (!normalized) return [null, slugError(SLUG_ERROR.INVALID)];
			if (
				normalized !== restaurant.slug &&
				!(await isSlugFree(ctx, normalized, args.restaurantId))
			) {
				return [null, slugError(SLUG_ERROR.TAKEN)];
			}
			nextSlug = normalized;
		}

		if (args.timezone !== undefined) {
			const raw = args.timezone.trim();
			if (raw.length > 0 && !isValidIanaTimezone(raw)) {
				return [
					null,
					new UserInputValidationError({
						fields: [{ field: "timezone", message: "Invalid timezone identifier" }],
					}).toObject(),
				];
			}
		}

		if (args.supportEmail !== undefined) {
			const raw = args.supportEmail.trim();
			// Lightweight shape check — this value feeds a `mailto:` on the client
			// and, once the profile is reviewed, on the public menu page.
			if (raw.length > 0 && !isValidContactEmail(raw)) {
				return [
					null,
					new UserInputValidationError({
						fields: [
							{ field: "supportEmail", message: PUBLIC_PROFILE_ERROR.SUPPORT_EMAIL_INVALID },
						],
					}).toObject(),
				];
			}
		}

		if (args.address !== undefined && args.address.trim().length > MAX_ADDRESS_LENGTH) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "address", message: PUBLIC_PROFILE_ERROR.ADDRESS_TOO_LONG }],
				}).toObject(),
			];
		}

		let nextPhone: string | undefined;
		if (args.phone !== undefined) {
			const result = normalizeRestaurantPhone(args.phone);
			if (!result.ok) {
				return [
					null,
					new UserInputValidationError({
						fields: [{ field: "phone", message: result.code }],
					}).toObject(),
				];
			}
			nextPhone = result.value;
		}

		// A WhatsApp flag with no number is a link to nowhere. Resolve against the
		// phone this patch *lands on*, not the one currently stored.
		const phoneAfterPatch = nextPhone !== undefined ? nextPhone : (restaurant.phone ?? "");
		if (args.phoneHasWhatsApp === true && phoneAfterPatch.length === 0) {
			return [
				null,
				new UserInputValidationError({
					fields: [
						{ field: "phoneHasWhatsApp", message: PUBLIC_PROFILE_ERROR.WHATSAPP_WITHOUT_PHONE },
					],
				}).toObject(),
			];
		}

		const nextSocials: Partial<Record<SocialField, string | undefined>> = {};
		for (const platform of SOCIAL_PLATFORMS) {
			const field = SOCIAL_FIELD[platform];
			const raw = args[field];
			if (raw === undefined) continue;
			const result = normalizeSocialUrl(platform, raw);
			if (!result.ok) {
				return [
					null,
					new UserInputValidationError({
						fields: [{ field, message: result.code }],
					}).toObject(),
				];
			}
			nextSocials[field] = result.value.length > 0 ? result.value : undefined;
		}

		if (
			(args.latitude != null && (args.latitude < -90 || args.latitude > 90)) ||
			(args.longitude != null && (args.longitude < -180 || args.longitude > 180))
		) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "latitude", message: "Invalid coordinates" }],
				}).toObject(),
			];
		}
		if (args.geofenceRadiusMeters != null && args.geofenceRadiusMeters <= 0) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "geofenceRadiusMeters", message: "Geofence radius must be positive" }],
				}).toObject(),
			];
		}

		// Normalize the brand colour here rather than at read time. It is
		// interpolated into an SSR'd `<style>` on an anonymous page, so storage
		// must be canonical — a value that reaches the emitter unvalidated is a
		// CSS injection with a restaurant manager holding the pen.
		let nextBrandingColor: string | null | undefined;
		if (args.brandingColor !== undefined) {
			if (args.brandingColor === null) {
				nextBrandingColor = null;
			} else {
				const normalized = normalizeBrandColor(args.brandingColor);
				if (normalized === null) {
					return [
						null,
						new UserInputValidationError({
							fields: [{ field: "brandingColor", message: BRANDING_ERROR.COLOR_INVALID }],
						}).toObject(),
					];
				}
				nextBrandingColor = normalized;
			}
		}

		await ctx.db.patch(args.restaurantId, {
			...(args.name !== undefined && { name: args.name }),
			...(nextSlug !== undefined && { slug: nextSlug }),
			...(args.description !== undefined && { description: args.description }),
			...(args.currency !== undefined && { currency: args.currency }),
			...(args.supportEmail !== undefined && {
				supportEmail: args.supportEmail.trim() ? args.supportEmail.trim() : undefined,
			}),
			...(args.rfc !== undefined && {
				rfc: args.rfc.trim() ? args.rfc.trim() : undefined,
			}),
			...(args.razonSocial !== undefined && {
				razonSocial: args.razonSocial.trim() ? args.razonSocial.trim() : undefined,
			}),
			...(args.fiscalAddress !== undefined && {
				fiscalAddress: args.fiscalAddress.trim() ? args.fiscalAddress.trim() : undefined,
			}),
			...(args.address !== undefined && {
				address: args.address.trim() ? args.address.trim() : undefined,
			}),
			...(nextPhone !== undefined && { phone: nextPhone || undefined }),
			// Clearing the number force-clears the flag. Otherwise a manager who
			// deletes their phone leaves a dangling `true` that a later "add a
			// phone" silently re-arms — for a number that may not be on WhatsApp.
			...(nextPhone !== undefined && nextPhone.length === 0
				? { phoneHasWhatsApp: undefined }
				: args.phoneHasWhatsApp !== undefined && {
						phoneHasWhatsApp: args.phoneHasWhatsApp || undefined,
					}),
			// Explicit per-field spreads rather than a computed object: this keeps
			// `ctx.db.patch`'s per-field type checking, which `Object.fromEntries`
			// would erase while still compiling. A normalized empty string means
			// "clear", which is already `undefined` in `nextSocials`.
			...(args.instagramUrl !== undefined && { instagramUrl: nextSocials.instagramUrl }),
			...(args.facebookUrl !== undefined && { facebookUrl: nextSocials.facebookUrl }),
			...(args.tiktokUrl !== undefined && { tiktokUrl: nextSocials.tiktokUrl }),
			...(args.xUrl !== undefined && { xUrl: nextSocials.xUrl }),
			...(args.youtubeUrl !== undefined && { youtubeUrl: nextSocials.youtubeUrl }),
			...(args.markPublicProfileReviewed === true &&
				restaurant.publicProfileReviewedAt == null && { publicProfileReviewedAt: Date.now() }),
			...(args.timezone !== undefined && {
				timezone: args.timezone.trim() ? args.timezone.trim() : undefined,
			}),
			...(args.openTime !== undefined && { openTime: args.openTime }),
			...(args.closeTime !== undefined && { closeTime: args.closeTime }),
			...(args.defaultLanguage !== undefined && { defaultLanguage: args.defaultLanguage }),
			...(args.supportedLanguages !== undefined && { supportedLanguages: args.supportedLanguages }),
			...(args.orderDayStartMinutesFromMidnight !== undefined && {
				orderDayStartMinutesFromMidnight: args.orderDayStartMinutesFromMidnight,
			}),
			...(args.orderNumberResetFrequency !== undefined && {
				orderNumberResetFrequency: args.orderNumberResetFrequency,
			}),
			...(args.releaseCashOrdersImmediately !== undefined && {
				releaseCashOrdersImmediately: args.releaseCashOrdersImmediately,
			}),
			...(args.latitude !== undefined && { latitude: args.latitude ?? undefined }),
			...(args.longitude !== undefined && { longitude: args.longitude ?? undefined }),
			...(args.geofenceRadiusMeters !== undefined && {
				geofenceRadiusMeters: args.geofenceRadiusMeters ?? undefined,
			}),
			...(nextBrandingColor !== undefined && {
				brandingColor: nextBrandingColor ?? undefined,
			}),
			...(args.brandingFontId !== undefined && {
				brandingFontId: args.brandingFontId ?? undefined,
			}),
			...(args.geofenceBypassCode !== undefined && {
				geofenceBypassCode: args.geofenceBypassCode?.trim()
					? args.geofenceBypassCode.trim().toUpperCase()
					: undefined,
			}),
			...(args.organizationId !== undefined && { organizationId: args.organizationId }),
			...stampUpdated(userId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANTS,
			aggregateId: String(args.restaurantId),
			eventType: "restaurants.updated",
			restaurantId: args.restaurantId,
			// Record what was written, not what was typed — the slug is normalized.
			payload: { ...args, ...(nextSlug !== undefined && { slug: nextSlug }) },
			userId,
		});

		return [args.restaurantId, null];
	},
});

export const toggleActive = mutation({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (ctx, args): AsyncReturn<boolean, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return [null, new NotFoundError("Restaurant not found").toObject()];
		if (restaurant.deletedAt != null) {
			return [null, new NotFoundError("Restaurant not found").toObject()];
		}

		const [, permErr] = await requireRestaurantOwnerOrAdmin(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		const newState = !restaurant.isActive;
		await ctx.db.patch(args.restaurantId, { isActive: newState, ...stampUpdated(userId) });
		return [newState, null];
	},
});

export const getByOwner = query({
	handler: async function (ctx): AsyncReturn<Doc<"restaurants">[], AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const restaurants = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_owner", (q) => q.eq("ownerId", userId))
			.collect();

		return [restaurants.filter((r) => r.deletedAt == null), null];
	},
});

export const getPaymentsEnabled = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant || restaurant.deletedAt != null) return false;
		return restaurant.isActive === true && restaurant.stripeOnboardingComplete === true;
	},
});

export const getManageableForStripe = query({
	handler: async function (ctx): AsyncReturn<Doc<"restaurants">[], AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const userIsAdmin = await isAdmin(ctx, userId);
		if (userIsAdmin) {
			const all = await ctx.db.query(TABLE.RESTAURANTS).collect();
			return [all.filter((r) => r.deletedAt == null), null];
		}

		const ownedRestaurants = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_owner", (q) => q.eq("ownerId", userId))
			.collect();
		return [ownedRestaurants.filter((r) => r.deletedAt == null), null];
	},
});

/**
 * The diner-facing restaurant record, branding included.
 *
 * Branding is composed in here rather than exposed as its own query on
 * purpose: the SSR loader on `/r/$slug` awaits this before first byte, and a
 * second query would put a second Convex round-trip on the TTFB critical path
 * of every customer page.
 */
export const getBySlug = query({
	args: { slug: v.string() },
	handler: async (ctx, args): Promise<PublicRestaurant | null> => {
		const r = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_slug", (q) => q.eq("slug", args.slug))
			.first();
		if (!r || r.deletedAt != null) return null;
		const branding = await resolvePublicBranding(ctx.storage, r);
		return { ...toPublicRestaurant(r), ...(branding !== undefined && { branding }) };
	},
});

/**
 * Checks a staff-shared geofence bypass code (TAVLI-6). Customers whose
 * browser location is denied/unavailable can enter this code to unlock
 * ordering. The geofence is a soft UX gate, so a boolean check is enough.
 */
export const verifyGeofenceBypass = query({
	args: { slug: v.string(), code: v.string() },
	returns: v.boolean(),
	handler: async (ctx, args): Promise<boolean> => {
		const r = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_slug", (q) => q.eq("slug", args.slug))
			.first();
		if (!r || r.deletedAt != null || !r.geofenceBypassCode) return false;
		return args.code.trim().toUpperCase() === r.geofenceBypassCode;
	},
});

export const getStripeStatus = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<
		{ stripeAccountId: string | undefined; stripeOnboardingComplete: boolean },
		AuthErrors | NotFoundErrorObject
	> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant || restaurant.deletedAt != null) {
			return [null, new NotFoundError("Restaurant not found").toObject()];
		}

		const [, permErr] = await requireRestaurantOwnerOrAdmin(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		return [
			{
				stripeAccountId: restaurant.stripeAccountId,
				stripeOnboardingComplete: restaurant.stripeOnboardingComplete ?? false,
			},
			null,
		];
	},
});

/** Stable ordering for admin lists and client fallbacks: newest activity first. */
function sortRestaurantsForAdminList(restaurants: Doc<"restaurants">[]): Doc<"restaurants">[] {
	return [...restaurants].sort((a, b) => {
		if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
		return b._creationTime - a._creationTime;
	});
}

/**
 * Restaurants the user may use in admin (switcher, scoped queries): owned venues,
 * org-level owner expansion, and active restaurant member assignments.
 */
async function collectAccessibleRestaurantsForAdmin(
	ctx: QueryCtx,
	userId: string
): Promise<Doc<"restaurants">[]> {
	const seen = new Set<Id<"restaurants">>();
	const out: Doc<"restaurants">[] = [];

	const push = (r: Doc<"restaurants"> | null) => {
		if (!r || r.deletedAt != null || seen.has(r._id)) return;
		seen.add(r._id);
		out.push(r);
	};

	const owned = await ctx.db
		.query(TABLE.RESTAURANTS)
		.withIndex("by_owner", (q) => q.eq("ownerId", userId))
		.collect();
	for (const r of owned) push(r);

	const userRoleRows = await fetchUserRoleRecordsByUserId(ctx, userId);
	for (const row of userRoleRows) {
		const roles = row.roles ?? [];
		if (!roles.includes(USER_ROLES.OWNER) || !row.organizationId) continue;
		const orgId = row.organizationId as Id<"organizations">;
		const orgRestaurants = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_organization", (q) => q.eq("organizationId", orgId))
			.collect();
		for (const r of orgRestaurants) push(r);
	}

	const memberRows = await ctx.db
		.query(TABLE.RESTAURANT_MEMBERS)
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.collect();

	for (const m of memberRows) {
		if (!m.isActive) continue;
		if (m.role !== RESTAURANT_MEMBER_ROLE.MANAGER && m.role !== RESTAURANT_MEMBER_ROLE.EMPLOYEE) {
			continue;
		}
		const r = await ctx.db.get(m.restaurantId);
		push(r);
	}

	return sortRestaurantsForAdminList(out);
}

/**
 * Soft-deleted restaurants the user may restore (admin, document owner, or org-level owner).
 * Excludes restaurant-scoped managers/employees.
 */
async function collectSoftDeletedForOwnerOrAdmin(
	ctx: QueryCtx,
	userId: string
): Promise<Doc<"restaurants">[]> {
	const seen = new Set<Id<"restaurants">>();
	const out: Doc<"restaurants">[] = [];

	const push = (r: Doc<"restaurants"> | null) => {
		if (!r || r.deletedAt == null || seen.has(r._id)) return;
		seen.add(r._id);
		out.push(r);
	};

	const owned = await ctx.db
		.query(TABLE.RESTAURANTS)
		.withIndex("by_owner", (q) => q.eq("ownerId", userId))
		.collect();
	for (const r of owned) push(r);

	const userRoleRows = await fetchUserRoleRecordsByUserId(ctx, userId);
	for (const row of userRoleRows) {
		const roles = row.roles ?? [];
		if (!roles.includes(USER_ROLES.OWNER) || !row.organizationId) continue;
		const orgId = row.organizationId as Id<"organizations">;
		const orgRestaurants = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_organization", (q) => q.eq("organizationId", orgId))
			.collect();
		for (const r of orgRestaurants) push(r);
	}

	return sortRestaurantsForAdminList(out);
}

export const getAll = query({
	handler: async function (ctx): AsyncReturn<Doc<"restaurants">[], AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const userIsAdmin = await isAdmin(ctx, userId);
		if (userIsAdmin) {
			const all = await ctx.db.query(TABLE.RESTAURANTS).collect();
			const active = all.filter((r) => r.deletedAt == null);
			return [sortRestaurantsForAdminList(active), null];
		}

		const list = await collectAccessibleRestaurantsForAdmin(ctx, userId);
		return [list, null];
	},
});

export const getDeletedForAdmin = query({
	handler: async function (ctx): AsyncReturn<Doc<"restaurants">[], AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const userIsAdmin = await isAdmin(ctx, userId);
		if (userIsAdmin) {
			const all = await ctx.db.query(TABLE.RESTAURANTS).collect();
			const deleted = all.filter((r) => r.deletedAt != null);
			return [sortRestaurantsForAdminList(deleted), null];
		}

		const list = await collectSoftDeletedForOwnerOrAdmin(ctx, userId);
		return [list, null];
	},
});

/**
 * Internal helper for export actions: returns the minimal restaurant fields
 * the action needs (slug for filename, timezone for bucketing, currency for
 * column labels, createdAt for the year picker), with the same owner /
 * manager / admin access check the export actions require.
 */
/**
 * Bind a shared Clerk subject to a restaurant for the employee session.
 * Owner/admin only. The Clerk user is created externally; this mutation
 * stores the binding. See ADR 006.
 */
export const setSharedEmployeeSubject = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		clerkSubject: v.string(),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<
		null,
		AuthErrors | NotFoundErrorObject | UserInputValidationErrorObject | ConflictErrorObject
	> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const validationError = validateSharedEmployeeClerkSubject(args.clerkSubject);
		if (validationError) return [null, validationError];

		const clerkSubject = args.clerkSubject.trim();

		const [, permErr] = await requireRestaurantOwnerOrAdmin(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		const boundElsewhere = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_shared_employee_subject", (q) =>
				q.eq("sharedEmployeeClerkSubject", clerkSubject)
			)
			.first();

		if (boundElsewhere && boundElsewhere._id !== args.restaurantId) {
			return [null, new ConflictError("ERROR_SHARED_EMPLOYEE_SUBJECT_ALREADY_BOUND").toObject()];
		}

		await ctx.db.patch(args.restaurantId, {
			sharedEmployeeClerkSubject: clerkSubject,
			...stampUpdated(userId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANTS,
			aggregateId: String(args.restaurantId),
			eventType: "restaurants.sharedEmployeeSubjectSet",
			restaurantId: args.restaurantId,
			payload: { clerkSubject },
			userId,
		});

		return [null, null];
	},
});

export const getRestaurantForExport = internalQuery({
	args: {
		actingUserId: v.string(),
		restaurantId: v.id(TABLE.RESTAURANTS),
	},
	handler: async (ctx, args) => {
		const [restaurant, aerr] = await requireRestaurantManagerOrAbove(
			ctx,
			args.actingUserId,
			args.restaurantId
		);
		if (aerr) throw new Error("Unauthorized");
		return {
			id: restaurant._id as string,
			slug: restaurant.slug,
			name: restaurant.name,
			timezone: restaurant.timezone,
			currency: restaurant.currency,
			createdAt: restaurant.createdAt,
		};
	},
});
