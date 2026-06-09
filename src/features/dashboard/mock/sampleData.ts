/**
 * Dev-only sample data for dashboard widgets (TAVLI-2).
 *
 * Surfaced by `useWidgetData` **only** when `config.isDev` AND the real query is
 * empty or erroring, and always paired with a visible "Sample data" badge so it
 * can never be mistaken for real figures. This module is the single home for all
 * mock shapes — widgets never inline their own — and it is never used in a
 * production data path (`config.isProd` short-circuits the lookup).
 *
 * Keys are either a widget `type`, or `"<type>:<variant>"` for widgets whose
 * sample depends on configuration (e.g. NumberWithDelta per metric).
 */
const SAMPLE: Record<string, unknown> = {
	activeOrders: { seatedTables: 5, activeOrderCount: 7, activeOrderValue: 184.5 },

	itemsByCategory: [
		{ categoryId: "sample-mains", categoryName: "Mains", revenue: 1860 },
		{ categoryId: "sample-drinks", categoryName: "Drinks", revenue: 700 },
		{ categoryId: "sample-desserts", categoryName: "Desserts", revenue: 350 },
		{ categoryId: "sample-starters", categoryName: "Starters", revenue: 290 },
	],

	serverPerformance: [
		{ memberId: "sample-1", name: "Ana García", sales: 2140, orders: 98, avgCheck: 21.8 },
		{ memberId: "sample-2", name: "Luis Romero", sales: 1870, orders: 84, avgCheck: 22.3 },
		{ memberId: "sample-3", name: "Marta Núñez", sales: 1510, orders: 71, avgCheck: 21.3 },
		{ memberId: "sample-4", name: "Diego Salas", sales: 1180, orders: 59, avgCheck: 20.0 },
	],

	"numberWithDelta:reservations.count": { current: 24, previous: 19, deltaAbs: 5, deltaPct: 0.263 },
	"numberWithDelta:reservations.confirmed": {
		current: 18,
		previous: 15,
		deltaAbs: 3,
		deltaPct: 0.2,
	},
	"numberWithDelta:orders.count": { current: 210, previous: 188, deltaAbs: 22, deltaPct: 0.117 },
	"numberWithDelta:orders.avgDishValue": {
		current: 6.67,
		previous: 6.4,
		deltaAbs: 0.27,
		deltaPct: 0.042,
	},
	"numberWithDelta:orders.avgCheck": {
		current: 15.24,
		previous: 14.1,
		deltaAbs: 1.14,
		deltaPct: 0.081,
	},
	"numberWithDelta:payments.revenueTotal": {
		current: 3200,
		previous: 2890,
		deltaAbs: 310,
		deltaPct: 0.107,
	},
	"numberWithDelta:covers": { current: 96, previous: 88, deltaAbs: 8, deltaPct: 0.091 },
};

/** Returns the sample payload for a widget key, or `undefined` if none exists. */
export function getSampleData(key: string): unknown {
	return SAMPLE[key];
}
