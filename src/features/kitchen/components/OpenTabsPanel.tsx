import { VirtualGrid } from "@/global/components";
import { useConvexMutate } from "@/global/hooks";
import { TabsKeys } from "@/global/i18n";
import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { formatCents } from "@/global/utils/money";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, CreditCard, Loader2, Receipt, Users } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

type OpenTabs = UnwrappedValue<FunctionReturnType<typeof api.sessions.getOpenTabsByRestaurant>>;
type OpenTab = NonNullable<OpenTabs>[number];

interface OpenTabsPanelProps {
	restaurantId: Id<"restaurants">;
}

/**
 * Staff view of open tabs (TAVLI-6). There is no card pre-authorization, so
 * a lingering unpaid tab is settled in person and closed manually here.
 */
export function OpenTabsPanel({ restaurantId }: Readonly<OpenTabsPanelProps>) {
	const { t } = useTranslation();
	const [error, setError] = useState<string | null>(null);

	const { data: tabs, isLoading } = useQuery({
		...convexQuery(api.sessions.getOpenTabsByRestaurant, { restaurantId }),
		select: unwrapResult<OpenTabs>,
	});

	const closeTab = useConvexMutate(api.sessions.closeTabAsStaff);

	const handleClose = useCallback(
		async (sessionId: Id<"sessions">) => {
			if (!globalThis.confirm(t(TabsKeys.CLOSE_TAB_CONFIRM))) return;
			setError(null);
			try {
				unwrapResult(await closeTab.mutateAsync({ sessionId }));
			} catch {
				setError(t(TabsKeys.CLOSE_FAILED));
			}
		},
		[closeTab, t]
	);

	const renderTabCard = useCallback(
		(tab: OpenTab) => (
			<TabCard tab={tab} onClose={() => handleClose(tab.sessionId)} closing={closeTab.isPending} />
		),
		[handleClose, closeTab.isPending]
	);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-16">
				<Loader2 size={24} className="animate-spin text-faint-foreground" />
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<h2 className="text-lg font-bold text-foreground">{t(TabsKeys.HEADER)}</h2>

			{error && (
				<div
					className="px-4 py-3 rounded-lg text-sm text-destructive"
					style={{ backgroundColor: "rgba(220, 38, 38, 0.1)" }}
				>
					{error}
				</div>
			)}

			{(tabs ?? []).length === 0 && (
				<div className="py-12 flex flex-col items-center gap-2 rounded-xl bg-muted">
					<Receipt size={32} className="text-faint-foreground" />
					<p className="text-sm text-faint-foreground">{t(TabsKeys.EMPTY)}</p>
				</div>
			)}

			{/* Virtualized: open tabs accumulate across a service and each card
			    holds a live subscription's worth of derived state. */}
			<VirtualGrid
				items={tabs ?? []}
				getKey={(tab) => tab.sessionId}
				renderItem={renderTabCard}
				gap={12}
				estimateRowHeight={190}
			/>
		</div>
	);
}

function TabCard({
	tab,
	onClose,
	closing,
}: Readonly<{
	tab: OpenTab;
	onClose: () => void;
	closing: boolean;
}>) {
	const { t, i18n } = useTranslation();
	const openedAt = new Date(tab.startedAt).toLocaleTimeString(i18n.language, {
		hour: "2-digit",
		minute: "2-digit",
	});

	return (
		<div className="rounded-xl p-4 space-y-3 bg-muted border border-border">
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-semibold text-foreground">
					{tab.tableNumber != null
						? t(TabsKeys.TABLE_LABEL, { number: tab.tableNumber })
						: t(TabsKeys.NO_TABLE)}
				</span>
				<div className="flex items-center gap-1.5">
					{tab.flaggedStaleAt != null && (
						<span
							className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
							style={{ backgroundColor: "rgba(217, 119, 6, 0.12)", color: "var(--accent-warning)" }}
						>
							<AlertTriangle size={11} />
							{t(TabsKeys.STALE_BADGE)}
						</span>
					)}
					{tab.lockedForPayment && (
						<span
							className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
							style={{
								backgroundColor: "rgba(35, 131, 226, 0.12)",
								color: "var(--btn-primary-bg)",
							}}
						>
							<CreditCard size={11} />
							{t(TabsKeys.LOCKED_BADGE)}
						</span>
					)}
				</div>
			</div>

			<div className="flex items-center justify-between text-xs text-muted-foreground">
				<span className="flex items-center gap-1">
					<Users size={12} />
					{t(TabsKeys.MEMBERS, { count: tab.memberCount })}
				</span>
				<span>{t(TabsKeys.ORDERS, { count: tab.orderCount })}</span>
				<span>{t(TabsKeys.OPENED_AT, { time: openedAt })}</span>
			</div>

			{tab.joinCode && (
				<div className="flex items-center justify-between text-xs">
					<span className="text-faint-foreground">{t(TabsKeys.JOIN_CODE)}</span>
					<span className="font-mono font-bold tracking-widest text-foreground">
						{tab.joinCode}
					</span>
				</div>
			)}

			<div className="flex items-center justify-between pt-2 border-t border-border">
				<div className="text-sm">
					<span className="text-xs text-faint-foreground mr-2">{t(TabsKeys.UNPAID_TOTAL)}</span>
					<span className="font-semibold text-foreground">${formatCents(tab.unpaidTotal)}</span>
				</div>
				<button
					type="button"
					onClick={onClose}
					disabled={closing}
					className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-(--bg-hover) text-foreground disabled:opacity-50"
				>
					{t(TabsKeys.CLOSE_TAB)}
				</button>
			</div>
		</div>
	);
}
