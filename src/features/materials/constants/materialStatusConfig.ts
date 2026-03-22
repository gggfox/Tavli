/**
 * Material approval status configuration constants
 */

export type MaterialStatus = "pending" | "approved" | "rejected" | "archived";

export interface MaterialStatusConfig {
	bgColor: string;
	textColor: string;
	label: string;
}

export const materialStatusConfig: Record<MaterialStatus, MaterialStatusConfig> = {
	pending: {
		bgColor: "rgba(251, 191, 36, 0.15)",
		textColor: "rgb(251, 191, 36)",
		label: "Pending",
	},
	approved: {
		bgColor: "rgba(34, 197, 94, 0.15)",
		textColor: "rgb(34, 197, 94)",
		label: "Approved",
	},
	rejected: {
		bgColor: "rgba(239, 68, 68, 0.15)",
		textColor: "rgb(239, 68, 68)",
		label: "Rejected",
	},
	archived: {
		bgColor: "rgba(107, 114, 128, 0.15)",
		textColor: "rgb(107, 114, 128)",
		label: "Archived",
	},
};

/**
 * Get material status configuration
 */
export function getMaterialStatusConfig(status: MaterialStatus): MaterialStatusConfig {
	return materialStatusConfig[status];
}
