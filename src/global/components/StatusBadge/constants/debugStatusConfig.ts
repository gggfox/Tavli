/**
 * Debug panel status configuration constants
 */

export type DebugStatus = "loading" | "success" | "error" | "warning" | "neutral";

export interface DebugStatusConfig {
	bgColor: string;
	textColor: string;
}

export const debugStatusConfig: Record<DebugStatus, DebugStatusConfig> = {
	loading: {
		bgColor: "rgba(251, 191, 36, 0.2)",
		textColor: "rgb(251, 191, 36)",
	},
	success: {
		bgColor: "rgba(34, 197, 94, 0.2)",
		textColor: "rgb(34, 197, 94)",
	},
	error: {
		bgColor: "rgba(239, 68, 68, 0.2)",
		textColor: "rgb(239, 68, 68)",
	},
	warning: {
		bgColor: "rgba(251, 146, 60, 0.2)",
		textColor: "rgb(251, 146, 60)",
	},
	neutral: {
		bgColor: "rgba(148, 163, 184, 0.2)",
		textColor: "rgb(148, 163, 184)",
	},
};

/**
 * Get debug status configuration
 */
export function getDebugStatusConfig(status: DebugStatus): DebugStatusConfig {
	return debugStatusConfig[status];
}

