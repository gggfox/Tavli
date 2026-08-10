import type { OrderDashboardStatusFilterValue } from "@/features";
import { getStatusToneStyle, StatusBadge, Surface } from "@/global/components";
import { OrdersKeys, useLocalizedName } from "@/global/i18n";
import { getRelativeTime } from "@/global/utils/relativeTime";
import type { Id } from "convex/_generated/dataModel";
import { ChefHat, Clock, Replace, XCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OrderItemRow } from "./OrderItemRow";
import { STATION_CONFIG } from "./stationConfig";
import type { StationTicket } from "./stationTickets";
import type { SubstitutionTarget } from "./SubstitutionProposalDialog";
import {
	formatOrderDate,
	formatOrderTime,
	STATUS_CONFIG,
	URGENCY_TEXT_CLASS,
	type DashboardOrder,
	type DashboardOrderItem,
	type NextOrderStatus,
} from "./statusConfig";

interface StationTicketCardProps {
	readonly ticket: StationTicket;
	readonly now: number;
	/** Item id whose 86 is in flight, if any. Disables the confirm button. */
	readonly cancelItemPendingId: string | null;
	readonly cancelItemError: string | null;
	/**
	 * Pending substitution proposal ids keyed by order-item id (ADR 008). A line
	 * with a pending proposal shows a badge + withdraw action instead of the
	 * propose button.
	 */
	readonly pendingProposalsByItem?: ReadonlyMap<string, Id<"substitutionProposals">>;
	readonly onSelectFullOrder: (order: DashboardOrder) => void;
	readonly onUpdateStatus: (args: {
		orderId: DashboardOrder["_id"];
		newStatus: NextOrderStatus;
	}) => void;
	readonly onMarkStationReady: (args: {
		orderId: DashboardOrder["_id"];
		station: StationTicket["station"];
	}) => void;
	readonly onCancelItem: (orderItemId: DashboardOrderItem["_id"]) => void;
	readonly onProposeSubstitution?: (target: SubstitutionTarget) => void;
	readonly onCancelProposal?: (proposalId: Id<"substitutionProposals">) => void;
}

/**
 * A station's own view of one round: only its items, and only the actions it
 * can take on them. Deliberately leaner than `OrderCard` — money, payment
 * state, cross-station progress, and whole-order cancellation all belong to
 * the overview, not to a prep rail (ADR 007).
 */
