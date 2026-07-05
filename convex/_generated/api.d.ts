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
import type * as _shared_integrationLogging from "../_shared/integrationLogging.js";
import type * as _shared_types from "../_shared/types.js";
import type * as _util_attribution from "../_util/attribution.js";
import type * as _util_audit from "../_util/audit.js";
import type * as _util_auth from "../_util/auth.js";
import type * as _util_availability from "../_util/availability.js";
import type * as _util_dinerSession from "../_util/dinerSession.js";
import type * as _util_env from "../_util/env.js";
import type * as _util_idempotency from "../_util/idempotency.js";
import type * as _util_reservationSettings from "../_util/reservationSettings.js";
import type * as _util_stripe from "../_util/stripe.js";
import type * as _util_timezone from "../_util/timezone.js";
import type * as admin from "../admin.js";
import type * as analytics__shared from "../analytics/_shared.js";
import type * as analytics_activeOrders from "../analytics/activeOrders.js";
import type * as analytics_busyTimesHeatmap from "../analytics/busyTimesHeatmap.js";
import type * as analytics_itemsByCategory from "../analytics/itemsByCategory.js";
import type * as analytics_numberWithDelta from "../analytics/numberWithDelta.js";
import type * as analytics_ordersByHour from "../analytics/ordersByHour.js";
import type * as analytics_reservationsByStatus from "../analytics/reservationsByStatus.js";
import type * as analytics_revenueOverTime from "../analytics/revenueOverTime.js";
import type * as analytics_serverPerformance from "../analytics/serverPerformance.js";
import type * as analytics_tableOccupancy from "../analytics/tableOccupancy.js";
import type * as analytics_tipsTotal from "../analytics/tipsTotal.js";
import type * as analytics_topMenuItems from "../analytics/topMenuItems.js";
import type * as attendance from "../attendance.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as dashboardLayouts from "../dashboardLayouts.js";
import type * as dashboardTemplates from "../dashboardTemplates.js";
import type * as emails_contextHelpers from "../emails/contextHelpers.js";
import type * as emails_copy from "../emails/copy.js";
import type * as emails_locale from "../emails/locale.js";
import type * as emails_renderTeamInviteEmail from "../emails/renderTeamInviteEmail.js";
import type * as emails_teamInviteEmail from "../emails/teamInviteEmail.js";
import type * as employeeAccounts from "../employeeAccounts.js";
import type * as exportHelpers from "../exportHelpers.js";
import type * as exports from "../exports.js";
import type * as featureFlags from "../featureFlags.js";
import type * as http from "../http.js";
import type * as inviteActions from "../inviteActions.js";
import type * as invites from "../invites.js";
import type * as menuImport from "../menuImport.js";
import type * as menuImportMutation from "../menuImportMutation.js";
import type * as menuImportPdfHelpers from "../menuImportPdfHelpers.js";
import type * as menuItems from "../menuItems.js";
import type * as menus from "../menus.js";
import type * as migrations_backfillDailyOrderNumber from "../migrations/backfillDailyOrderNumber.js";
import type * as migrations_backfillDefaultMenus from "../migrations/backfillDefaultMenus.js";
import type * as migrations_backfillPrepStation from "../migrations/backfillPrepStation.js";
import type * as migrations_backfillRestaurantTimezone from "../migrations/backfillRestaurantTimezone.js";
import type * as migrations_backfillUpdatedBy from "../migrations/backfillUpdatedBy.js";
import type * as optionGroups from "../optionGroups.js";
import type * as orderDayCounters from "../orderDayCounters.js";
import type * as orderHelpers from "../orderHelpers.js";
import type * as orderServiceDate from "../orderServiceDate.js";
import type * as orders from "../orders.js";
import type * as organizations from "../organizations.js";
import type * as payments from "../payments.js";
import type * as performance from "../performance.js";
import type * as reservationHelpers from "../reservationHelpers.js";
import type * as reservationSettings from "../reservationSettings.js";
import type * as reservations from "../reservations.js";
import type * as restaurantMembers from "../restaurantMembers.js";
import type * as restaurantPurge from "../restaurantPurge.js";
import type * as restaurants from "../restaurants.js";
import type * as sections from "../sections.js";
import type * as sessions from "../sessions.js";
import type * as sharedEmployee from "../sharedEmployee.js";
import type * as shiftTemplates from "../shiftTemplates.js";
import type * as shifts from "../shifts.js";
import type * as softDeletePurge from "../softDeletePurge.js";
import type * as stripe from "../stripe.js";
import type * as stripeHelpers from "../stripeHelpers.js";
import type * as tableLocks from "../tableLocks.js";
import type * as tables from "../tables.js";
import type * as tips from "../tips.js";
import type * as userSettings from "../userSettings.js";
import type * as whatsapp_data from "../whatsapp/data.js";
import type * as whatsapp_outbound from "../whatsapp/outbound.js";
import type * as whatsapp_phone from "../whatsapp/phone.js";
import type * as whatsapp_processing from "../whatsapp/processing.js";
import type * as whatsapp_twilioValidation from "../whatsapp/twilioValidation.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_shared/errors": typeof _shared_errors;
  "_shared/integrationLogging": typeof _shared_integrationLogging;
  "_shared/types": typeof _shared_types;
  "_util/attribution": typeof _util_attribution;
  "_util/audit": typeof _util_audit;
  "_util/auth": typeof _util_auth;
  "_util/availability": typeof _util_availability;
  "_util/dinerSession": typeof _util_dinerSession;
  "_util/env": typeof _util_env;
  "_util/idempotency": typeof _util_idempotency;
  "_util/reservationSettings": typeof _util_reservationSettings;
  "_util/stripe": typeof _util_stripe;
  "_util/timezone": typeof _util_timezone;
  admin: typeof admin;
  "analytics/_shared": typeof analytics__shared;
  "analytics/activeOrders": typeof analytics_activeOrders;
  "analytics/busyTimesHeatmap": typeof analytics_busyTimesHeatmap;
  "analytics/itemsByCategory": typeof analytics_itemsByCategory;
  "analytics/numberWithDelta": typeof analytics_numberWithDelta;
  "analytics/ordersByHour": typeof analytics_ordersByHour;
  "analytics/reservationsByStatus": typeof analytics_reservationsByStatus;
  "analytics/revenueOverTime": typeof analytics_revenueOverTime;
  "analytics/serverPerformance": typeof analytics_serverPerformance;
  "analytics/tableOccupancy": typeof analytics_tableOccupancy;
  "analytics/tipsTotal": typeof analytics_tipsTotal;
  "analytics/topMenuItems": typeof analytics_topMenuItems;
  attendance: typeof attendance;
  constants: typeof constants;
  crons: typeof crons;
  dashboardLayouts: typeof dashboardLayouts;
  dashboardTemplates: typeof dashboardTemplates;
  "emails/contextHelpers": typeof emails_contextHelpers;
  "emails/copy": typeof emails_copy;
  "emails/locale": typeof emails_locale;
  "emails/renderTeamInviteEmail": typeof emails_renderTeamInviteEmail;
  "emails/teamInviteEmail": typeof emails_teamInviteEmail;
  employeeAccounts: typeof employeeAccounts;
  exportHelpers: typeof exportHelpers;
  exports: typeof exports;
  featureFlags: typeof featureFlags;
  http: typeof http;
  inviteActions: typeof inviteActions;
  invites: typeof invites;
  menuImport: typeof menuImport;
  menuImportMutation: typeof menuImportMutation;
  menuImportPdfHelpers: typeof menuImportPdfHelpers;
  menuItems: typeof menuItems;
  menus: typeof menus;
  "migrations/backfillDailyOrderNumber": typeof migrations_backfillDailyOrderNumber;
  "migrations/backfillDefaultMenus": typeof migrations_backfillDefaultMenus;
  "migrations/backfillPrepStation": typeof migrations_backfillPrepStation;
  "migrations/backfillRestaurantTimezone": typeof migrations_backfillRestaurantTimezone;
  "migrations/backfillUpdatedBy": typeof migrations_backfillUpdatedBy;
  optionGroups: typeof optionGroups;
  orderDayCounters: typeof orderDayCounters;
  orderHelpers: typeof orderHelpers;
  orderServiceDate: typeof orderServiceDate;
  orders: typeof orders;
  organizations: typeof organizations;
  payments: typeof payments;
  performance: typeof performance;
  reservationHelpers: typeof reservationHelpers;
  reservationSettings: typeof reservationSettings;
  reservations: typeof reservations;
  restaurantMembers: typeof restaurantMembers;
  restaurantPurge: typeof restaurantPurge;
  restaurants: typeof restaurants;
  sections: typeof sections;
  sessions: typeof sessions;
  sharedEmployee: typeof sharedEmployee;
  shiftTemplates: typeof shiftTemplates;
  shifts: typeof shifts;
  softDeletePurge: typeof softDeletePurge;
  stripe: typeof stripe;
  stripeHelpers: typeof stripeHelpers;
  tableLocks: typeof tableLocks;
  tables: typeof tables;
  tips: typeof tips;
  userSettings: typeof userSettings;
  "whatsapp/data": typeof whatsapp_data;
  "whatsapp/outbound": typeof whatsapp_outbound;
  "whatsapp/phone": typeof whatsapp_phone;
  "whatsapp/processing": typeof whatsapp_processing;
  "whatsapp/twilioValidation": typeof whatsapp_twilioValidation;
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
