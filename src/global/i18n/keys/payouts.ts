/**
 * Translation keys for the payouts page (TAVLI-103).
 *
 * Separate from `PaymentsKeys`. A **payment** is a diner paying the restaurant;
 * a **payout** is the restaurant's balance reaching its bank. They are two
 * different movements of money, two different pages, and mixing their copy is
 * how a manager ends up reading "payment failed" about their own bank account.
 *
 * The `FAILURE_*` values are deliberately not the source of truth:
 * `PAYOUT_FAILURE_REASON_KEY` / `PAYOUT_FAILURE_FIX_KEY` in `convex/constants.ts`
 * hold the mapping from a Stripe `failure_code` to these keys, and
 * `locales.test.ts` proves every code in that closed set resolves in both
 * `en.json` and `es.json`. A code without copy is a red test, not a blank line
 * where the reason should be.
 *
 * Copy order is the ticket's promise and is baked into the key names:
 * `SAFE_LINE` first, then the reason, then the fix.
 */
export const PayoutsKeys = {
	// Page chrome
	PAGE_TITLE: "payouts.page.title",
	PAGE_DESCRIPTION: "payouts.page.description",
	PAGE_ENTITY: "payouts.page.entity",
	NO_RESTAURANT: "payouts.page.noRestaurant",

	// The reassurance, used on the page, the held card and the banner
	SAFE_LINE: "payouts.safeLine",

	// The held-total card, shown only while something is stuck
	HELD_TITLE: "payouts.held.title",
	HELD_BODY: "payouts.held.body",
	HELD_COUNT: "payouts.held.count",
	HELD_FIX_CTA: "payouts.held.fixCta",
	HELD_FIX_PENDING: "payouts.held.fixPending",
	HELD_FIX_FAILED: "payouts.held.fixFailed",

	// The banner on /admin/payments
	BANNER_TITLE: "payouts.banner.title",
	BANNER_BODY: "payouts.banner.body",
	BANNER_CTA: "payouts.banner.cta",

	// The list
	LIST_TITLE: "payouts.list.title",
	LIST_AMOUNT: "payouts.list.amount",
	LIST_SENT_ON: "payouts.list.sentOn",
	LIST_ARRIVES_ON: "payouts.list.arrivesOn",
	LIST_ARRIVED_ON: "payouts.list.arrivedOn",
	LIST_REASON_LABEL: "payouts.list.reasonLabel",
	LIST_FIX_LABEL: "payouts.list.fixLabel",
	LIST_REFERENCE: "payouts.list.reference",

	// Statuses
	STATUS_PENDING: "payouts.status.pending",
	STATUS_IN_TRANSIT: "payouts.status.inTransit",
	STATUS_PAID: "payouts.status.paid",
	STATUS_FAILED: "payouts.status.failed",
	STATUS_CANCELED: "payouts.status.canceled",

	// Empty and not-connected states
	EMPTY_TITLE: "payouts.empty.title",
	EMPTY_DESCRIPTION: "payouts.empty.description",
	NOT_CONNECTED_TITLE: "payouts.notConnected.title",
	NOT_CONNECTED_DESCRIPTION: "payouts.notConnected.description",

	// Notification bodies that carry the amount (the kind defaults take no params)
	NOTIFICATION_FAILED: "payouts.notification.failed",
	NOTIFICATION_RESUMED: "payouts.notification.resumed",

	// Failure reasons and fixes — one pair per PAYOUT_FAILURE_CODE
	FAILURE_ACCOUNT_CLOSED_REASON: "payouts.failure.accountClosed.reason",
	FAILURE_ACCOUNT_CLOSED_FIX: "payouts.failure.accountClosed.fix",
	FAILURE_ACCOUNT_FROZEN_REASON: "payouts.failure.accountFrozen.reason",
	FAILURE_ACCOUNT_FROZEN_FIX: "payouts.failure.accountFrozen.fix",
	FAILURE_BANK_ACCOUNT_RESTRICTED_REASON: "payouts.failure.bankAccountRestricted.reason",
	FAILURE_BANK_ACCOUNT_RESTRICTED_FIX: "payouts.failure.bankAccountRestricted.fix",
	FAILURE_BANK_OWNERSHIP_CHANGED_REASON: "payouts.failure.bankOwnershipChanged.reason",
	FAILURE_BANK_OWNERSHIP_CHANGED_FIX: "payouts.failure.bankOwnershipChanged.fix",
	FAILURE_COULD_NOT_PROCESS_REASON: "payouts.failure.couldNotProcess.reason",
	FAILURE_COULD_NOT_PROCESS_FIX: "payouts.failure.couldNotProcess.fix",
	FAILURE_DEBIT_NOT_AUTHORIZED_REASON: "payouts.failure.debitNotAuthorized.reason",
	FAILURE_DEBIT_NOT_AUTHORIZED_FIX: "payouts.failure.debitNotAuthorized.fix",
	FAILURE_DECLINED_REASON: "payouts.failure.declined.reason",
	FAILURE_DECLINED_FIX: "payouts.failure.declined.fix",
	FAILURE_INSUFFICIENT_FUNDS_REASON: "payouts.failure.insufficientFunds.reason",
	FAILURE_INSUFFICIENT_FUNDS_FIX: "payouts.failure.insufficientFunds.fix",
	FAILURE_INVALID_ACCOUNT_NUMBER_REASON: "payouts.failure.invalidAccountNumber.reason",
	FAILURE_INVALID_ACCOUNT_NUMBER_FIX: "payouts.failure.invalidAccountNumber.fix",
	FAILURE_INCORRECT_ACCOUNT_HOLDER_NAME_REASON: "payouts.failure.incorrectAccountHolderName.reason",
	FAILURE_INCORRECT_ACCOUNT_HOLDER_NAME_FIX: "payouts.failure.incorrectAccountHolderName.fix",
	FAILURE_INCORRECT_ACCOUNT_HOLDER_ADDRESS_REASON:
		"payouts.failure.incorrectAccountHolderAddress.reason",
	FAILURE_INCORRECT_ACCOUNT_HOLDER_ADDRESS_FIX: "payouts.failure.incorrectAccountHolderAddress.fix",
	FAILURE_INCORRECT_ACCOUNT_HOLDER_TAX_ID_REASON:
		"payouts.failure.incorrectAccountHolderTaxId.reason",
	FAILURE_INCORRECT_ACCOUNT_HOLDER_TAX_ID_FIX: "payouts.failure.incorrectAccountHolderTaxId.fix",
	FAILURE_INVALID_CURRENCY_REASON: "payouts.failure.invalidCurrency.reason",
	FAILURE_INVALID_CURRENCY_FIX: "payouts.failure.invalidCurrency.fix",
	FAILURE_NO_ACCOUNT_REASON: "payouts.failure.noAccount.reason",
	FAILURE_NO_ACCOUNT_FIX: "payouts.failure.noAccount.fix",
	FAILURE_UNSUPPORTED_CARD_REASON: "payouts.failure.unsupportedCard.reason",
	FAILURE_UNSUPPORTED_CARD_FIX: "payouts.failure.unsupportedCard.fix",
	FAILURE_UNKNOWN_REASON: "payouts.failure.unknown.reason",
	FAILURE_UNKNOWN_FIX: "payouts.failure.unknown.fix",
} as const;

export type PayoutsKey = (typeof PayoutsKeys)[keyof typeof PayoutsKeys];
