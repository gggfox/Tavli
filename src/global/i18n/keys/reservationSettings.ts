/**
 * Translation keys for the staff-facing reservation settings panel.
 */
export const ReservationSettingsKeys = {
	// Field descriptions (info tooltips)
	DESC_ACCEPTING: "reservationSettings.fieldDescriptions.accepting",
	DESC_DEFAULT_TURN: "reservationSettings.fieldDescriptions.defaultTurn",
	DESC_MIN_ADVANCE: "reservationSettings.fieldDescriptions.minAdvance",
	DESC_MAX_ADVANCE: "reservationSettings.fieldDescriptions.maxAdvance",
	DESC_NO_SHOW_GRACE: "reservationSettings.fieldDescriptions.noShowGrace",
	DESC_TURN_RANGES: "reservationSettings.fieldDescriptions.turnRanges",
	DESC_BLACKOUTS: "reservationSettings.fieldDescriptions.blackouts",

	// Field labels
	LABEL_ACCEPTING: "reservationSettings.labels.accepting",
	LABEL_DEFAULT_TURN: "reservationSettings.labels.defaultTurn",
	LABEL_MIN_ADVANCE: "reservationSettings.labels.minAdvance",
	LABEL_MAX_ADVANCE: "reservationSettings.labels.maxAdvance",
	LABEL_NO_SHOW_GRACE: "reservationSettings.labels.noShowGrace",
	LABEL_TURN_RANGES: "reservationSettings.labels.turnRanges",
	LABEL_BLACKOUTS: "reservationSettings.labels.blackouts",
	LABEL_MIN_PARTY: "reservationSettings.labels.minParty",
	LABEL_MAX_PARTY: "reservationSettings.labels.maxParty",
	LABEL_TURN_MINUTES: "reservationSettings.labels.turnMinutes",
	LABEL_STARTS_AT: "reservationSettings.labels.startsAt",
	LABEL_ENDS_AT: "reservationSettings.labels.endsAt",
	LABEL_REASON: "reservationSettings.labels.reason",

	// Actions
	ACTION_ADD_RANGE: "reservationSettings.actions.addRange",
	ACTION_ADD_WINDOW: "reservationSettings.actions.addWindow",
	ACTION_SAVE: "reservationSettings.actions.save",
	ACTION_REMOVE: "reservationSettings.actions.remove",
	ACTION_MORE_INFO: "reservationSettings.actions.moreInfo",

	// Status messages
	MSG_SAVED: "reservationSettings.messages.saved",
	MSG_SAVE_FAILED: "reservationSettings.messages.saveFailed",
	MSG_USING_DEFAULTS: "reservationSettings.messages.usingDefaults",
	MSG_RANGE_FALLBACK: "reservationSettings.messages.rangeFallback",
} as const;

export type ReservationSettingsKey =
	(typeof ReservationSettingsKeys)[keyof typeof ReservationSettingsKeys];
