export const INTEGRATION_LOG_KIND = {
	SIGNATURE_VERIFICATION_FAILED: "signature_verification_failed",
	PROCESSING_FAILED: "processing_failed",
	HTTP_RESPONSE_ERROR: "http_response_error",
} as const;

export function isStripeSignatureVerificationError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return (
		error.name === "StripeSignatureVerificationError" ||
		error.constructor.name === "StripeSignatureVerificationError"
	);
}

/** Redacts external IDs (Stripe event/account IDs, Convex IDs) for safe logs. */
export function redactExternalId(id: string | undefined | null): string | undefined {
	if (!id) return undefined;
	if (id.length <= 10) return "***";
	return `${id.slice(0, 5)}…${id.slice(-4)}`;
}

export type IntegrationLogFields = {
	integration: string;
	operation?: string;
	eventType?: string;
	eventId?: string;
	httpStatus?: number;
	httpStatusText?: string;
	invitationId?: string;
};

export function buildIntegrationErrorLog(
	error: unknown,
	fields: IntegrationLogFields
): Record<string, string | number | boolean | undefined> {
	const log: Record<string, string | number | boolean | undefined> = {
		integration: fields.integration,
	};

	if (fields.operation) log.operation = fields.operation;
	if (fields.eventType) log.eventType = fields.eventType;
	if (fields.eventId) log.eventId = redactExternalId(fields.eventId);
	if (fields.httpStatus !== undefined) log.httpStatus = fields.httpStatus;
	if (fields.httpStatusText) log.httpStatusText = fields.httpStatusText;
	if (fields.invitationId) log.invitationId = redactExternalId(fields.invitationId);

	if (isStripeSignatureVerificationError(error)) {
		log.kind = INTEGRATION_LOG_KIND.SIGNATURE_VERIFICATION_FAILED;
		log.message = "Webhook signature verification failed";
		return log;
	}

	if (error instanceof Error) {
		log.kind = INTEGRATION_LOG_KIND.PROCESSING_FAILED;
		log.errorName = error.name;
		log.message = error.message.slice(0, 200);
		return log;
	}

	log.kind = INTEGRATION_LOG_KIND.PROCESSING_FAILED;
	log.message = "Unknown integration error";
	return log;
}

export function parseResendErrorSummary(
	status: number,
	responseText: string
): { httpStatus: number; errorName?: string; message?: string } {
	const summary: { httpStatus: number; errorName?: string; message?: string } = {
		httpStatus: status,
	};
	try {
		const parsed = JSON.parse(responseText) as { name?: string; message?: string };
		if (typeof parsed.name === "string") summary.errorName = parsed.name;
		if (typeof parsed.message === "string") {
			summary.message = parsed.message.slice(0, 200);
		}
	} catch {
		// Do not include raw response bodies in logs.
	}
	return summary;
}
