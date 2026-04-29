import type { OrderDashboardStatusFilter } from "@/features";
import { getStatusToneStyle, StatusBadge, Surface } from "@/global/components";
import { OrdersKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { getRelativeTime } from "@/global/utils/relativeTime";
import { CheckCircle2, ChefHat, Clock, CreditCard, UtensilsCrossed, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { OrderItemRow } from "./OrderItemRow";
import {
	formatOrderDate,
	formatOrderTime,
	MAX_VISIBLE_ITEMS,
	STATUS_CONFIG,
	URGENCY_TEXT_CLASS,
	type DashboardOrder,
	type NextOrderStatus,
} from "./statusConfig";

interface OrderCardProps {
	order: DashboardOrder;
	now: number;
	cancelConfirm: string | null;
	onSelectFullOrder: (order: DashboardOrder) => void;
	onRequestCancel: (orderId: string) => void;
	onDismissCancel: () => void;
	onUpdateStatus: (args: {
		orderId: DashboardOrder["_id"];
		newStatus: NextOrderStatus;
	}) => void;
}

export function OrderCard({
	order,
	now,
	cancelConfirm,
	onSelectFullOrder,
	onRequestCancel,
	onDismissCancel,
	onUpdateStatus,
}: Readonly<OrderCardProps>) {
	const { t, i18n } = useTranslation();
	const config = STATUS_CONFIG[order.status as OrderDashboardStatusFilter];
	const visibleItems = order.items.slice(0, MAX_VISIBLE_ITEMS);
	const hiddenCount = order.items.length - visibleItems.length;
	const age = getRelativeTime(order.createdAt, now);
	const absoluteTimestamp = `${formatOrderDate(order.createdAt, i18n.language)}, ${formatOrderTime(order.createdAt, i18n.language)}`;
	const hasNextAction = config.next !== null && config.nextLabelKey !== null;
	const isCancelling = cancelConfirm === order._id;
	const moreItemsLabel =
		hiddenCount > 0
			? `${t(OrdersKeys.CARD_MORE_ITEMS, { count: hiddenCount })} · ${t(OrdersKeys.ACTION_VIEW_FULL_ORDER)}`
			: t(OrdersKeys.ACTION_VIEW_FULL_ORDER);

	return (
		<Surface tone="secondary" rounded="xl" className="overflow-hidden flex flex-col aspect-video">
			<div
				className="px-4 py-3 shrink-0 border-b border-border"
				
			>
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2 min-w-0">
						<StatusBadge
							bgColor={getStatusToneStyle(config.tone).solidBg}
							textColor={getStatusToneStyle(config.tone).solidFg}
							label={t(config.labelKey)}
						/>
						<span
							className="text-sm font-medium truncate text-foreground"
							
						>
							{t(OrdersKeys.CARD_TABLE, { number: order.tableNumber })}
						</span>
						{order.paidAt && (
							<span
								className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 bg-success"
								style={{color: "white"}}
							>
								<CreditCard size={10} />
								{t(OrdersKeys.CARD_PAID)}
							</span>
						)}
					</div>
					<span
						className="text-sm font-semibold shrink-0 text-foreground"
						
					>
						${formatCents(order.totalAmount)}
					</span>
				</div>

				<div className="flex items-center justify-between gap-2 mt-1">
					<span
						className="text-[11px] font-mono truncate text-faint-foreground"
						
						title={order._id}
					>
						#{order._id.slice(-6)}
					</span>
					<span className="relative group flex items-center gap-1 text-[11px] font-medium shrink-0 cursor-help">
						<span
							className={`flex items-center gap-1 underline decoration-dotted decoration-from-font underline-offset-2 ${URGENCY_TEXT_CLASS[age.urgency]}`}
						>
							<Clock size={11} />
							{t(age.key, age.vars)}
						</span>
						<span
							className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity duration-150 absolute right-0 top-full mt-1 whitespace-nowrap text-[10px] px-2 py-1 rounded shadow-lg pointer-events-none z-10 bg-card text-foreground border border-border"
							
						>
							{absoluteTimestamp}
						</span>
					</span>
				</div>
			</div>

			<div className="p-4 space-y-2 flex-1 min-h-0 overflow-y-auto">
				{visibleItems.map((item) => (
					<OrderItemRow key={item._id} item={item} />
				))}
			</div>

			<div className="px-4 pb-4 pt-2 space-y-2 shrink-0">
				<button
					type="button"
					onClick={() => onSelectFullOrder(order)}
					className="w-full text-right text-[11px] font-medium transition-opacity hover:opacity-70 text-faint-foreground"
					
				>
					{moreItemsLabel}
				</button>

				{isCancelling ? (
					<div
						className="p-3 rounded-lg space-y-2"
						style={{backgroundColor: "rgba(220, 38, 38, 0.05)",
				border: "1px solid rgba(220, 38, 38, 0.2)"}}
					>
						<p
							className="text-xs font-medium text-destructive"
							
						>
							{order.stripePaymentIntentId
								? t(OrdersKeys.CANCEL_PAID_PROMPT)
								: t(OrdersKeys.CANCEL_PROMPT)}
						</p>
						<div className="flex gap-2">
							<button
								onClick={() => {
									onUpdateStatus({
										orderId: order._id,
										newStatus: "cancelled",
									});
									onDismissCancel();
								}}
								className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-destructive"
								style={{color: "white"}}
							>
								{order.stripePaymentIntentId
									? t(OrdersKeys.ACTION_CANCEL_AND_REFUND)
									: t(OrdersKeys.ACTION_CONFIRM_CANCEL)}
							</button>
							<button
								onClick={onDismissCancel}
								className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground"
								
							>
								{t(OrdersKeys.ACTION_KEEP_ORDER)}
							</button>
						</div>
					</div>
				) : (
					hasNextAction && (
						<div className="flex gap-2">
							{config.next && config.nextLabelKey && (
								<button
									onClick={() =>
										onUpdateStatus({
											orderId: order._id,
											newStatus: config.next as NextOrderStatus,
										})
									}
									className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium hover-btn-primary"
								>
									{config.next === "preparing" && <ChefHat size={14} />}
									{config.next === "ready" && <CheckCircle2 size={14} />}
									{config.next === "served" && <UtensilsCrossed size={14} />}
									{t(config.nextLabelKey)}
								</button>
							)}
							<button
								onClick={() => onRequestCancel(order._id)}
								className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm border border-border text-destructive"
								
							>
								<XCircle size={14} />
								{t(OrdersKeys.ACTION_CANCEL)}
							</button>
						</div>
					)
				)}
			</div>
		</Surface>
	);
}
