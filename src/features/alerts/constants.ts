import { AlertsKeys } from "@/global/i18n";
import {
	OPERATOR_ALERT_SEVERITY,
	OPERATOR_ALERT_STATUS,
	type OperatorAlertSeverity,
	type OperatorAlertStatus,
} from "convex/constants";

/** Sentinel for "don't filter" in the severity and restaurant selects. */
export const ALERT_FILTER_ALL = "all";

/** Sentinel for alerts that belong to no restaurant (platform-wide). */
export const ALERT_FILTER_NO_RESTAURANT = "none";

export const SEVERITY_LABEL_KEY: Record<OperatorAlertSeverity, string> = {
	[OPERATOR_ALERT_SEVERITY.INFO]: AlertsKeys.SEVERITY_INFO,
	[OPERATOR_ALERT_SEVERITY.WARNING]: AlertsKeys.SEVERITY_WARNING,
	[OPERATOR_ALERT_SEVERITY.SEVERE]: AlertsKeys.SEVERITY_SEVERE,
};

export const STATUS_LABEL_KEY: Record<OperatorAlertStatus, string> = {
	[OPERATOR_ALERT_STATUS.OPEN]: AlertsKeys.STATUS_OPEN,
	[OPERATOR_ALERT_STATUS.ACKNOWLEDGED]: AlertsKeys.STATUS_ACKNOWLEDGED,
};

/**
 * Badge colours. `severe` borrows the destructive token rather than inventing
 * one: the page's whole job is that a severe alert is the thing you look at
 * first, and the design system already spells "this is bad" that way.
 */
export const SEVERITY_BADGE_CLASS: Record<OperatorAlertSeverity, string> = {
	[OPERATOR_ALERT_SEVERITY.INFO]: "bg-hover text-muted-foreground",
	[OPERATOR_ALERT_SEVERITY.WARNING]: "bg-hover text-foreground",
	[OPERATOR_ALERT_SEVERITY.SEVERE]: "bg-destructive/10 text-destructive",
};
