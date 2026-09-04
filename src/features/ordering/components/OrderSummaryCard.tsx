/**
 * Hover / long-press summary for one order (TAVLI-99).
 *
 * Replaces navigation as the *default* answer to "what was in that order?".
 * The detail route stays: it is the live status surface, it survives a reload,
 * and it is linkable — none of which a card can be. So the card carries a
 * "View status" link rather than replacing the page.
 *
 * ## Long-press on touch, and the callout menu
 *
 * iOS Safari answers a long press on any element containing text with its own
 * selection/callout menu, on top of whatever the page does. `touch-none` plus
 * `select-none` on the trigger suppresses it — without them a diner holding a
 * card gets the system's copy bubble over our card, and the two fight for the
 * same gesture.
 *
 * Cancelling on move matters as much as firing on hold: a long press that
 * begins during a scroll is a scroll, not a press, and popping a card open
 * under a moving thumb is how a list becomes unusable.
 */
import { OrderingKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** Hold this long before the card opens. Shorter fires while scrolling. */
const LONG_PRESS_MS = 450;
/** Finger travel that turns a press into a scroll. */
const MOVE_CANCEL_PX = 10;

export interface OrderSummaryLine {
	readonly menuItemName: string;
	readonly quantity: number;
	readonly lineTotal: number;
	readonly cancelledAt?: number;
}

interface OrderSummaryCardProps {
	readonly items: readonly OrderSummaryLine[];
	readonly totalAmount: number;
	readonly statusLabel: string;
	readonly onViewStatus: () => void;
	/** The order row this card describes. */
	readonly children: ReactNode;
}

export function OrderSummaryCard({
	items,
	totalAmount,
	statusLabel,
	onViewStatus,
	children,
}: Readonly<OrderSummaryCardProps>) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pressOrigin = useRef<{ x: number; y: number } | null>(null);

	const cancelPress = () => {
		if (pressTimer.current) {
			clearTimeout(pressTimer.current);
			pressTimer.current = null;
		}
		pressOrigin.current = null;
	};

	// Dismiss on an outside tap and on Escape. Without the first, a card opened
	// by a long press has no way to close on touch at all.
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	useEffect(() => cancelPress, []);

	const liveItems = items.filter((item) => item.cancelledAt === undefined);

	return (
		<div
			ref={containerRef}
			className="relative"
			// Mouse only: `onPointerEnter` would also fire for a tap on touch,
			// opening the card on every single tap.
			onMouseEnter={() => setOpen(true)}
			onMouseLeave={() => setOpen(false)}
			onTouchStart={(event) => {
				const touch = event.touches[0];
				pressOrigin.current = { x: touch.clientX, y: touch.clientY };
				pressTimer.current = setTimeout(() => setOpen(true), LONG_PRESS_MS);
			}}
			onTouchMove={(event) => {
				const origin = pressOrigin.current;
				if (!origin) return;
				const touch = event.touches[0];
				if (
					Math.abs(touch.clientX - origin.x) > MOVE_CANCEL_PX ||
					Math.abs(touch.clientY - origin.y) > MOVE_CANCEL_PX
				) {
					cancelPress();
				}
			}}
			onTouchEnd={cancelPress}
			onTouchCancel={cancelPress}
			// Suppresses iOS Safari's own long-press callout, which would
			// otherwise open its copy bubble on top of this card.
			style={{ WebkitTouchCallout: "none" } as React.CSSProperties}
		>
			<div className="select-none">{children}</div>

			{open ? (
				<div
					role="dialog"
					aria-label={t(OrderingKeys.ORDER_SUMMARY_ARIA)}
					className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-border bg-card p-3 shadow-lg"
				>
					<p className="mb-2 text-xs font-semibold text-muted-foreground">{statusLabel}</p>
					<ul className="space-y-1">
						{liveItems.map((item, index) => (
							<li
								key={`${item.menuItemName}-${index}`}
								className="flex justify-between gap-2 text-sm text-muted-foreground"
							>
								<span className="min-w-0 truncate">
									{item.quantity}x {item.menuItemName}
								</span>
								<span className="shrink-0 tabular-nums">${formatCents(item.lineTotal)}</span>
							</li>
						))}
					</ul>
					<div className="mt-2 flex justify-between border-t border-border pt-2 text-sm font-semibold text-foreground">
						<span>{t(OrderingKeys.CHECKOUT_TOTAL)}</span>
						<span className="tabular-nums">${formatCents(totalAmount)}</span>
					</div>
					<button
						type="button"
						onClick={onViewStatus}
						className="mt-2 w-full rounded-lg py-1.5 text-xs font-medium hover-secondary"
					>
						{t(OrderingKeys.ORDER_SUMMARY_VIEW_STATUS)}
					</button>
				</div>
			) : null}
		</div>
	);
}
