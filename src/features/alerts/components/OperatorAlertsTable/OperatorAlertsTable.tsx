/**
 * `/admin/alerts` — the operator's inbox (TAVLI-109).
 *
 * Open alerts come first and newest first; `api.operatorAlerts.list` already
 * returns them in that order, so the table's initial sort is deliberately
 * empty. An operator who sorts by a column is choosing something else; one who
 * has not should see the thing that needs them at the top.
 *
 * Built on `AdminTable` + `useAdminTable` like the spend allowlist: this is a
 * real list of rows with an action on each, not a registry rendered from code.
 */
import { AdminTable, InlineError } from "@/global/components";
import { formInputClasses, formInputStyle } from "@/global/components/Form/styles";
import { useAdminTable } from "@/global/hooks";
import { AlertsKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import {
	OPERATOR_ALERT_SEVERITIES,
	OPERATOR_ALERT_STATUS,
	type OperatorAlertSeverity,
} from "convex/constants";
import { BellRing } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ALERT_FILTER_ALL, ALERT_FILTER_NO_RESTAURANT, SEVERITY_LABEL_KEY } from "../../constants";
import {
	ALERT_RESTAURANT_COLUMN_ID,
	ALERT_SEVERITY_COLUMN_ID,
	buildColumns,
	type OperatorAlertRow,
} from "./Columns";

export function OperatorAlertsTable() {
	const { t } = useTranslation();

	const [error, setError] = useState<string | null>(null);
	const [pendingId, setPendingId] = useState<string | null>(null);

	const columns = useMemo(() => buildColumns(t), [t]);

	const tableState = useAdminTable<OperatorAlertRow>({
		queryOptions: convexQuery(api.operatorAlerts.list, {}),
		columns,
		getRowId: (row) => row._id,
	});

	const acknowledge = useMutation({
		mutationFn: useConvexMutation(api.operatorAlerts.acknowledge),
	});

	const rows = useMemo(() => tableState.data ?? [], [tableState.data]);

	// The filters live in the table's own column-filter state rather than in
	// local `useState`, so the select and the rows it is supposed to be
	// filtering can never drift apart.
	const filterValue = (columnId: string) =>
		(tableState.columnFilters.find((f) => f.id === columnId)?.value as string | undefined) ??
		ALERT_FILTER_ALL;

	const setFilter = (columnId: string, value: string) => {
		tableState.setColumnFilters((previous) => {
			const rest = previous.filter((f) => f.id !== columnId);
			return value === ALERT_FILTER_ALL ? rest : [...rest, { id: columnId, value }];
		});
	};

	// Only restaurants that actually have an alert: a select listing every
	// restaurant on the platform would mostly be options that filter to nothing.
	const restaurantOptions = useMemo(() => {
		const byId = new Map<string, string>();
		for (const row of rows) {
			if (!row.restaurantId) continue;
			byId.set(String(row.restaurantId), row.restaurantName ?? String(row.restaurantId));
		}
		return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
	}, [rows]);

	const hasUnattributedAlert = rows.some((row) => !row.restaurantId);

	const handleAcknowledge = async (alertId: Id<"operatorAlerts">) => {
		setError(null);
		setPendingId(alertId);
		try {
			unwrapResult(await acknowledge.mutateAsync({ alertId }));
		} catch (err) {
			setError(getErrorMessage(err, t));
		} finally {
			setPendingId(null);
		}
	};

	return (
		<div className="flex flex-col flex-1 h-full min-h-0 gap-4">
			{error && <InlineError message={error} onDismiss={() => setError(null)} />}

			<div className="flex flex-wrap items-end gap-3">
				<label
					htmlFor="alerts-severity"
					className="flex flex-col gap-1 text-xs text-muted-foreground"
				>
					<span>{t(AlertsKeys.FILTER_SEVERITY)}</span>
					<select
						id="alerts-severity"
						value={filterValue(ALERT_SEVERITY_COLUMN_ID)}
						onChange={(e) => setFilter(ALERT_SEVERITY_COLUMN_ID, e.target.value)}
						className={formInputClasses}
						style={formInputStyle}
					>
						<option value={ALERT_FILTER_ALL}>{t(AlertsKeys.FILTER_ALL_SEVERITIES)}</option>
						{OPERATOR_ALERT_SEVERITIES.map((value) => (
							<option key={value} value={value}>
								{t(SEVERITY_LABEL_KEY[value as OperatorAlertSeverity])}
							</option>
						))}
					</select>
				</label>

				<label
					htmlFor="alerts-restaurant"
					className="flex flex-col gap-1 text-xs text-muted-foreground"
				>
					<span>{t(AlertsKeys.FILTER_RESTAURANT)}</span>
					<select
						id="alerts-restaurant"
						value={filterValue(ALERT_RESTAURANT_COLUMN_ID)}
						onChange={(e) => setFilter(ALERT_RESTAURANT_COLUMN_ID, e.target.value)}
						className={formInputClasses}
						style={formInputStyle}
					>
						<option value={ALERT_FILTER_ALL}>{t(AlertsKeys.FILTER_ALL_RESTAURANTS)}</option>
						{hasUnattributedAlert ? (
							<option value={ALERT_FILTER_NO_RESTAURANT}>
								{t(AlertsKeys.FILTER_NO_RESTAURANT)}
							</option>
						) : null}
						{restaurantOptions.map(([id, name]) => (
							<option key={id} value={id}>
								{name}
							</option>
						))}
					</select>
				</label>
			</div>

			<AdminTable
				tableState={tableState}
				entityName={t(AlertsKeys.PAGE_ENTITY)}
				searchPlaceholder={t(AlertsKeys.PAGE_SEARCH_PLACEHOLDER)}
				getResultCountText={(count) => t(AlertsKeys.PAGE_RESULT_COUNT, { count })}
				emptyIcon={BellRing}
				emptyTitle={t(AlertsKeys.PAGE_EMPTY_TITLE)}
				emptyDescription={t(AlertsKeys.PAGE_EMPTY_DESCRIPTION)}
				filteredEmptyTitle={t(AlertsKeys.PAGE_FILTERED_EMPTY_TITLE)}
				notAuthenticatedMessage={t(AlertsKeys.PAGE_NOT_AUTHENTICATED)}
				renderRowActions={(row) =>
					row.status === OPERATOR_ALERT_STATUS.OPEN ? (
						<div className="flex justify-end">
							<button
								type="button"
								disabled={pendingId === row._id}
								onClick={(e) => {
									e.stopPropagation();
									void handleAcknowledge(row._id);
								}}
								className="px-3 py-1.5 rounded-md text-sm font-medium hover-btn-secondary disabled:opacity-60"
							>
								{t(AlertsKeys.ACTION_ACKNOWLEDGE)}
							</button>
						</div>
					) : null
				}
			/>
		</div>
	);
}
