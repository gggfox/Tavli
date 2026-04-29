/**
 * Frozen module-level configuration object derived from Vite environment
 * variables. Importable as a plain value:
 *
 *   import { config } from "@/global/utils/config";
 *   if (config.isDev) ...
 *
 * Replaces the previous singleton class. The class added a private
 * constructor, side-effecting log-on-construction, and a maskSensitive
 * helper for the public Convex deployment URL — all of which were
 * decorative.
 */

const ENVIRONMENTS = {
	DEVELOPMENT: "development",
	STAGING: "staging",
	PRODUCTION: "production",
} as const;

export type Environment = (typeof ENVIRONMENTS)[keyof typeof ENVIRONMENTS];

export interface ConfigValues {
	readonly nodeEnv: Environment;
	readonly isDev: boolean;
	readonly isProd: boolean;
	readonly convexUrl: string;
	readonly hasAuthConfig: boolean;
}

function parseEnvironment(env: string): Environment {
	const normalized = env.toLowerCase();
	if (normalized === ENVIRONMENTS.PRODUCTION || normalized === "prod") {
		return ENVIRONMENTS.PRODUCTION;
	}
	if (normalized === ENVIRONMENTS.STAGING || normalized === "stage") {
		return ENVIRONMENTS.STAGING;
	}
	return ENVIRONMENTS.DEVELOPMENT;
}

const nodeEnv = parseEnvironment(import.meta.env.MODE ?? ENVIRONMENTS.DEVELOPMENT);
const convexUrl = import.meta.env.VITE_CONVEX_URL ?? "";

export const config: ConfigValues = Object.freeze({
	nodeEnv,
	isDev: nodeEnv === ENVIRONMENTS.DEVELOPMENT,
	isProd: nodeEnv === ENVIRONMENTS.PRODUCTION,
	convexUrl,
	hasAuthConfig: Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY),
});

if (!config.convexUrl) {
	console.error("VITE_CONVEX_URL is required but not set");
	if (config.isProd) {
		throw new Error("Configuration validation failed: VITE_CONVEX_URL missing");
	}
}
