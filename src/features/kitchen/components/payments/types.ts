/**
 * Row shapes for the staff Payments ledger (`orders.getPaymentsLedgerByRestaurant`).
 *
 * Under ADR 008 the ledger is not "one row per paid order" any more: a
 * post-visit tip is its own `payments` row with no order behind it, so rows
 * carry `rowKind` and the table labels them differently. A pre-pivot tab
 * settlement is split the same way — its covered orders are order rows and its
 * gratuity is one tip row — so no payment's money is reported twice.
 */
import type { Doc } from "convex/_generated/dataModel";

type LiveNameDescriptionTranslations = Record<string, { name?: string; description?: string }>;

export type PaymentsLedgerItem = Doc<"orderItems"> & {
	readonly menuItemTranslations?: LiveNameDescriptionTranslations;
};

/** `PAYMENT_KIND.ORDER` / `PAYMENT_KIND.TIP` — the two ledger row kinds. */
export type PaymentsLedgerRowKind = "order" | "tip";

export type PaymentsLedgerRow = {
	/** Order id for `order` rows, payment id for `tip` rows. */
	readonly id: string;
	readonly rowKind: PaymentsLedgerRowKind;
	readonly dailyOrderNumber: number | null;
	readonly paidAt: number | null;
	readonly tableNumber: number;
	/** "stripe" | "staff" — "staff" is cash collected in person (no Stripe row). */
	readonly settledBy: string | null;
	/** Food the restaurant sold, in cents. Always 0 on tip rows. */
	readonly subtotalCents: number;
	/** Customer-borne Tavli fee; `null` when no fee-split payment backs the row. */
	readonly serviceFeeCents: number | null;
	readonly tipCents: number;
	/** Total charged to the diner on this row. */
	readonly chargedCents: number;
	/** Subtotal + tip; `null` on legacy rows whose commission was never recorded. */
	readonly netToRestaurantCents: number | null;
	readonly items: ReadonlyArray<PaymentsLedgerItem>;
};
