/**
 * Translation keys for admin cross-organization user onboarding — the "Invite
 * user" and "Bulk invite" affordances on the admin Users tab.
 *
 * Two vocabularies live here and are deliberately kept apart:
 *
 *   - **Copy** (labels, hints, buttons) — `userOnboarding.*`, defined below.
 *   - **Reasons** (why a row was refused) — `errors.ERROR_INVITE_*`, defined in
 *     `keys/errors.ts` because they are stable backend codes. A row's reason
 *     text is always looked up through `getErrorMessage`, never written twice.
 *
 * The product decision this UI encodes: Tavli cannot create a Clerk identity,
 * so "add a user" means "create an invitation". Everything here is phrased as
 * inviting, never as creating an account.
 */
export const UserOnboardingKeys = {
	// -- Users tab actions ---------------------------------------------------
	INVITE_ACTION: "userOnboarding.inviteAction",
	BULK_ACTION: "userOnboarding.bulkAction",

	// -- Shared vocabulary ---------------------------------------------------
	ROLE_OWNER: "userOnboarding.role.owner",
	ROLE_MANAGER: "userOnboarding.role.manager",
	ROLE_EMPLOYEE: "userOnboarding.role.employee",

	STATUS_OK: "userOnboarding.status.ok",
	STATUS_ALREADY_MEMBER: "userOnboarding.status.alreadyMember",
	STATUS_CROSS_ORG: "userOnboarding.status.crossOrg",
	STATUS_DUPLICATE_PENDING: "userOnboarding.status.duplicatePending",
	STATUS_DUPLICATE_IN_FILE: "userOnboarding.status.duplicateInFile",
	STATUS_INVALID: "userOnboarding.status.invalid",

	OUTCOME_CREATED: "userOnboarding.outcome.created",
	OUTCOME_SKIPPED: "userOnboarding.outcome.skipped",
	OUTCOME_FAILED: "userOnboarding.outcome.failed",

	CANCEL: "userOnboarding.cancel",
	CLOSE: "userOnboarding.close",
	BACK: "userOnboarding.back",
	DONE: "userOnboarding.done",

	// -- Single invite dialog ------------------------------------------------
	SINGLE_TITLE: "userOnboarding.single.title",
	SINGLE_SUBTITLE: "userOnboarding.single.subtitle",

	EMAIL_LABEL: "userOnboarding.single.emailLabel",
	EMAIL_HINT: "userOnboarding.single.emailHint",
	ROLE_LABEL: "userOnboarding.single.roleLabel",

	ORGANIZATION_LABEL: "userOnboarding.single.organizationLabel",
	ORGANIZATION_PLACEHOLDER: "userOnboarding.single.organizationPlaceholder",
	ORGANIZATION_LOADING: "userOnboarding.single.organizationLoading",
	ORGANIZATION_ERROR: "userOnboarding.single.organizationError",
	ORGANIZATION_EMPTY: "userOnboarding.single.organizationEmpty",

	RESTAURANTS_LABEL: "userOnboarding.single.restaurantsLabel",
	RESTAURANTS_PLACEHOLDER: "userOnboarding.single.restaurantsPlaceholder",
	RESTAURANTS_ARIA: "userOnboarding.single.restaurantsAria",
	RESTAURANTS_SUMMARY: "userOnboarding.single.restaurantsSummary",
	RESTAURANTS_LOADING: "userOnboarding.single.restaurantsLoading",
	RESTAURANTS_ERROR: "userOnboarding.single.restaurantsError",
	RESTAURANTS_EMPTY: "userOnboarding.single.restaurantsEmpty",
	RESTAURANTS_PICK_ORGANIZATION: "userOnboarding.single.restaurantsPickOrganization",
	RESTAURANTS_REQUIRED_HINT: "userOnboarding.single.restaurantsRequiredHint",

	NAMES_SECTION: "userOnboarding.single.namesSection",
	FIRST_NAME_LABEL: "userOnboarding.single.firstNameLabel",
	PATERNAL_LASTNAME_LABEL: "userOnboarding.single.paternalLastnameLabel",
	MATERNAL_LASTNAME_LABEL: "userOnboarding.single.maternalLastnameLabel",

	SEND: "userOnboarding.single.send",
	SENDING: "userOnboarding.single.sending",

	CROSS_ORG_TITLE: "userOnboarding.crossOrg.title",
	CROSS_ORG_BODY: "userOnboarding.crossOrg.body",
	CROSS_ORG_ACK: "userOnboarding.crossOrg.acknowledge",
	REPLACE_PENDING_TITLE: "userOnboarding.replacePending.title",
	REPLACE_PENDING_BODY: "userOnboarding.replacePending.body",
	REPLACE_PENDING_ACK: "userOnboarding.replacePending.acknowledge",

	SINGLE_SUCCESS_TITLE: "userOnboarding.single.successTitle",
	SINGLE_SUCCESS_BODY: "userOnboarding.single.successBody",
	SINGLE_SUCCESS_ALREADY_MEMBER: "userOnboarding.single.successAlreadyMember",
	SINGLE_SUCCESS_REPLACED: "userOnboarding.single.successReplaced",
	SINGLE_INVITE_ANOTHER: "userOnboarding.single.inviteAnother",

	// -- Bulk invite dialog --------------------------------------------------
	BULK_TITLE: "userOnboarding.bulk.title",
	BULK_SUBTITLE: "userOnboarding.bulk.subtitle",

	BULK_DROPZONE_LABEL: "userOnboarding.bulk.dropzoneLabel",
	BULK_DROPZONE_HINT: "userOnboarding.bulk.dropzoneHint",
	BULK_NOT_CSV: "userOnboarding.bulk.notCsv",
	BULK_TEMPLATE_DOWNLOAD: "userOnboarding.bulk.templateDownload",
	BULK_FORMAT_TITLE: "userOnboarding.bulk.formatTitle",
	BULK_FORMAT_REQUIRED: "userOnboarding.bulk.formatRequired",
	BULK_FORMAT_OPTIONAL: "userOnboarding.bulk.formatOptional",
	BULK_FORMAT_ROLES: "userOnboarding.bulk.formatRoles",
	BULK_FORMAT_ORGANIZATION: "userOnboarding.bulk.formatOrganization",
	BULK_FORMAT_RESTAURANTS: "userOnboarding.bulk.formatRestaurants",
	BULK_FORMAT_LIMITS: "userOnboarding.bulk.formatLimits",

	BULK_UPLOADING: "userOnboarding.bulk.uploading",
	BULK_VALIDATING: "userOnboarding.bulk.validating",
	BULK_COMMITTING: "userOnboarding.bulk.committing",

	BULK_PREVIEW_TITLE: "userOnboarding.bulk.previewTitle",
	BULK_PREVIEW_NOTHING_CREATED: "userOnboarding.bulk.previewNothingCreated",
	BULK_SUMMARY_TOTAL: "userOnboarding.bulk.summaryTotal",
	BULK_SUMMARY_SELECTED: "userOnboarding.bulk.summarySelected",
	BULK_SELECT_ALL_SAFE: "userOnboarding.bulk.selectAllSafe",
	BULK_CLEAR_SELECTION: "userOnboarding.bulk.clearSelection",
	BULK_ACK_ALL_CROSS_ORG: "userOnboarding.bulk.acknowledgeAllCrossOrg",
	BULK_CROSS_ORG_BANNER: "userOnboarding.bulk.crossOrgBanner",

	BULK_COL_INCLUDE: "userOnboarding.bulk.colInclude",
	BULK_COL_ROW: "userOnboarding.bulk.colRow",
	BULK_COL_EMAIL: "userOnboarding.bulk.colEmail",
	BULK_COL_ROLE: "userOnboarding.bulk.colRole",
	BULK_COL_ORGANIZATION: "userOnboarding.bulk.colOrganization",
	BULK_COL_RESTAURANTS: "userOnboarding.bulk.colRestaurants",
	BULK_COL_STATUS: "userOnboarding.bulk.colStatus",
	BULK_COL_REASON: "userOnboarding.bulk.colReason",
	BULK_ROW_INCLUDE_ARIA: "userOnboarding.bulk.rowIncludeAria",
	BULK_ROW_NOT_SENDABLE: "userOnboarding.bulk.rowNotSendable",

	BULK_CONFIRM: "userOnboarding.bulk.confirm",
	BULK_CONFIRM_NONE_SELECTED: "userOnboarding.bulk.confirmNoneSelected",

	BULK_REPORT_TITLE: "userOnboarding.bulk.reportTitle",
	BULK_REPORT_SUMMARY: "userOnboarding.bulk.reportSummary",
	BULK_REPORT_PARTIAL: "userOnboarding.bulk.reportPartial",
	BULK_REPORT_ALL_GOOD: "userOnboarding.bulk.reportAllGood",
	BULK_REPORT_COPY: "userOnboarding.bulk.reportCopy",
	BULK_REPORT_COPIED: "userOnboarding.bulk.reportCopied",
	BULK_REPORT_DOWNLOAD: "userOnboarding.bulk.reportDownload",
	BULK_COL_OUTCOME: "userOnboarding.bulk.colOutcome",

	BULK_RETRY: "userOnboarding.bulk.retry",
} as const;

export type UserOnboardingKey = (typeof UserOnboardingKeys)[keyof typeof UserOnboardingKeys];
