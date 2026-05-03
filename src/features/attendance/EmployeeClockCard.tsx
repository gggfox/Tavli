import { useRestaurant } from "@/features/restaurants";
import { SidebarKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { CLOCK_EVENT_TYPE } from "convex/constants";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";

interface EmployeeClockCardProps {
	readonly isExpanded: boolean;
}

function deriveClockedIn(events: { type: string }[] | undefined): boolean | null {
	if (!events?.length) return false;
	const last = events[0];
	return last.type === CLOCK_EVENT_TYPE.IN;
}

/**
 * Quick clock in/out for the restaurant selected in the staff sidebar (persisted).
 */
export function EmployeeClockCard({ isExpanded }: Readonly<EmployeeClockCardProps>) {
	const { t } = useTranslation();
	const { restaurant } = useRestaurant();
	const restaurantId = restaurant?._id;

	const { data: eventsTuple, isLoading } = useQuery({
		...convexQuery(
			api.attendance.listMyClockEventsForRestaurant,
			restaurantId ? { restaurantId, limit: 20 } : "skip"
		),
	});

	const events = eventsTuple && !eventsTuple[1] ? eventsTuple[0] : undefined;
	const clockedIn = deriveClockedIn(events);
	const hasError = eventsTuple?.[1] != null;

	const clockIn = useMutation({ mutationFn: useConvexMutation(api.attendance.clockIn) });
	const clockOut = useMutation({ mutationFn: useConvexMutation(api.attendance.clockOut) });

	if (!restaurantId || hasError) return null;

	const onClockIn = async () => {
		unwrapResult(await clockIn.mutateAsync({ restaurantId }));
	};
	const onClockOut = async () => {
		unwrapResult(await clockOut.mutateAsync({ restaurantId }));
	};

	if (isLoading) {
		return isExpanded ? (
			<div className="px-3 py-2 border-t border-border text-xs text-faint-foreground">
				{t(SidebarKeys.CLOCK_LOADING)}
			</div>
		) : null;
	}

	return (
		<div className="px-2 py-2 border-t border-border">
			<div
				className={`flex items-center gap-2 ${isExpanded ? "px-2" : "justify-center"}`}
				title={t(SidebarKeys.CLOCK_TITLE)}
			>
				<Clock size={16} className="shrink-0 text-primary" />
				{isExpanded && (
					<div className="flex-1 min-w-0">
						<div className="text-xs font-medium text-foreground">{t(SidebarKeys.CLOCK_TITLE)}</div>
						<div className="text-[10px] text-faint-foreground truncate">{restaurant?.name}</div>
					</div>
				)}
				{clockedIn === true || clockedIn === false ? (
					<button
						type="button"
						onClick={clockedIn ? onClockOut : onClockIn}
						disabled={clockIn.isPending || clockOut.isPending}
						className="shrink-0 text-xs font-medium px-2 py-1 rounded-md border border-border hover:bg-(--bg-hover) disabled:opacity-50"
					>
						{clockedIn ? t(SidebarKeys.CLOCK_OUT) : t(SidebarKeys.CLOCK_IN)}
					</button>
				) : null}
			</div>
		</div>
	);
}