export function StationTicketCard({
	ticket,
	now,
	cancelItemPendingId,
	cancelItemError,
	pendingProposalsByItem,
	onSelectFullOrder,
	onUpdateStatus,
	onMarkStationReady,
	onCancelItem,
	onProposeSubstitution,
	onCancelProposal,
}: Readonly<StationTicketCardProps>) {
	const { t, i18n } = useTranslation();
	const [cancelItemConfirm, setCancelItemConfirm] = useState<string | null>(null);
	const { order, station, items } = ticket;
	// Substitutions only exist for PAID lines still in the kitchen (ADR 008).
	const canSubstitute =
		order.paymentState === "paid" && (order.status === "submitted" || order.status === "preparing");
	const config = STATUS_CONFIG[order.status as OrderDashboardStatusFilterValue];
	const stationConfig = STATION_CONFIG[station];
	const StationIcon = stationConfig.icon;
	const age = getRelativeTime(order.createdAt, now);
	const absoluteTimestamp = `${formatOrderDate(order.createdAt, i18n.language)}, ${formatOrderTime(order.createdAt, i18n.language)}`;

	return (
		<Surface
			tone="secondary"
			rounded="xl"
			className="overflow-hidden flex flex-col"
			style={{ borderLeft: `3px solid ${stationConfig.visual.accentBorder}` }}
		>
			<div
				className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-medium"
				style={{ backgroundColor: stationConfig.visual.tintedBg, color: stationConfig.visual.fg }}
			>
				<StationIcon size={12} />
				{t(stationConfig.labelKey)}
			</div>

			<div className="px-4 py-3 shrink-0 border-b border-border">
				<div className="flex items-center gap-2 min-w-0">
					<StatusBadge
						bgColor={getStatusToneStyle(config.tone).solidBg}
						textColor={getStatusToneStyle(config.tone).solidFg}
						label={t(config.labelKey)}
					/>
					<span className="text-sm font-medium truncate text-foreground">
						{t(OrdersKeys.CARD_TABLE, { number: order.tableNumber })}
					</span>
					{order.dailyOrderNumber != null && (
						<span className="text-sm font-bold tabular-nums shrink-0 text-foreground">
							{t(OrdersKeys.CARD_DAY_NUMBER, { n: order.dailyOrderNumber })}
						</span>
					)}
					<span className="relative group ml-auto flex items-center gap-1 text-[11px] font-medium shrink-0 cursor-help">
						<span
							className={`flex items-center gap-1 underline decoration-dotted decoration-from-font underline-offset-2 ${URGENCY_TEXT_CLASS[age.urgency]}`}
						>
							<Clock size={11} />
							{t(age.key, age.vars)}
						</span>
						<span className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity duration-150 absolute right-0 top-full mt-1 whitespace-nowrap text-[10px] px-2 py-1 rounded shadow-lg pointer-events-none z-10 bg-card text-foreground border border-border">
							{absoluteTimestamp}
						</span>
					</span>
				</div>

				{order.specialInstructions && (
					<p className="mt-1.5 text-xs italic text-warning">
						<span className="font-medium not-italic">{t(OrdersKeys.TICKET_ORDER_NOTE)}: </span>
						{order.specialInstructions}
					</p>
				)}
			</div>

			{/* Every item, never a "+N more" — a station has to see all of its work. */}
			<div className="p-4 space-y-2 flex-1 min-h-0">
				{items.map((item) => (
					<TicketItemRow
						key={item._id}
						item={item}
						isPaidOrder={order.paymentState === "paid"}
						isConfirming={cancelItemConfirm === item._id}
						isPending={cancelItemPendingId === item._id}
						errorMessage={cancelItemConfirm === item._id ? cancelItemError : null}
						pendingProposalId={pendingProposalsByItem?.get(item._id) ?? null}
						onRequestCancel={() => setCancelItemConfirm(item._id)}
						onDismissCancel={() => setCancelItemConfirm(null)}
						onConfirmCancel={() => {
							onCancelItem(item._id);
							setCancelItemConfirm(null);
						}}
						onRequestSubstitute={
							canSubstitute && onProposeSubstitution
								? () =>
										onProposeSubstitution({
											orderId: order._id,
											orderItemId: item._id,
											menuItemId: item.menuItemId,
											menuItemName: item.menuItemName,
											quantity: item.quantity,
											lineTotal: item.lineTotal,
										})
								: undefined
						}
						onCancelProposal={onCancelProposal}
					/>
				))}
			</div>

			<div className="px-4 pb-4 pt-2 space-y-2 shrink-0">
				<button
					type="button"
					onClick={() => onSelectFullOrder(order)}
					className="w-full text-right text-[11px] font-medium transition-opacity hover:opacity-70 text-faint-foreground"
				>
					{t(OrdersKeys.ACTION_VIEW_FULL_ORDER)}
				</button>

				{order.status === "submitted" ? (
					<button
						onClick={() => onUpdateStatus({ orderId: order._id, newStatus: "preparing" })}
						className="w-full flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium hover-btn-primary"
					>
						<ChefHat size={14} />
						{t(OrdersKeys.ACTION_ACCEPT)}
					</button>
				) : (
					<button
						onClick={() => onMarkStationReady({ orderId: order._id, station })}
						className="w-full flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium"
						style={{
							backgroundColor: stationConfig.visual.solidBg,
							color: stationConfig.visual.solidFg,
						}}
					>
						<StationIcon size={14} />
						{t(stationConfig.readyActionKey)}
					</button>
				)}
			</div>
		</Surface>
	);
}

