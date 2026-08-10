/**
 * Staff dialog for proposing a substitution on a paid line (ADR 008,
 * TAVLI-71 Phase 3A). Lists the restaurant's available menu items whose
 * substitution delta is non-negative (equal-or-higher rule, computed against
 * the line's total exactly like the backend) with a preview of the extra the
 * diner would pay (delta + service fee on the delta). Confirming calls
 * `substitutions.proposeSubstitution`; the diner then approves on their own
 * device.
 */
import { OrdersKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils";
import { formatCents } from "@/global/utils/money";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { PLATFORM_APPLICATION_FEE_RATE } from "convex/constants";
import { Loader2, Replace, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/** The line a substitution is being proposed for. */
export interface SubstitutionTarget {
	readonly orderId: Id<"orders">;
	readonly orderItemId: Id<"orderItems">;
	readonly menuItemId: Id<"menuItems">;
	readonly menuItemName: string;
	readonly quantity: number;
	readonly lineTotal: number;
}

interface SubstitutionProposalDialogProps {
	readonly restaurantId: Id<"restaurants">;
	readonly target: SubstitutionTarget;
	readonly onClose: () => void;
	readonly onPropose: (args: {
		orderId: Id<"orders">;
		orderItemId: Id<"orderItems">;
		proposedMenuItemId: Id<"menuItems">;
	}) => Promise<unknown>;
}

export function SubstitutionProposalDialog({
	restaurantId,
	target,
	onClose,
	onPropose,
}: Readonly<SubstitutionProposalDialogProps>) {
	const { t } = useTranslation();
	const [selectedId, setSelectedId] = useState<Id<"menuItems"> | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Public read: available items on active menus — exactly what a substitute
	// may be. Filtered client-side to the equal-or-higher rule.
	const { data: menuItems } = useQuery(
		convexQuery(api.menuItems.getByRestaurant, { restaurantId })
	);

	const candidates = useMemo(() => {
		const items = (menuItems ?? []) as Doc<"menuItems">[];
		return items
			.filter(
				(item) =>
					item._id !== target.menuItemId &&
					// Same math the backend enforces: substitutes carry no options,
					// so the proposed line is basePrice × quantity and the delta must
					// be >= 0 against the line's current total.
					item.basePrice * target.quantity - target.lineTotal >= 0
			)
			.sort((a, b) => a.basePrice - b.basePrice);
	}, [menuItems, target]);

	const handleConfirm = async () => {
		if (!selectedId) return;
		setSubmitting(true);
		setError(null);
		try {
			await onPropose({
				orderId: target.orderId,
				orderItemId: target.orderItemId,
				proposedMenuItemId: selectedId,
			});
			onClose();
		} catch (err) {
			setError(getErrorMessage(err, t));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
			<div className="w-full max-w-md rounded-2xl bg-card border border-border p-5 space-y-4 overflow-y-auto max-h-[85vh]">
				<div className="flex items-start gap-2">
					<div className="flex-1 min-w-0">
						<h2 className="text-base font-bold text-foreground flex items-center gap-2">
							<Replace size={16} />
							{t(OrdersKeys.SUB_DIALOG_TITLE)}
						</h2>
						<p className="mt-1 text-xs text-muted-foreground">
							{t(OrdersKeys.SUB_DIALOG_SUBTITLE, { name: target.menuItemName })}
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground"
						aria-label={t(OrdersKeys.SUB_DIALOG_DISMISS)}
					>
						<X size={16} />
					</button>
				</div>

				{candidates.length === 0 ? (
					<p className="text-sm text-faint-foreground">{t(OrdersKeys.SUB_DIALOG_EMPTY)}</p>
				) : (
					<div className="space-y-1 max-h-72 overflow-y-auto" role="listbox">
						{candidates.map((item) => {
							const delta = item.basePrice * target.quantity - target.lineTotal;
							const fee = Math.round(delta * PLATFORM_APPLICATION_FEE_RATE);
							const isSelected = selectedId === item._id;
							return (
								<button
									key={item._id}
									type="button"
									role="option"
									aria-selected={isSelected}
									onClick={() => setSelectedId(item._id)}
									className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-sm border ${
										isSelected
											? "border-foreground bg-muted text-foreground"
											: "border-border text-muted-foreground hover:bg-(--bg-hover)"
									}`}
								>
									<span className="min-w-0 truncate">
										{item.name}
										<span className="ml-1 text-xs text-faint-foreground">
											${formatCents(item.basePrice)}
										</span>
									</span>
									<span className="shrink-0 text-xs font-medium">
										{delta === 0
											? t(OrdersKeys.SUB_DELTA_FREE)
											: t(OrdersKeys.SUB_DELTA_PREVIEW, {
													amount: formatCents(delta),
													fee: formatCents(fee),
												})}
									</span>
								</button>
							);
						})}
					</div>
				)}

				{error && (
					<div className="px-3 py-2 rounded-lg text-xs text-destructive bg-destructive-subtle">
						{error}
					</div>
				)}

				<div className="flex gap-2">
					<button
						type="button"
						onClick={handleConfirm}
						disabled={!selectedId || submitting}
						className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium hover-btn-primary disabled:opacity-50"
					>
						{submitting ? (
							<Loader2 size={14} className="animate-spin" />
						) : (
							t(OrdersKeys.SUB_DIALOG_CONFIRM)
						)}
					</button>
					<button
						type="button"
						onClick={onClose}
						disabled={submitting}
						className="flex-1 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground disabled:opacity-50"
					>
						{t(OrdersKeys.SUB_DIALOG_DISMISS)}
					</button>
				</div>
			</div>
		</div>
	);
}
