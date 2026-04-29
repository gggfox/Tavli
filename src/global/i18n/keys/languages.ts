/**
 * Language codes enum
 */
export const Languages = {
	EN: "en",
	ES: "es",
} as const;

export type Language = (typeof Languages)[keyof typeof Languages];
