/**
 * The manager's notification bell (TAVLI-111).
 *
 * Mounted in the staff header — the sidebar's top row, which is the one piece of
 * chrome present on every restaurant admin page and on none of the diner pages
 * (`/r/*` renders no sidebar at all). The badge is therefore live everywhere a
 * manager works: `api.notifications.unreadCount` is a Convex subscription, so a
 * chargeback opened while they are on the schedule screen turns the badge red
 * without a reload.
 *
 * Three decisions worth knowing:
 *
 * 1. **The panel is portalled to `document.body` and positioned from the bell's
 *    own rect.** That is not decoration: `SidebarContainer` is `overflow-hidden`
 *    because it animates its width, so an ordinary absolutely positioned panel
 *    would be clipped to the 64px rail when collapsed. The viewport-aware maths
 *    is `resolveAnchoredPopoverPosition`, shared with the timeline's date picker;
 *    only the escape hatch differs — a portal rather than `popover="manual"`,
 *    because jsdom implements no Popover API, and a bell that cannot be tested
 *    is a bell whose badge silently stops counting.
 * 2. **The list is only subscribed to while the panel is open.** The badge has to
 *    be live on every page; fifty rows and their restaurant lookups do not.
 * 3. **Nothing here is an operator alert.** `/admin/alerts` (TAVLI-109) is
 *    Tavli's own inbox across every restaurant, and it stays out of this bell
 *    deliberately and permanently.
 */
import { useClickOutside, useEscapeKey } from "@/global/hooks";
import { NotificationsKeys } from "@/global/i18n";
import {
	resolveAnchoredPopoverPosition,
	type ResolvedAnchoredPopoverPosition,
} from "@/global/utils/anchoredPopoverPosition";
import { getRelativeTime, unwrapResult, type UnwrappedValue } from "@/global/utils";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { NOTIFICATION_TITLE_KEY, type NotificationKind } from "convex/constants";
import { useConvexAuth } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Bell, X } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
	NOTIFICATION_BADGE_MAX,
	NOTIFICATION_KIND_ICON,
	NOTIFICATION_KIND_ICON_CLASS,
} from "../../constants";

type NotificationRow = UnwrappedValue<
	FunctionReturnType<typeof api.notifications.listMine>
>[number];

export function NotificationBell() {
	const { t } = useTranslation();
	const { isAuthenticated } = useConvexAuth();

	const [isOpen, setIsOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	const { data: unread } = useQuery({
		...convexQuery(api.notifications.unreadCount, {}),
		enabled: isAuthenticated,
		select: unwrapResult<number>,
	});

	// Only while the panel is open: the badge is what every page pays for.
	const { data: rows, error: listError } = useQuery({
		...convexQuery(api.notifications.listMine, {}),
		enabled: isAuthenticated && isOpen,
		select: unwrapResult<NotificationRow[]>,
	});

	const markRead = useMutation({ mutationFn: useConvexMutation(api.notifications.markRead) });
	const markAllRead = useMutation({
		mutationFn: useConvexMutation(api.notifications.markAllRead),
	});

	const close = useCallback(() => {
		setIsOpen(false);
		setError(null);
	}, []);

	const dismissRefs = useMemo(() => [triggerRef, panelRef], []);
	useEscapeKey(close, { enabled: isOpen });
	useClickOutside(dismissRefs, close, { enabled: isOpen });

	/**
	 * Measure once the panel is in the DOM, then place it. Hidden until measured,
	 * so nobody sees it land. `resolveAnchoredPopoverPosition` is the shared maths:
	 * it flips above the bell when the list is taller than the space below, and
	 * clamps to the viewport gutter — which is what keeps the panel on screen when
	 * the bell sits on a 64px collapsed rail at the very left edge.
	 */
	const [position, setPosition] = useState<ResolvedAnchoredPopoverPosition | null>(null);
	const measure = useCallback(() => {
		const trigger = triggerRef.current;
		const panel = panelRef.current;
		if (!trigger || !panel) return;
		setPosition(
			resolveAnchoredPopoverPosition({
				triggerRect: trigger.getBoundingClientRect(),
				panelRect: panel.getBoundingClientRect(),
				viewportWidth: globalThis.window.innerWidth,
				viewportHeight: globalThis.window.innerHeight,
			})
		);
	}, []);

	useLayoutEffect(() => {
		if (!isOpen) {
			setPosition(null);
			return;
		}
		measure();
		globalThis.window.addEventListener("resize", measure);
		globalThis.window.addEventListener("scroll", measure, true);
		return () => {
			globalThis.window.removeEventListener("resize", measure);
			globalThis.window.removeEventListener("scroll", measure, true);
		};
	}, [isOpen, measure]);

	const handleMarkRead = async (notificationId: Id<"notifications">) => {
		setError(null);
		try {
			unwrapResult(await markRead.mutateAsync({ notificationId }));
		} catch (err) {
			setError(getErrorMessage(err, t));
		}
	};

	const handleMarkAllRead = async () => {
		setError(null);
		try {
			unwrapResult(await markAllRead.mutateAsync({}));
		} catch (err) {
			setError(getErrorMessage(err, t));
		}
	};

	// Every hook first, so their order never depends on auth state.
	if (!isAuthenticated) return null;

	const unreadTotal = unread ?? 0;
	const badgeLabel =
		unreadTotal > NOTIFICATION_BADGE_MAX ? `${NOTIFICATION_BADGE_MAX}+` : String(unreadTotal);
	const bellLabel =
		unreadTotal > 0
			? t(NotificationsKeys.BELL_UNREAD_COUNT, { count: unreadTotal })
			: t(NotificationsKeys.BELL_LABEL);
	const visibleRows = listError ? [] : (rows ?? []);

	return (
		<div className="relative">
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setIsOpen((open) => !open)}
				aria-label={bellLabel}
				aria-haspopup="dialog"
				aria-expanded={isOpen}
				title={bellLabel}
				className="relative p-1.5 rounded-md hover-icon"
			>
				<Bell size={18} />
				{unreadTotal > 0 && (
					<span
						// Decoration: the number a screen reader hears is on the button's
						// own label, which is not capped at 99.
						aria-hidden
						className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4 bg-destructive text-white"
					>
						{badgeLabel}
					</span>
				)}
			</button>

			{isOpen && typeof document !== "undefined"
				? createPortal(
						<div
							ref={panelRef}
							role="dialog"
							aria-label={t(NotificationsKeys.BELL_PANEL_TITLE)}
							className="flex max-h-[70vh] w-[min(100vw-2rem,21rem)] flex-col overflow-hidden rounded-lg text-foreground"
							style={{
								position: "fixed",
								top: position?.top ?? -9999,
								left: position?.left ?? -9999,
								margin: 0,
								visibility: position === null ? "hidden" : "visible",
								backgroundColor: "var(--bg-secondary)",
								border: "1px solid var(--border-default)",
								boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
							}}
						>
							<div className="flex items-center gap-2 border-b border-border px-3 py-2">
								<span className="text-sm font-medium">{t(NotificationsKeys.BELL_PANEL_TITLE)}</span>
								{unreadTotal > 0 && (
									<button
										type="button"
										onClick={() => void handleMarkAllRead()}
										className="ml-auto text-xs font-medium text-primary hover:underline"
									>
										{t(NotificationsKeys.BELL_MARK_ALL_READ)}
									</button>
								)}
								<button
									type="button"
									onClick={close}
									aria-label={t(NotificationsKeys.BELL_CLOSE)}
									className={`p-1 rounded-md hover-icon ${unreadTotal > 0 ? "" : "ml-auto"}`}
								>
									<X size={14} />
								</button>
							</div>

							{error && (
								<p role="alert" className="px-3 py-2 text-xs text-destructive">
									{error}
								</p>
							)}

							<div className="min-h-0 flex-1 overflow-y-auto">
								{listError ? (
									<p className="px-3 py-6 text-center text-xs text-muted-foreground">
										{t(NotificationsKeys.BELL_LOAD_FAILED)}
									</p>
								) : visibleRows.length === 0 ? (
									<div className="px-3 py-6 text-center">
										<p className="text-sm font-medium">{t(NotificationsKeys.BELL_EMPTY_TITLE)}</p>
										<p className="mt-1 text-xs text-muted-foreground">
											{t(NotificationsKeys.BELL_EMPTY_DESCRIPTION)}
										</p>
									</div>
								) : (
									<ul className="divide-y divide-border">
										{visibleRows.map((row) => (
											<NotificationItem
												key={row._id}
												row={row}
												onOpen={() => void handleMarkRead(row._id)}
												onNavigate={close}
											/>
										))}
									</ul>
								)}
							</div>
						</div>,
						document.body
					)
				: null}
		</div>
	);
}

