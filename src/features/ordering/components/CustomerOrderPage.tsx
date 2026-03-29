import type { Id } from "convex/_generated/dataModel";
import { OrderStatus } from "./OrderStatus";

interface CustomerOrderPageProps {
	orderId: string;
	onBackToMenu: () => void;
}

export function CustomerOrderPage({ orderId, onBackToMenu }: Readonly<CustomerOrderPageProps>) {
	return <OrderStatus orderId={orderId as Id<"orders">} onBackToMenu={onBackToMenu} />;
}
