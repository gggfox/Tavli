/**
 * Translation keys for the manager's notification bell (TAVLI-111).
 *
 * The `KIND_*` values are deliberately not the source of truth: the backend
 * stores an i18n key on every notification row (`NOTIFICATION_TITLE_KEY` and
 * `NOTIFICATION_BODY_KEY` in `convex/constants.ts`), and this enum restates
 * those same strings so `locales.test.ts` can prove that every kind resolves in
 * `en.json` and `es.json`. A kind added to the backend without copy here is a
 * red test, not a blank line in somebody's bell.
 *
 * Note that a kind's default **body** takes no interpolation. A caller may pass
 * its own `messageKey` with params (TAVLI-103/102 will, for amounts), but the
 * default has to render as a sentence for a caller that passes none — otherwise
 * a manager reads a literal `{{amount}}`.
 *
 * Separate from `AlertsKeys`, which is the operator's inbox. The two surfaces
 * never mix, so neither does their copy.
 */
export const NotificationsKeys = {
	// The bell and its panel
	BELL_LABEL: "notifications.bell.label",
	BELL_UNREAD_COUNT: "notifications.bell.unreadCount",
	BELL_PANEL_TITLE: "notifications.bell.panelTitle",
	BELL_CLOSE: "notifications.bell.close",
	BELL_MARK_ALL_READ: "notifications.bell.markAllRead",
	BELL_MARK_READ: "notifications.bell.markRead",
	BELL_EMPTY_TITLE: "notifications.bell.emptyTitle",
	BELL_EMPTY_DESCRIPTION: "notifications.bell.emptyDescription",
	BELL_LOAD_FAILED: "notifications.bell.loadFailed",

	// Kinds — title + one-line body, mirroring convex/constants.ts
	KIND_DISPUTE_OPENED_TITLE: "notifications.kind.disputeOpened.title",
	KIND_DISPUTE_OPENED_BODY: "notifications.kind.disputeOpened.body",
	KIND_DISPUTE_WON_TITLE: "notifications.kind.disputeWon.title",
	KIND_DISPUTE_WON_BODY: "notifications.kind.disputeWon.body",
	KIND_DISPUTE_LOST_TITLE: "notifications.kind.disputeLost.title",
	KIND_DISPUTE_LOST_BODY: "notifications.kind.disputeLost.body",
	KIND_PAYOUT_FAILED_TITLE: "notifications.kind.payoutFailed.title",
	KIND_PAYOUT_FAILED_BODY: "notifications.kind.payoutFailed.body",
	KIND_PAYOUTS_RESUMED_TITLE: "notifications.kind.payoutsResumed.title",
	KIND_PAYOUTS_RESUMED_BODY: "notifications.kind.payoutsResumed.body",
} as const;

export type NotificationsKey = (typeof NotificationsKeys)[keyof typeof NotificationsKeys];
