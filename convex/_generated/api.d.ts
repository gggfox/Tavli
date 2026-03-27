/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _shared_errors from "../_shared/errors.js";
import type * as _shared_types from "../_shared/types.js";
import type * as _util_auth from "../_util/auth.js";
import type * as _util_idempotency from "../_util/idempotency.js";
import type * as admin from "../admin.js";
import type * as constants from "../constants.js";
import type * as featureFlags from "../featureFlags.js";
import type * as menuItems from "../menuItems.js";
import type * as menus from "../menus.js";
import type * as optionGroups from "../optionGroups.js";
import type * as orders from "../orders.js";
import type * as restaurants from "../restaurants.js";
import type * as sessions from "../sessions.js";
import type * as tables from "../tables.js";
import type * as userSettings from "../userSettings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_shared/errors": typeof _shared_errors;
  "_shared/types": typeof _shared_types;
  "_util/auth": typeof _util_auth;
  "_util/idempotency": typeof _util_idempotency;
  admin: typeof admin;
  constants: typeof constants;
  featureFlags: typeof featureFlags;
  menuItems: typeof menuItems;
  menus: typeof menus;
  optionGroups: typeof optionGroups;
  orders: typeof orders;
  restaurants: typeof restaurants;
  sessions: typeof sessions;
  tables: typeof tables;
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
