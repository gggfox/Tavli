/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _seed_referenceData from "../_seed/referenceData.js";
import type * as _util_auth from "../_util/auth.js";
import type * as _util_idempotency from "../_util/idempotency.js";
import type * as admin from "../admin.js";
import type * as auctions from "../auctions.js";
import type * as constants from "../constants.js";
import type * as featureFlags from "../featureFlags.js";
import type * as materials from "../materials.js";
import type * as tasks from "../tasks.js";
import type * as userSettings from "../userSettings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_seed/referenceData": typeof _seed_referenceData;
  "_util/auth": typeof _util_auth;
  "_util/idempotency": typeof _util_idempotency;
  admin: typeof admin;
  auctions: typeof auctions;
  constants: typeof constants;
  featureFlags: typeof featureFlags;
  materials: typeof materials;
  tasks: typeof tasks;
  userSettings: typeof userSettings;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