/**
 * One row. Clicking it marks it read and, when the notification carries an
 * `href`, follows it — the point of "your payout failed" is to land on the page
 * that says what to do about it. The separate mark-read control is for the other
 * case: acknowledging news you do not intend to act on right now.
 */
function NotificationItem({
	row,
	onOpen,
	onNavigate,
}: Readonly<{
	row: NotificationRow;
	onOpen: () => void;
	onNavigate: () => void;
}>) {
	const { t } = useTranslation();
	const kind = row.kind as NotificationKind;
	const Icon = NOTIFICATION_KIND_ICON[kind];
	const isUnread = row.readAt == null;
	const relative = getRelativeTime(row.createdAt, Date.now());

	const body: ReactNode = (
		<span className="flex items-start gap-2.5 text-left">
			<Icon
				size={16}
				className={`mt-0.5 shrink-0 ${NOTIFICATION_KIND_ICON_CLASS[kind]}`}
				aria-hidden
			/>
			<span className="min-w-0 flex-1">
				<span className={`block text-sm ${isUnread ? "font-semibold" : "font-medium"}`}>
					{t(NOTIFICATION_TITLE_KEY[kind])}
				</span>
				{/* The stored key, translated here — the backend never sends prose. */}
				<span className="mt-0.5 block text-xs text-muted-foreground">
					{t(row.messageKey, row.messageParams ?? {})}
				</span>
				<span className="mt-1 block text-[11px] text-faint-foreground">
					{[row.restaurantName, t(relative.key, relative.vars)].filter(Boolean).join(" · ")}
				</span>
			</span>
			{isUnread && (
				<span className="mt-1.5 size-2 shrink-0 rounded-full bg-destructive" aria-hidden />
			)}
		</span>
	);

	const itemClasses = `block w-full px-3 py-2.5 transition-colors hover:bg-(--bg-hover) ${
		isUnread ? "" : "opacity-80"
	}`;

	return (
		<li>
			{row.href ? (
				<Link
					to={row.href}
					onClick={() => {
						onOpen();
						onNavigate();
					}}
					className={itemClasses}
				>
					{body}
				</Link>
			) : (
				<button type="button" onClick={onOpen} className={itemClasses}>
					{body}
				</button>
			)}
			{isUnread && (
				<div className="px-3 pb-2">
					<button
						type="button"
						onClick={onOpen}
						className="text-[11px] font-medium text-muted-foreground hover:underline"
					>
						{t(NotificationsKeys.BELL_MARK_READ)}
					</button>
				</div>
			)}
		</li>
	);
}
