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
import type * as _util_availability from "../_util/availability.js";
import type * as _util_env from "../_util/env.js";
import type * as _util_idempotency from "../_util/idempotency.js";
import type * as _util_reservationSettings from "../_util/reservationSettings.js";
import type * as _util_stripe from "../_util/stripe.js";
import type * as admin from "../admin.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as featureFlags from "../featureFlags.js";
import type * as http from "../http.js";
import type * as menuItems from "../menuItems.js";
import type * as menus from "../menus.js";
import type * as optionGroups from "../optionGroups.js";
import type * as orderDayCounters from "../orderDayCounters.js";
import type * as orderHelpers from "../orderHelpers.js";
import type * as orderServiceDate from "../orderServiceDate.js";
import type * as orders from "../orders.js";
import type * as organizations from "../organizations.js";
import type * as reservationHelpers from "../reservationHelpers.js";
import type * as reservationSettings from "../reservationSettings.js";
import type * as reservations from "../reservations.js";
import type * as restaurants from "../restaurants.js";
import type * as sessions from "../sessions.js";
import type * as stripe from "../stripe.js";
import type * as stripeHelpers from "../stripeHelpers.js";
import type * as tableLocks from "../tableLocks.js";
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
  "_util/availability": typeof _util_availability;
  "_util/env": typeof _util_env;
  "_util/idempotency": typeof _util_idempotency;
  "_util/reservationSettings": typeof _util_reservationSettings;
  "_util/stripe": typeof _util_stripe;
  admin: typeof admin;
  constants: typeof constants;
  crons: typeof crons;
  featureFlags: typeof featureFlags;
  http: typeof http;
  menuItems: typeof menuItems;
  menus: typeof menus;
  optionGroups: typeof optionGroups;
  orderDayCounters: typeof orderDayCounters;
  orderHelpers: typeof orderHelpers;
  orderServiceDate: typeof orderServiceDate;
  orders: typeof orders;
  organizations: typeof organizations;
  reservationHelpers: typeof reservationHelpers;
  reservationSettings: typeof reservationSettings;
  reservations: typeof reservations;
  restaurants: typeof restaurants;
  sessions: typeof sessions;
  stripe: typeof stripe;
  stripeHelpers: typeof stripeHelpers;
  tableLocks: typeof tableLocks;
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
