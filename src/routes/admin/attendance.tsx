import { useRestaurant } from "@/features/restaurants";
import { useCurrentUserRoles } from "@/features/users/hooks";
import { AdminPageLayout, AppDatePicker, DialogHeader, Drawer, LoadingState } from "@/global/components";
import { useIsNarrowViewport } from "@/global/hooks";
import { todayLocalYmd } from "@/global/utils/calendarMonth";
import { AdminStaffKeys, SidebarKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import {
	ABSENCE_REQUEST_STATUS,
	ABSENCE_TYPE,
	type AbsenceType,
	RESTAURANT_MEMBER_ROLE,
	USER_ROLES,
} from "convex/constants";
import { useConvexAuth } from "convex/react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/attendance")({
	component: AdminAttendancePage,
});

const SELF_SERVICE_ABSENCE_TYPES = [
	ABSENCE_TYPE.VACATION,
	ABSENCE_TYPE.SICK,
	ABSENCE_TYPE.OTHER,
] as const satisfies readonly AbsenceType[];

const attendanceRequestDateId = "attendance-absence-date";

function AdminAttendancePage() {
	const { t, i18n } = useTranslation();
	const { isAuthenticated } = useConvexAuth();
	const { roles, organizationId: userOrgId, isLoading: rolesLoading } = useCurrentUserRoles();
	const { restaurant, isLoading } = useRestaurant();
	const [days, setDays] = useState(7);
	const toMs = Date.now();
	const fromMs = useMemo(() => toMs - days * 24 * 60 * 60 * 1000, [days, toMs]);

	const organizationId = restaurant?.organizationId;
	const orgIdStr = organizationId != null ? String(organizationId) : undefined;
	const isAdmin = roles.includes(USER_ROLES.ADMIN);
	const isOrgOwner =
		roles.includes(USER_ROLES.OWNER) &&
		userOrgId != null &&
		orgIdStr != null &&
		userOrgId === orgIdStr;

	const { data: myMemberships, isLoading: membershipsLoading } = useQuery({
		...convexQuery(api.restaurantMembers.listByUser, {}),
		enabled: isAuthenticated,
		select: unwrapResult<Doc<"restaurantMembers">[]>,
	});

	const managedRestaurantIds = useMemo(() => {
		if (!myMemberships?.length || !organizationId) return [];
		return myMemberships
			.filter(
				(m) =>
					m.isActive &&
					m.role === RESTAURANT_MEMBER_ROLE.MANAGER &&
					m.organizationId === organizationId
			)
			.map((m) => m.restaurantId);
	}, [myMemberships, organizationId]);

	const canViewRestaurantAttendance = Boolean(
		restaurant &&
			(isAdmin ||
				isOrgOwner ||
				(managedRestaurantIds.length > 0 && managedRestaurantIds.includes(restaurant._id)))
	);

	const restaurantId = restaurant?._id;

	const { data: events } = useQuery({
		...convexQuery(
			api.attendance.listClockEventsForRestaurant,
			restaurantId && canViewRestaurantAttendance
				? { restaurantId, fromMs, toMs }
				: "skip"
		),
		select: unwrapResult<Doc<"clockEvents">[]>,
	});

	const { data: absences, refetch: refetchAbsences } = useQuery({
		...convexQuery(
			api.attendance.listAbsencesForRestaurant,
			restaurantId && canViewRestaurantAttendance ? { restaurantId } : "skip"
		),
		select: unwrapResult<Doc<"absences">[]>,
	});

	const { data: myAbsences, refetch: refetchMyAbsences } = useQuery({
		...convexQuery(
			api.attendance.listMyAbsencesForRestaurant,
			restaurantId ? { restaurantId, limit: 60 } : "skip"
		),
		select: unwrapResult<Doc<"absences">[]>,
	});

	const requestAbsence = useMutation({ mutationFn: useConvexMutation(api.attendance.requestAbsence) });

	const [requestOpen, setRequestOpen] = useState(false);
	const [formDate, setFormDate] = useState(todayLocalYmd);
	const [formType, setFormType] = useState<(typeof SELF_SERVICE_ABSENCE_TYPES)[number]>(
		SELF_SERVICE_ABSENCE_TYPES[0]
	);
	const [formReason, setFormReason] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const isNarrowViewport = useIsNarrowViewport();

	const openRequestModal = () => {
		setFormDate(todayLocalYmd());
		setFormType(SELF_SERVICE_ABSENCE_TYPES[0]);
		setFormReason("");
		setFormError(null);
		setRequestOpen(true);
	};

	const onSubmitRequest = async () => {
		if (!restaurantId) return;
		const date = formDate.trim();
		if (!date) {
			setFormError(t(AdminStaffKeys.ATTENDANCE_REQUEST_ERROR_DATE));
			return;
		}
		setFormError(null);
		try {
			unwrapResult(
				await requestAbsence.mutateAsync({
					restaurantId,
					date,
					type: formType,
					reason: formReason.trim() || undefined,
				})
			);
			setRequestOpen(false);
			refetchMyAbsences();
			if (canViewRestaurantAttendance) {
				refetchAbsences();
			}
		} catch (e) {
			setFormError(e instanceof Error ? e.message : String(e));
		}
	};

	const absenceTypeLabel = (type: string) => {
		if (type === ABSENCE_TYPE.VACATION) return t(AdminStaffKeys.ATTENDANCE_TYPE_VACATION);
		if (type === ABSENCE_TYPE.SICK) return t(AdminStaffKeys.ATTENDANCE_TYPE_SICK);
		if (type === ABSENCE_TYPE.OTHER) return t(AdminStaffKeys.ATTENDANCE_TYPE_OTHER);
		return type;
	};

	const absenceStatusLabel = (status: string) => {
		if (status === ABSENCE_REQUEST_STATUS.PENDING) return t(AdminStaffKeys.ATTENDANCE_STATUS_PENDING);
		if (status === ABSENCE_REQUEST_STATUS.APPROVED) return t(AdminStaffKeys.ATTENDANCE_STATUS_APPROVED);
		if (status === ABSENCE_REQUEST_STATUS.DENIED) return t(AdminStaffKeys.ATTENDANCE_STATUS_DENIED);
		return status;
	};

	const pageDescription = canViewRestaurantAttendance
		? t(AdminStaffKeys.ATTENDANCE_DESCRIPTION)
		: t(AdminStaffKeys.ATTENDANCE_DESCRIPTION_EMPLOYEE);

	const waitMemberships = restaurant != null && !isAdmin && !isOrgOwner && membershipsLoading;

	if (isLoading || rolesLoading || waitMemberships) return <LoadingState />;

	if (!restaurant) {
		return (
			<AdminPageLayout
				title={t(SidebarKeys.ATTENDANCE)}
				description={t(AdminStaffKeys.ATTENDANCE_DESCRIPTION_NO_RESTAURANT)}
			>
				<p className="text-sm text-faint-foreground">{t(AdminStaffKeys.ATTENDANCE_NO_RESTAURANT)}</p>
			</AdminPageLayout>
		);
	}

	return (
		<AdminPageLayout title={t(SidebarKeys.ATTENDANCE)} description={pageDescription}>
			{canViewRestaurantAttendance ? (
				<>
					<div className="flex items-center gap-2 mb-4">
						<label className="text-xs text-faint-foreground flex items-center gap-2">
							{t(AdminStaffKeys.ATTENDANCE_RANGE_LABEL)}
							<select
								className="rounded border border-border bg-background px-2 py-1 text-sm"
								value={days}
								onChange={(e) => setDays(Number(e.target.value))}
							>
								<option value={1}>{t(AdminStaffKeys.ATTENDANCE_RANGE_24H)}</option>
								<option value={7}>{t(AdminStaffKeys.ATTENDANCE_RANGE_7D)}</option>
								<option value={30}>{t(AdminStaffKeys.ATTENDANCE_RANGE_30D)}</option>
							</select>
						</label>
					</div>

					<h2 className="text-sm font-semibold mb-2">{t(AdminStaffKeys.ATTENDANCE_CLOCK_EVENTS)}</h2>
					{!events?.length ? (
						<p className="text-sm text-faint-foreground mb-6">{t(AdminStaffKeys.ATTENDANCE_NO_EVENTS)}</p>
					) : (
						<div className="overflow-x-auto rounded border border-border mb-8">
							<table className="w-full text-sm">
								<thead className="bg-muted text-left text-xs uppercase text-faint-foreground">
									<tr>
										<th className="p-2">{t(AdminStaffKeys.ATTENDANCE_COL_MEMBER)}</th>
										<th className="p-2">{t(AdminStaffKeys.ATTENDANCE_COL_TYPE)}</th>
										<th className="p-2">{t(AdminStaffKeys.ATTENDANCE_COL_TIME)}</th>
									</tr>
								</thead>
								<tbody>
									{events
										.slice()
										.sort((a, b) => b.at - a.at)
										.map((e) => (
											<tr key={e._id} className="border-t border-border">
												<td className="p-2 font-mono text-xs">{e.memberId}</td>
												<td className="p-2">{e.type}</td>
												<td className="p-2">{new Date(e.at).toLocaleString()}</td>
											</tr>
										))}
								</tbody>
							</table>
						</div>
					)}

					<h2 className="text-sm font-semibold mb-2">{t(AdminStaffKeys.ATTENDANCE_ABSENCES)}</h2>
					{!absences?.length ? (
						<p className="text-sm text-faint-foreground mb-8">{t(AdminStaffKeys.ATTENDANCE_NO_ABSENCES)}</p>
					) : (
						<div className="overflow-x-auto rounded border border-border mb-8">
							<table className="w-full text-sm">
								<thead className="bg-muted text-left text-xs uppercase text-faint-foreground">
									<tr>
										<th className="p-2">{t(AdminStaffKeys.ATTENDANCE_COL_MEMBER)}</th>
										<th className="p-2">{t(AdminStaffKeys.ATTENDANCE_COL_DATE)}</th>
										<th className="p-2">{t(AdminStaffKeys.ATTENDANCE_COL_TYPE)}</th>
										<th className="p-2">{t(AdminStaffKeys.ATTENDANCE_COL_STATUS)}</th>
									</tr>
								</thead>
								<tbody>
									{absences.map((a) => (
										<tr key={a._id} className="border-t border-border">
											<td className="p-2 font-mono text-xs">{a.memberId}</td>
											<td className="p-2">{a.date}</td>
											<td className="p-2">{absenceTypeLabel(a.type)}</td>
											<td className="p-2">{absenceStatusLabel(a.status)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</>
			) : null}

			<div className="flex flex-wrap items-center justify-between gap-3 mb-3">
				<h2 className="text-sm font-semibold">{t(AdminStaffKeys.ATTENDANCE_MY_ABSENCES)}</h2>
				<button
					type="button"
					onClick={openRequestModal}
					className="text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-background hover:bg-(--bg-hover)"
				>
					{t(AdminStaffKeys.ATTENDANCE_REQUEST_OPEN)}
				</button>
			</div>
			{!myAbsences?.length ? (
				<p className="text-sm text-faint-foreground mb-4">{t(AdminStaffKeys.ATTENDANCE_MY_ABSENCES_EMPTY)}</p>
			) : (
				<div className="overflow-x-auto rounded border border-border mb-4">
					<table className="w-full text-sm">
						<thead className="bg-muted text-left text-xs uppercase text-faint-foreground">
							<tr>
								<th className="p-2">{t(AdminStaffKeys.ATTENDANCE_COL_DATE)}</th>
								<th className="p-2">{t(AdminStaffKeys.ATTENDANCE_COL_TYPE)}</th>
								<th className="p-2">{t(AdminStaffKeys.ATTENDANCE_COL_STATUS)}</th>
							</tr>
						</thead>
						<tbody>
							{myAbsences.map((a) => (
								<tr key={a._id} className="border-t border-border">
									<td className="p-2">{a.date}</td>
									<td className="p-2">{absenceTypeLabel(a.type)}</td>
									<td className="p-2">{absenceStatusLabel(a.status)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<Drawer
				isOpen={requestOpen}
				onClose={() => setRequestOpen(false)}
				ariaLabel={t(AdminStaffKeys.ATTENDANCE_REQUEST_MODAL_TITLE)}
				side={isNarrowViewport ? "bottom" : "right"}
				size={isNarrowViewport ? "90dvh" : "40%"}
				swipeToClose={isNarrowViewport}
				swipeHandleAriaLabel={t(AdminStaffKeys.ATTENDANCE_REQUEST_DRAWER_SWIPE_HANDLE)}
				panelClassName="bg-background border border-border overflow-hidden"
			>
				<DialogHeader title={t(AdminStaffKeys.ATTENDANCE_REQUEST_MODAL_TITLE)} onClose={() => setRequestOpen(false)} />
				<div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-3">
					<p className="text-xs text-faint-foreground">{t(AdminStaffKeys.ATTENDANCE_REQUEST_ONE_DAY_NOTE)}</p>
					<AppDatePicker
						id={attendanceRequestDateId}
						label={t(AdminStaffKeys.ATTENDANCE_REQUEST_DATE_LABEL)}
						value={formDate}
						onChange={setFormDate}
						localeTag={i18n.language}
						embedded
					/>
					<label className="block text-xs font-medium text-foreground">
						{t(AdminStaffKeys.ATTENDANCE_REQUEST_TYPE_LABEL)}
						<select
							value={formType}
							onChange={(e) => setFormType(e.target.value as (typeof SELF_SERVICE_ABSENCE_TYPES)[number])}
							className="mt-1 block w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
						>
							{SELF_SERVICE_ABSENCE_TYPES.map((type) => (
								<option key={type} value={type}>
									{absenceTypeLabel(type)}
								</option>
							))}
						</select>
					</label>
					<label className="block text-xs font-medium text-foreground">
						{t(AdminStaffKeys.ATTENDANCE_REQUEST_REASON_LABEL)}
						<textarea
							value={formReason}
							onChange={(e) => setFormReason(e.target.value)}
							placeholder={t(AdminStaffKeys.ATTENDANCE_REQUEST_REASON_PLACEHOLDER)}
							rows={3}
							className="mt-1 block w-full rounded border border-border bg-background px-2 py-1.5 text-sm resize-y min-h-16"
						/>
					</label>
					{formError ? <p className="text-xs text-destructive">{formError}</p> : null}
					<div className="flex justify-end gap-2 pt-2">
						<button
							type="button"
							onClick={() => setRequestOpen(false)}
							className="text-xs font-medium px-3 py-1.5 rounded-md border border-border hover:bg-(--bg-hover)"
						>
							{t(AdminStaffKeys.ATTENDANCE_REQUEST_CANCEL)}
						</button>
						<button
							type="button"
							onClick={() => void onSubmitRequest()}
							disabled={requestAbsence.isPending}
							className="text-xs font-medium px-3 py-1.5 rounded-md border border-primary bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
						>
							{t(AdminStaffKeys.ATTENDANCE_REQUEST_SUBMIT)}
						</button>
					</div>
				</div>
			</Drawer>
		</AdminPageLayout>
	);
}
