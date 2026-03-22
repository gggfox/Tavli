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
  // Environment
  nodeEnv: Environment;
  isDev: boolean;
  isProd: boolean;

  // Convex
  convexUrl: string;

  // WorkOS Authentication
  // Note: WorkOS env vars (WORKOS_CLIENT_ID, WORKOS_API_KEY, WORKOS_REDIRECT_URI, WORKOS_COOKIE_PASSWORD)
  // are read directly by @workos/authkit-tanstack-react-start on the server.
  // This flag just indicates if auth UI should be shown.
  hasWorkOSConfig: boolean;
}

class ConfigClass implements ConfigValues {
  private static _instance: ConfigClass | null = null;

  // Environment
  readonly nodeEnv: Environment;
  readonly isDev: boolean;
  readonly isProd: boolean;

  // Convex
  readonly convexUrl: string;

  // WorkOS Authentication
  readonly hasWorkOSConfig: boolean;

  private constructor() {
    // Environment detection
    const env = import.meta.env.MODE ?? ENVIRONMENTS.DEVELOPMENT;
    this.nodeEnv = this.parseEnvironment(env);
    this.isProd = this.nodeEnv === ENVIRONMENTS.PRODUCTION;
    this.isDev = this.nodeEnv === ENVIRONMENTS.DEVELOPMENT;

    // Convex
    this.convexUrl = import.meta.env.VITE_CONVEX_URL ?? "";

    // WorkOS Authentication
    // The actual WorkOS env vars are read server-side by authkitMiddleware.
    // This flag controls whether to show auth UI (always true when deployed properly).
    // Set VITE_ENABLE_AUTH=true in your .env to enable auth UI.
    this.hasWorkOSConfig = import.meta.env.VITE_ENABLE_AUTH === "true";

    // Log configuration in non-production environments
    if (!this.isProd) {
      this.logConfig();
    }

    // Validate required configuration
    this.validate();
  }

  /**
   * Get the singleton instance
   */
  static get instance(): ConfigClass {
    ConfigClass._instance ??= new ConfigClass();
    return ConfigClass._instance;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
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
      hasWorkOSConfig: this.hasWorkOSConfig,
    };

    console.log(`\n╔${divider}╗`);
    console.log(
      `║ 🔧 Configuration (${this.nodeEnv.toUpperCase()})`.padEnd(51) + "║"
    );
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

      // In production, throw to prevent app from running with invalid config
      if (this.isProd) {
        throw new Error(
          `Configuration validation failed: ${errors.join(", ")}`
        );
      }
    }
  }
}

// Export the singleton instance getter
export const Config = ConfigClass;

// Export type for use in other modules
export type { ConfigValues, Environment };
