import type { Id } from "convex/_generated/dataModel";
import { OrderNotFound } from "./OrderNotFound";
import { OrderStatus } from "./OrderStatus";

interface CustomerOrderPageProps {
	orderId: string;
	onBackToMenu: () => void;
	onViewOrders: () => void;
	onContinueToPayment: () => void;
}

/**
 * Could this URL segment be a Convex document id at all?
 *
 * Convex ids are lowercase base32 strings, 31–37 characters today. The check
 * is deliberately looser than that (any lowercase alphanumeric run of a
 * plausible length) because its only job is to spare an obviously mangled
 * link — `/order/abc`, a truncated paste — the round trip. It is not the gate:
 * `v.id("orders")` on `getOrderWithItems` still validates everything that gets
 * through, and `OrderStatus` renders that rejection as the same not-found
 * screen rather than the route's error panel.
 */
const PLAUSIBLE_CONVEX_ID = /^[0-9a-z]{20,64}$/;

export function CustomerOrderPage({
	orderId,
	onBackToMenu,
	onViewOrders,
	onContinueToPayment,
}: Readonly<CustomerOrderPageProps>) {
	if (!PLAUSIBLE_CONVEX_ID.test(orderId)) {
		return <OrderNotFound onBackToMenu={onBackToMenu} onViewOrders={onViewOrders} />;
	}

	return (
		<OrderStatus
			orderId={orderId as Id<"orders">}
			onBackToMenu={onBackToMenu}
			onViewOrders={onViewOrders}
			onContinueToPayment={onContinueToPayment}
		/>
	);
}
