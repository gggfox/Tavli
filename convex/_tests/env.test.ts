import { afterEach, describe, expect, it } from "vitest";
import { ERROR_NAMES } from "../_shared/errors";
import {
	CONVEX_ENV,
	DEV_APP_URL,
	ENABLE_DEV_ROLE_SWITCHER_ENV,
	getAppUrl,
	getConvexEnv,
	isDevEnv,
	isDevRoleSwitcherEnabled,
} from "../_util/env";

describe("convex env helpers", () => {
	const originalConvexEnv = process.env.CONVEX_ENV;
	const originalRoleSwitcher = process.env[ENABLE_DEV_ROLE_SWITCHER_ENV];
	const originalPublicAppUrl = process.env.PUBLIC_APP_URL;
	const originalViteAppUrl = process.env.VITE_APP_URL;

	const restoreEnv = (name: string, value: string | undefined) => {
		if (value === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = value;
		}
	};

	afterEach(() => {
		restoreEnv("CONVEX_ENV", originalConvexEnv);
		restoreEnv(ENABLE_DEV_ROLE_SWITCHER_ENV, originalRoleSwitcher);
		restoreEnv("PUBLIC_APP_URL", originalPublicAppUrl);
		restoreEnv("VITE_APP_URL", originalViteAppUrl);
	});

	it("defaults to production when CONVEX_ENV is unset (fail-closed)", () => {
		delete process.env.CONVEX_ENV;
		expect(getConvexEnv()).toBe(CONVEX_ENV.PRODUCTION);
		expect(isDevEnv()).toBe(false);
	});

	it("expects production deployments to use CONVEX_ENV=production explicitly", () => {
		// CI runs this test on every PR; prod Convex deploys must set the same value.
		expect(CONVEX_ENV.PRODUCTION).toBe("production");
		process.env.CONVEX_ENV = "production";
		expect(getConvexEnv()).toBe(CONVEX_ENV.PRODUCTION);
	});

	describe("isDevRoleSwitcherEnabled", () => {
		it("requires development CONVEX_ENV and ENABLE_DEV_ROLE_SWITCHER", () => {
			process.env.CONVEX_ENV = "development";
			process.env[ENABLE_DEV_ROLE_SWITCHER_ENV] = "true";
			expect(isDevRoleSwitcherEnabled()).toBe(true);
		});

		it("blocks when CONVEX_ENV is development but the flag is unset", () => {
			process.env.CONVEX_ENV = "development";
			delete process.env[ENABLE_DEV_ROLE_SWITCHER_ENV];
			expect(isDevRoleSwitcherEnabled()).toBe(false);
		});

		it("blocks when the flag is set but CONVEX_ENV is production", () => {
			process.env.CONVEX_ENV = "production";
			process.env[ENABLE_DEV_ROLE_SWITCHER_ENV] = "true";
			expect(isDevRoleSwitcherEnabled()).toBe(false);
		});
	});

	describe("getAppUrl", () => {
		it("falls back to localhost in development when no URL is set", () => {
			process.env.CONVEX_ENV = "development";
			delete process.env.PUBLIC_APP_URL;
			delete process.env.VITE_APP_URL;
			expect(getAppUrl()).toBe(DEV_APP_URL);
		});

		it("returns PUBLIC_APP_URL in production, stripping trailing slashes", () => {
			process.env.CONVEX_ENV = "production";
			process.env.PUBLIC_APP_URL = "https://app.tavli.com/";
			expect(getAppUrl()).toBe("https://app.tavli.com");
		});

		it("falls back to VITE_APP_URL when PUBLIC_APP_URL is unset", () => {
			process.env.CONVEX_ENV = "production";
			delete process.env.PUBLIC_APP_URL;
			process.env.VITE_APP_URL = "https://staging.tavli.com";
			expect(getAppUrl()).toBe("https://staging.tavli.com");
		});

		it("throws APP_URL_NOT_CONFIGURED in production when no URL is set", () => {
			process.env.CONVEX_ENV = "production";
			delete process.env.PUBLIC_APP_URL;
			delete process.env.VITE_APP_URL;
			expect(() => getAppUrl()).toThrowError(
				expect.objectContaining({ name: ERROR_NAMES.APP_URL_NOT_CONFIGURED })
			);
		});

		it("throws APP_URL_NOT_CONFIGURED in staging when no URL is set", () => {
			process.env.CONVEX_ENV = "staging";
			delete process.env.PUBLIC_APP_URL;
			delete process.env.VITE_APP_URL;
			expect(() => getAppUrl()).toThrowError(
				expect.objectContaining({ name: ERROR_NAMES.APP_URL_NOT_CONFIGURED })
			);
		});

		it("treats a blank PUBLIC_APP_URL as unset (throws in production)", () => {
			process.env.CONVEX_ENV = "production";
			process.env.PUBLIC_APP_URL = "   ";
			delete process.env.VITE_APP_URL;
			expect(() => getAppUrl()).toThrowError(
				expect.objectContaining({ name: ERROR_NAMES.APP_URL_NOT_CONFIGURED })
			);
		});

		it("throws when CONVEX_ENV is unset (fail-closed to production)", () => {
			delete process.env.CONVEX_ENV;
			delete process.env.PUBLIC_APP_URL;
			delete process.env.VITE_APP_URL;
			expect(() => getAppUrl()).toThrowError(
				expect.objectContaining({ name: ERROR_NAMES.APP_URL_NOT_CONFIGURED })
			);
		});
	});
});
