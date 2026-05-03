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
import type * as _util_attribution from "../_util/attribution.js";
import type * as _util_audit from "../_util/audit.js";
import type * as _util_auth from "../_util/auth.js";
import type * as _util_availability from "../_util/availability.js";
import type * as _util_env from "../_util/env.js";
import type * as _util_idempotency from "../_util/idempotency.js";
import type * as _util_reservationSettings from "../_util/reservationSettings.js";
import type * as _util_stripe from "../_util/stripe.js";
import type * as admin from "../admin.js";
import type * as attendance from "../attendance.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as exports from "../exports.js";
import type * as featureFlags from "../featureFlags.js";
import type * as http from "../http.js";
import type * as inviteActions from "../inviteActions.js";
import type * as invites from "../invites.js";
import type * as menuItems from "../menuItems.js";
import type * as menus from "../menus.js";
import type * as migrations_backfillDefaultMenus from "../migrations/backfillDefaultMenus.js";
import type * as migrations_backfillUpdatedBy from "../migrations/backfillUpdatedBy.js";
import type * as optionGroups from "../optionGroups.js";
import type * as orderDayCounters from "../orderDayCounters.js";
import type * as orderHelpers from "../orderHelpers.js";
import type * as orderServiceDate from "../orderServiceDate.js";
import type * as orders from "../orders.js";
import type * as organizations from "../organizations.js";
import type * as performance from "../performance.js";
import type * as reservationHelpers from "../reservationHelpers.js";
import type * as reservationSettings from "../reservationSettings.js";
import type * as reservations from "../reservations.js";
import type * as restaurantMembers from "../restaurantMembers.js";
import type * as restaurantPurge from "../restaurantPurge.js";
import type * as restaurants from "../restaurants.js";
import type * as sessions from "../sessions.js";
import type * as shifts from "../shifts.js";
import type * as stripe from "../stripe.js";
import type * as stripeHelpers from "../stripeHelpers.js";
import type * as tableLocks from "../tableLocks.js";
import type * as tables from "../tables.js";
import type * as tips from "../tips.js";
import type * as userSettings from "../userSettings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_shared/errors": typeof _shared_errors;
  "_shared/types": typeof _shared_types;
  "_util/attribution": typeof _util_attribution;
  "_util/audit": typeof _util_audit;
  "_util/auth": typeof _util_auth;
  "_util/availability": typeof _util_availability;
  "_util/env": typeof _util_env;
  "_util/idempotency": typeof _util_idempotency;
  "_util/reservationSettings": typeof _util_reservationSettings;
  "_util/stripe": typeof _util_stripe;
  admin: typeof admin;
  attendance: typeof attendance;
  constants: typeof constants;
  crons: typeof crons;
  exports: typeof exports;
  featureFlags: typeof featureFlags;
  http: typeof http;
  inviteActions: typeof inviteActions;
  invites: typeof invites;
  menuItems: typeof menuItems;
  menus: typeof menus;
  "migrations/backfillDefaultMenus": typeof migrations_backfillDefaultMenus;
  "migrations/backfillUpdatedBy": typeof migrations_backfillUpdatedBy;
  optionGroups: typeof optionGroups;
  orderDayCounters: typeof orderDayCounters;
  orderHelpers: typeof orderHelpers;
  orderServiceDate: typeof orderServiceDate;
  orders: typeof orders;
  organizations: typeof organizations;
  performance: typeof performance;
  reservationHelpers: typeof reservationHelpers;
  reservationSettings: typeof reservationSettings;
  reservations: typeof reservations;
  restaurantMembers: typeof restaurantMembers;
  restaurantPurge: typeof restaurantPurge;
  restaurants: typeof restaurants;
  sessions: typeof sessions;
  shifts: typeof shifts;
  stripe: typeof stripe;
  stripeHelpers: typeof stripeHelpers;
  tableLocks: typeof tableLocks;
  tables: typeof tables;
  tips: typeof tips;
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