interface TicketItemRowProps {
	readonly item: DashboardOrderItem;
	/** Paid orders get the refund-mentioning 86 copy and the substitute action. */
	readonly isPaidOrder: boolean;
	readonly isConfirming: boolean;
	readonly isPending: boolean;
	readonly errorMessage: string | null;
	/** Pending substitution proposal for this line, if any (ADR 008). */
	readonly pendingProposalId: Id<"substitutionProposals"> | null;
	readonly onRequestCancel: () => void;
	readonly onDismissCancel: () => void;
	readonly onConfirmCancel: () => void;
	/** Present only when the line is eligible for a substitution proposal. */
	readonly onRequestSubstitute?: () => void;
	readonly onCancelProposal?: (proposalId: Id<"substitutionProposals">) => void;
}

/**
 * An item on a station ticket, with the 86 and substitution affordances. The
 * row itself renders through the shared `OrderItemRow` with no station filter
 * — a ticket only ever holds one station's items, so there is nothing to
 * highlight against.
 */
function TicketItemRow({
	item,
	isPaidOrder,
	isConfirming,
	isPending,
	errorMessage,
	pendingProposalId,
	onRequestCancel,
	onDismissCancel,
	onConfirmCancel,
	onRequestSubstitute,
	onCancelProposal,
}: Readonly<TicketItemRowProps>) {
	const { t } = useTranslation();
	const itemName = useLocalizedName(item.menuItemName, item.menuItemTranslations);

	if (isConfirming) {
		return (
			<div
				className="p-3 rounded-lg space-y-2"
				style={{
					backgroundColor: "rgba(220, 38, 38, 0.05)",
					border: "1px solid rgba(220, 38, 38, 0.2)",
				}}
			>
				<p className="text-xs font-medium text-destructive">
					{/* A paid line refunds automatically (ADR 008) — say so before staff commit. */}
					{isPaidOrder
						? t(OrdersKeys.CANCEL_ITEM_PAID_PROMPT, { name: itemName })
						: t(OrdersKeys.CANCEL_ITEM_PROMPT, { name: itemName })}
				</p>
				{errorMessage && <p className="text-xs text-destructive">{errorMessage}</p>}
				<div className="flex gap-2">
					<button
						onClick={onConfirmCancel}
						disabled={isPending}
						className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-destructive disabled:opacity-60"
						style={{ color: "white" }}
					>
						{t(OrdersKeys.ACTION_CONFIRM_CANCEL_ITEM)}
					</button>
					<button
						onClick={onDismissCancel}
						disabled={isPending}
						className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground disabled:opacity-60"
					>
						{t(OrdersKeys.ACTION_KEEP_ITEM)}
					</button>
				</div>
			</div>
		);
	}

	const hasPendingProposal = pendingProposalId !== null;

	return (
		<div className="space-y-1">
			<div className="flex items-start gap-2">
				<div className="flex-1 min-w-0">
					<OrderItemRow item={item} />
				</div>
				{!hasPendingProposal && onRequestSubstitute && item.cancelledAt === undefined && (
					<button
						onClick={onRequestSubstitute}
						aria-label={t(OrdersKeys.ARIA_PROPOSE_SUBSTITUTION, { name: itemName })}
						className="flex items-center gap-1 px-2 py-0.5 shrink-0 rounded text-[11px] font-medium border border-border text-foreground"
					>
						<Replace size={11} />
						{t(OrdersKeys.SUB_ACTION_PROPOSE)}
					</button>
				)}
				<button
					onClick={onRequestCancel}
					aria-label={t(OrdersKeys.ARIA_CANCEL_ITEM, { name: itemName })}
					className="flex items-center gap-1 px-2 py-0.5 shrink-0 rounded text-[11px] font-medium border border-border text-destructive"
				>
					<XCircle size={11} />
					{t(OrdersKeys.ACTION_CANCEL_ITEM)}
				</button>
			</div>
			{hasPendingProposal && (
				<div className="flex items-center gap-2 pl-1">
					<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide bg-muted text-muted-foreground">
						<Replace size={10} />
						{t(OrdersKeys.SUB_PENDING_BADGE)}
					</span>
					{onCancelProposal && (
						<button
							onClick={() => onCancelProposal(pendingProposalId)}
							className="text-[11px] font-medium underline text-muted-foreground"
						>
							{t(OrdersKeys.SUB_ACTION_CANCEL_PROPOSAL)}
						</button>
					)}
				</div>
			)}
		</div>
	);
}
