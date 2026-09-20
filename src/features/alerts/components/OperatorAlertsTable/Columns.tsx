import { CopyableId } from "@/global/components";
import { AlertsKeys } from "@/global/i18n";
import { formatDate, getDisplayTimestamp } from "@/global/utils/date";
import { Link } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import type { Doc } from "convex/_generated/dataModel";
import {
	OPERATOR_ALERT_STATUS,
	OPERATOR_ALERT_TITLE_KEY,
	type OperatorAlertSeverity,
	type OperatorAlertStatus,
} from "convex/constants";
import type { TFunction } from "i18next";
import {
	ALERT_FILTER_NO_RESTAURANT,
	SEVERITY_BADGE_CLASS,
	SEVERITY_LABEL_KEY,
	STATUS_LABEL_KEY,
} from "../../constants";

/** What `api.operatorAlerts.list` hands the page: the row plus a restaurant name. */
export type OperatorAlertRow = Doc<"operatorAlerts"> & {
	restaurantName: string | null;
};

const columnHelper = createColumnHelper<OperatorAlertRow>();

/** Column ids the page's own selects drive through react-table column filters. */
export const ALERT_SEVERITY_COLUMN_ID = "severity";
export const ALERT_RESTAURANT_COLUMN_ID = "restaurantName";

/**
 * The columns are built per render rather than defined once at module scope
 * because every header and cell is translated — a module-level `columns` would
 * freeze whichever language happened to be active when the module loaded.
 */
export function buildColumns(t: TFunction) {
	return [
		columnHelper.accessor("kind", {
			header: t(AlertsKeys.COLUMN_ALERT),
			cell: (info) => {
				const row = info.row.original;
				return (
					<div className="flex flex-col gap-1">
						<span className="text-sm font-medium text-foreground">
							{t(OPERATOR_ALERT_TITLE_KEY[row.kind])}
						</span>
						<span className="text-sm text-muted-foreground">
							{/* The backend stores an i18n key, never a sentence. */}
							{t(row.messageKey, row.messageParams ?? {})}
						</span>
						<AlertLinks row={row} t={t} />
					</div>
				);
			},
		}),
		columnHelper.accessor("severity", {
			id: ALERT_SEVERITY_COLUMN_ID,
			header: t(AlertsKeys.COLUMN_SEVERITY),
			filterFn: (row, _columnId, value) => row.original.severity === value,
			cell: (info) => {
				const severity = info.getValue() as OperatorAlertSeverity;
				return (
					<span
						className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_BADGE_CLASS[severity]}`}
					>
						{t(SEVERITY_LABEL_KEY[severity])}
					</span>
				);
			},
		}),
		columnHelper.accessor("restaurantName", {
			id: ALERT_RESTAURANT_COLUMN_ID,
			header: t(AlertsKeys.COLUMN_RESTAURANT),
			// Filters on the id, not the name: two restaurants can share a name,
			// and an alert with no restaurant has no name to match on at all.
			filterFn: (row, _columnId, value) =>
				value === ALERT_FILTER_NO_RESTAURANT
					? !row.original.restaurantId
					: String(row.original.restaurantId) === value,
			cell: (info) => {
				const row = info.row.original;
				if (!row.restaurantId) return <span className="text-faint-foreground">—</span>;
				return (
					<Link
						to="/admin/restaurants"
						search={{ settings: row.restaurantId, manage: undefined }}
						className="text-sm text-foreground underline underline-offset-2 hover:opacity-80"
					>
						{info.getValue() ?? t(AlertsKeys.LINK_RESTAURANT)}
					</Link>
				);
			},
		}),
		columnHelper.accessor("createdAt", {
			header: t(AlertsKeys.COLUMN_RAISED),
			cell: (info) => (
				<span className="text-sm text-muted-foreground">
					{formatDate(getDisplayTimestamp(info.getValue(), info.row.original._creationTime))}
				</span>
			),
		}),
		columnHelper.accessor("status", {
			header: t(AlertsKeys.COLUMN_STATUS),
			cell: (info) => {
				const row = info.row.original;
				const status = info.getValue() as OperatorAlertStatus;
				return (
					<div className="flex flex-col gap-1">
						<span className="text-sm text-foreground">{t(STATUS_LABEL_KEY[status])}</span>
						{status === OPERATOR_ALERT_STATUS.ACKNOWLEDGED && row.acknowledgedBy ? (
							<span className="text-xs text-faint-foreground">
								{t(AlertsKeys.ACTION_ACKNOWLEDGED_BY, { actor: row.acknowledgedBy })}
							</span>
						) : null}
					</div>
				);
			},
		}),
	];
}

/**
 * Whatever the alert can point at. All three ids are optional — an unmatched
 * charge names a Stripe object and nothing else — so the row shows only the
 * links it actually has, and the raw ids stay copyable for pasting into
 * Stripe.
 */
function AlertLinks({ row, t }: Readonly<{ row: OperatorAlertRow; t: TFunction }>) {
	const hasAny = row.orderId || row.paymentId || row.stripeObjectId;
	if (!hasAny) return null;

	return (
		<div className="flex flex-wrap items-center gap-3 pt-1">
			{row.orderId ? (
				<Link
					to="/admin/orders"
					className="text-xs text-muted-foreground underline underline-offset-2 hover:opacity-80"
				>
					{t(AlertsKeys.LINK_ORDER)}
				</Link>
			) : null}
			{row.paymentId ? (
				// The payments dashboard filters by free text, so the id lands the
				// operator on the row rather than on the whole list.
				<Link
					to="/admin/payments"
					search={{ q: row.paymentId, period: "all" as const }}
					className="text-xs text-muted-foreground underline underline-offset-2 hover:opacity-80"
				>
					{t(AlertsKeys.LINK_PAYMENT)}
				</Link>
			) : null}
			{row.stripeObjectId ? <CopyableId id={row.stripeObjectId} /> : null}
		</div>
	);
}
