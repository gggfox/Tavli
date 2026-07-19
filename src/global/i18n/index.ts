export * from "./config";
export { default as i18n } from "./config";
export { AdminStaffKeys, type AdminStaffKey } from "./keys/adminStaff";
export { CommonKeys, type CommonKey } from "./keys/common";
export { CustomerKeys, type CustomerKey } from "./keys/customer";
export { DashboardKeys, type DashboardKey } from "./keys/dashboard";
export {
	BACKEND_ERROR_CODES,
	ERROR_CODE_KEYS,
	ErrorKeys,
	type BackendErrorCode,
	type ErrorKey,
} from "./keys/errors";
export { ExportsKeys, type ExportsKey } from "./keys/exports";
export { Languages, type Language } from "./keys/languages";
export { MenusKeys, type MenusKey } from "./keys/menus";
export { OptionsKeys, type OptionsKey } from "./keys/options";
export { OrderingKeys, type OrderingKey } from "./keys/ordering";
export { OrdersKeys, type OrdersKey } from "./keys/orders";
export { TabsKeys, type TabsKey } from "./keys/tabs";
export { PaymentsKeys, type PaymentsKey } from "./keys/payments";
export { ReservationSettingsKeys, type ReservationSettingsKey } from "./keys/reservationSettings";
export { ReservationsKeys, type ReservationsKey } from "./keys/reservations";
export { RestaurantsKeys, type RestaurantsKey } from "./keys/restaurants";
export { RoleKeys, type RoleKey } from "./keys/role";
export { SidebarKeys, type SidebarKey } from "./keys/sidebar";
export { TimeKeys, type TimeKey } from "./keys/time";
export { WelcomeKeys, type WelcomeKey } from "./keys/welcome";
export { localizeName, useLocalizedName } from "./useLocalizedName";
