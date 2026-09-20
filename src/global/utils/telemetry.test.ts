import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthogMock = vi.hoisted(() => ({
	init: vi.fn(),
	register: vi.fn(),
	capture: vi.fn(),
	captureException: vi.fn(),
	identify: vi.fn(),
	reset: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: posthogMock }));

// The token is read once at module load, so each test gets a fresh module.
async function loadTelemetry() {
	vi.resetModules();
	return await import("./telemetry");
}

describe("telemetry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	describe("without a project token", () => {
		beforeEach(() => {
			vi.stubEnv("VITE_PUBLIC_POSTHOG_PROJECT_TOKEN", "");
		});

		it("never initialises the SDK", async () => {
			const telemetry = await loadTelemetry();
			telemetry.initTelemetry();

			expect(posthogMock.init).not.toHaveBeenCalled();
		});

		it("makes every call a no-op", async () => {
			const telemetry = await loadTelemetry();
			telemetry.initTelemetry();
			telemetry.track("order_placed", { order_id: "o1" });
			telemetry.reportError(new Error("boom"));
			telemetry.identifyUser("user_1");
			telemetry.resetUser();

			expect(posthogMock.capture).not.toHaveBeenCalled();
			expect(posthogMock.captureException).not.toHaveBeenCalled();
			expect(posthogMock.identify).not.toHaveBeenCalled();
			expect(posthogMock.reset).not.toHaveBeenCalled();
		});
	});

	describe("with a project token", () => {
		beforeEach(() => {
			vi.stubEnv("VITE_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
			vi.stubEnv("VITE_GIT_SHA", "abc1234");
		});

		it("initialises once, with exception capture and strict recording masks", async () => {
			const telemetry = await loadTelemetry();
			telemetry.initTelemetry();
			telemetry.initTelemetry();

			expect(posthogMock.init).toHaveBeenCalledTimes(1);
			expect(posthogMock.init).toHaveBeenCalledWith(
				"phc_test",
				expect.objectContaining({
					api_host: "https://us.i.posthog.com",
					capture_exceptions: true,
					session_recording: { maskAllInputs: true, maskTextSelector: "*" },
				})
			);
		});

		it("honours a configured ingest host", async () => {
			vi.stubEnv("VITE_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
			const telemetry = await loadTelemetry();
			telemetry.initTelemetry();

			expect(posthogMock.init).toHaveBeenCalledWith(
				"phc_test",
				expect.objectContaining({ api_host: "https://eu.i.posthog.com" })
			);
		});

		it("stamps every event with the environment and the release", async () => {
			const telemetry = await loadTelemetry();
			telemetry.initTelemetry();

			expect(posthogMock.register).toHaveBeenCalledWith({
				environment: expect.any(String),
				release: "abc1234",
			});
		});

		it("forwards product events", async () => {
			const telemetry = await loadTelemetry();
			telemetry.initTelemetry();
			telemetry.track("order_placed", { order_id: "o1", item_count: 2 });

			expect(posthogMock.capture).toHaveBeenCalledWith("order_placed", {
				order_id: "o1",
				item_count: 2,
			});
		});

		it("forwards caught errors with their context", async () => {
			const telemetry = await loadTelemetry();
			telemetry.initTelemetry();
			const error = new Error("boom");
			telemetry.reportError(error, { source: "route" });

			expect(posthogMock.captureException).toHaveBeenCalledWith(error, { source: "route" });
		});

		it("identifies by Clerk id and nothing else", async () => {
			const telemetry = await loadTelemetry();
			telemetry.initTelemetry();
			telemetry.identifyUser("user_1");

			// Exactly one argument — no email, no name (ADR-006).
			expect(posthogMock.identify).toHaveBeenCalledWith("user_1");
		});

		it("forgets the user on reset", async () => {
			const telemetry = await loadTelemetry();
			telemetry.initTelemetry();
			telemetry.resetUser();

			expect(posthogMock.reset).toHaveBeenCalledTimes(1);
		});
	});
});
