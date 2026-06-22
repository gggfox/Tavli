import { describe, expect, it } from "vitest";
import {
	buildIntegrationErrorLog,
	INTEGRATION_LOG_KIND,
	isStripeSignatureVerificationError,
	parseResendErrorSummary,
	redactExternalId,
} from "./integrationLogging";

describe("redactExternalId", () => {
	it("redacts long external IDs", () => {
		expect(redactExternalId("evt_1234567890abcdef")).toBe("evt_1…cdef");
	});

	it("returns undefined for empty values", () => {
		expect(redactExternalId(undefined)).toBeUndefined();
		expect(redactExternalId(null)).toBeUndefined();
	});
});

describe("isStripeSignatureVerificationError", () => {
	it("detects Stripe signature verification errors by name", () => {
		const error = new Error("No signatures found matching the expected signature for payload");
		error.name = "StripeSignatureVerificationError";
		expect(isStripeSignatureVerificationError(error)).toBe(true);
	});

	it("returns false for generic errors", () => {
		expect(isStripeSignatureVerificationError(new Error("boom"))).toBe(false);
	});
});

describe("buildIntegrationErrorLog", () => {
	it("labels signature verification failures without leaking payload details", () => {
		const error = new Error("Invalid signature");
		error.name = "StripeSignatureVerificationError";

		expect(
			buildIntegrationErrorLog(error, {
				integration: "stripe-webhook",
				operation: "constructEvent",
			})
		).toEqual({
			integration: "stripe-webhook",
			operation: "constructEvent",
			kind: INTEGRATION_LOG_KIND.SIGNATURE_VERIFICATION_FAILED,
			message: "Webhook signature verification failed",
		});
	});

	it("includes redacted event metadata for processing failures", () => {
		const log = buildIntegrationErrorLog(new Error("Database unavailable"), {
			integration: "stripe-webhook",
			operation: "fulfillPayment",
			eventType: "payment_intent.succeeded",
			eventId: "evt_1234567890abcdef",
		});

		expect(log.kind).toBe(INTEGRATION_LOG_KIND.PROCESSING_FAILED);
		expect(log.eventType).toBe("payment_intent.succeeded");
		expect(log.eventId).toBe("evt_1…cdef");
		expect(log.message).toBe("Database unavailable");
	});
});

describe("parseResendErrorSummary", () => {
	it("extracts stable fields from JSON error bodies", () => {
		expect(
			parseResendErrorSummary(
				422,
				JSON.stringify({ name: "validation_error", message: "Invalid `to` field" })
			)
		).toEqual({
			httpStatus: 422,
			errorName: "validation_error",
			message: "Invalid `to` field",
		});
	});

	it("omits raw body when response is not JSON", () => {
		expect(parseResendErrorSummary(500, "<html>internal error</html>")).toEqual({
			httpStatus: 500,
		});
	});
});
