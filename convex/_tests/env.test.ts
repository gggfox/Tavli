import { afterEach, describe, expect, it } from "vitest";
import {
	CONVEX_ENV,
	ENABLE_DEV_ROLE_SWITCHER_ENV,
	getConvexEnv,
	isDevEnv,
	isDevRoleSwitcherEnabled,
} from "../_util/env";

describe("convex env helpers", () => {
	const originalConvexEnv = process.env.CONVEX_ENV;
	const originalRoleSwitcher = process.env[ENABLE_DEV_ROLE_SWITCHER_ENV];

	afterEach(() => {
		if (originalConvexEnv === undefined) {
			delete process.env.CONVEX_ENV;
		} else {
			process.env.CONVEX_ENV = originalConvexEnv;
		}
		if (originalRoleSwitcher === undefined) {
			delete process.env[ENABLE_DEV_ROLE_SWITCHER_ENV];
		} else {
			process.env[ENABLE_DEV_ROLE_SWITCHER_ENV] = originalRoleSwitcher;
		}
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
});
