import {
	DialogHeader,
	getStatusToneStyle,
	Modal,
	StatusBadge,
	Surface,
} from "@/global/components";
import { CommonKeys, OrdersKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { getRelativeTime } from "@/global/utils/relativeTime";
import { Clock, CreditCard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { OrderItemRow } from "./OrderItemRow";
import {
	formatOrderDate,
	formatOrderTime,
	isDashboardStatus,
	STATUS_CONFIG,
	URGENCY_BG_CLASS,
	type DashboardOrder,
} from "./statusConfig";

interface OrderDetailModalProps {
	fullOrder: DashboardOrder | null;
	now: number;
	onClose: () => void;
}

export function OrderDetailModal({
	fullOrder,
	now,
	onClose,
}: Readonly<OrderDetailModalProps>) {
	const { t, i18n } = useTranslation();
	const fullOrderConfig =
		fullOrder && isDashboardStatus(fullOrder.status) ? STATUS_CONFIG[fullOrder.status] : null;
	const fullOrderAge = fullOrder ? getRelativeTime(fullOrder.createdAt, now) : null;

	return (
		<Modal
			isOpen={fullOrder !== null}
			onClose={onClose}
			ariaLabel={t(OrdersKeys.ARIA_FULL_ORDER)}
			size="lg"
		>
			{fullOrder && (
				<Surface tone="primary" rounded="xl">
					<DialogHeader
						title={
							<div className="flex items-center gap-2 flex-wrap">
								{fullOrderConfig && (
									<StatusBadge
										bgColor={getStatusToneStyle(fullOrderConfig.tone).solidBg}
										textColor={getStatusToneStyle(fullOrderConfig.tone).solidFg}
										label={t(fullOrderConfig.labelKey)}
									/>
								)}
								<h2
									className="text-lg font-semibold text-foreground"
									
								>
									{t(OrdersKeys.CARD_TABLE, { number: fullOrder.tableNumber })}
								</h2>
								{fullOrder.dailyOrderNumber != null && (
									<span
										className="text-lg font-bold tabular-nums text-foreground"
										title={fullOrder._id}
									>
										{t(OrdersKeys.CARD_DAY_NUMBER, { n: fullOrder.dailyOrderNumber })}
									</span>
								)}
								{fullOrder.paidAt && (
									<span
										className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-success"
										style={{color: "white"}}
									>
										<CreditCard size={10} />
										{t(OrdersKeys.CARD_PAID)}
									</span>
								)}
							</div>
						}
						subtitle={
							<span
								className="text-xs font-mono break-all text-faint-foreground"
								
							>
								#{fullOrder._id}
							</span>
						}
						onClose={onClose}
					/>

					<div
						className="px-6 py-3 flex items-center justify-between text-xs gap-4 flex-wrap text-faint-foreground border-b border-border"
						
					>
						<div className="flex items-center gap-3 flex-wrap">
							{fullOrderAge && (
								<span
									className={`px-2 py-0.5 rounded-full text-[11px] font-medium text-inverse-foreground ${URGENCY_BG_CLASS[fullOrderAge.urgency]}`}
								>
									{t(fullOrderAge.key, fullOrderAge.vars)}
								</span>
							)}
							<span>
								{t(CommonKeys.ITEMS_COUNT, { count: fullOrder.items.length })}
							</span>
							<span className="flex items-center gap-1">
								<Clock size={12} />
								{formatOrderDate(fullOrder.createdAt, i18n.language)} ·{" "}
								{formatOrderTime(fullOrder.createdAt, i18n.language)}
							</span>
						</div>
						<span className="font-medium text-foreground" >
							${formatCents(fullOrder.totalAmount)}
						</span>
					</div>

					<div className="px-6 py-4 space-y-2 max-h-[60vh] overflow-y-auto">
						{fullOrder.items.map((item) => (
							<OrderItemRow key={item._id} item={item} />
						))}
					</div>
				</Surface>
			)}
		</Modal>
	);
}
