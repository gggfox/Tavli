/**
 * Singleton configuration class that centralizes environment variable access.
 * Logs all configuration values in non-production environments for debugging.
 *
 * Usage:
 *   import { Config } from '~/lib/config';
 *   const convexUrl = Config.instance.convexUrl;
 */

const ENVIRONMENTS = {
	DEVELOPMENT: "development",
	STAGING: "staging",
	PRODUCTION: "production",
};

type Environment = (typeof ENVIRONMENTS)[keyof typeof ENVIRONMENTS];

interface ConfigValues {
	nodeEnv: Environment;
	isDev: boolean;
	isProd: boolean;

	convexUrl: string;

	hasAuthConfig: boolean;
}

class ConfigClass implements ConfigValues {
	private static _instance: ConfigClass | null = null;

	readonly nodeEnv: Environment;
	readonly isDev: boolean;
	readonly isProd: boolean;

	readonly convexUrl: string;

	readonly hasAuthConfig: boolean;

	private constructor() {
		const env = import.meta.env.MODE ?? ENVIRONMENTS.DEVELOPMENT;
		this.nodeEnv = this.parseEnvironment(env);
		this.isProd = this.nodeEnv === ENVIRONMENTS.PRODUCTION;
		this.isDev = this.nodeEnv === ENVIRONMENTS.DEVELOPMENT;

		this.convexUrl = import.meta.env.VITE_CONVEX_URL ?? "";

		this.hasAuthConfig = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

		if (!this.isProd) {
			this.logConfig();
		}

		this.validate();
	}

	static get instance(): ConfigClass {
		ConfigClass._instance ??= new ConfigClass();
		return ConfigClass._instance;
	}

	static reset(): void {
		ConfigClass._instance = null;
	}

	private parseEnvironment(env: string): Environment {
		const normalized = env.toLowerCase();
		if (normalized === ENVIRONMENTS.PRODUCTION || normalized === "prod") {
			return ENVIRONMENTS.PRODUCTION;
		}
		if (normalized === ENVIRONMENTS.STAGING || normalized === "stage") {
			return ENVIRONMENTS.STAGING;
		}
		return ENVIRONMENTS.DEVELOPMENT;
	}

	private logConfig(): void {
		const divider = "═".repeat(50);
		const config = {
			environment: this.nodeEnv,
			convexUrl: this.maskSensitive(this.convexUrl),
			hasAuthConfig: this.hasAuthConfig,
		};

		console.log(`\n╔${divider}╗`);
		console.log(`║ 🔧 Configuration (${this.nodeEnv.toUpperCase()})`.padEnd(51) + "║");
		console.log(`╠${divider}╣`);

		for (const [key, value] of Object.entries(config)) {
			const line = `║  ${key}: ${value}`;
			console.log(line.padEnd(51) + "║");
		}

		console.log(`╚${divider}╝\n`);
	}

	private maskSensitive(value: string | undefined): string {
		if (!value) return "(not set)";
		if (value.length <= 8) return "****";
		return `${value.slice(0, 4)}...${value.slice(-4)}`;
	}

	private validate(): void {
		const errors: string[] = [];

		if (!this.convexUrl) {
			errors.push("VITE_CONVEX_URL is required but not set");
		}

		if (errors.length > 0) {
			console.error("❌ Configuration errors:");
			errors.forEach((err) => console.error(`   - ${err}`));

			if (this.isProd) {
				throw new Error(`Configuration validation failed: ${errors.join(", ")}`);
			}
		}
	}
}

export const Config = ConfigClass;

export type { ConfigValues, Environment };
