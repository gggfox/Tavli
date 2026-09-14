export const ERROR_NAMES = {
	NOT_AUTHENTICATED: "NOT_AUTHENTICATED",
	NOT_AUTHORIZED: "NOT_AUTHORIZED",
	NOT_FOUND: "NOT_FOUND",
	BAD_REQUEST: "BAD_REQUEST",
	INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
	SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
	TIMEOUT: "TIMEOUT",
	CONFLICT: "CONFLICT",
	VALIDATION_ERROR: "VALIDATION_ERROR",
	IDEMPOTENCY_KEY_CONFLICT: "IDEMPOTENCY_KEY_CONFLICT",
	INVALID_AUCTION_STATE: "INVALID_AUCTION_STATE",
	APP_URL_NOT_CONFIGURED: "APP_URL_NOT_CONFIGURED",
	RATE_LIMITED: "RATE_LIMITED",
	AI_IMAGE_GENERATION_IN_PROGRESS: "AI_IMAGE_GENERATION_IN_PROGRESS",
	AI_IMAGE_MONTHLY_LIMIT_REACHED: "AI_IMAGE_MONTHLY_LIMIT_REACHED",
	AI_IMAGE_CREDITS_EXHAUSTED: "AI_IMAGE_CREDITS_EXHAUSTED",
	AI_IMAGE_GENERATION_FAILED: "AI_IMAGE_GENERATION_FAILED",
} as const;

export const DEFAULT_ERROR_MESSAGES = {
	[ERROR_NAMES.NOT_AUTHENTICATED]: "Not authenticated",
	[ERROR_NAMES.NOT_AUTHORIZED]: "Not authorized",
	[ERROR_NAMES.NOT_FOUND]: "Not found",
	[ERROR_NAMES.BAD_REQUEST]: "Bad request",
	[ERROR_NAMES.INTERNAL_SERVER_ERROR]: "Internal server error",
	[ERROR_NAMES.SERVICE_UNAVAILABLE]: "Service unavailable",
	[ERROR_NAMES.TIMEOUT]: "Timeout",
	[ERROR_NAMES.CONFLICT]: "Conflict",
	[ERROR_NAMES.VALIDATION_ERROR]: "Validation error",
	[ERROR_NAMES.IDEMPOTENCY_KEY_CONFLICT]: "Idempotency key conflict",
	[ERROR_NAMES.INVALID_AUCTION_STATE]: "Invalid auction state",
	[ERROR_NAMES.APP_URL_NOT_CONFIGURED]: "App URL not configured",
	[ERROR_NAMES.RATE_LIMITED]: "Too many requests, please try again later",
	[ERROR_NAMES.AI_IMAGE_GENERATION_IN_PROGRESS]:
		"An image is already being generated for this item",
	[ERROR_NAMES.AI_IMAGE_MONTHLY_LIMIT_REACHED]:
		"This organization has used its generated images for the month",
	[ERROR_NAMES.AI_IMAGE_CREDITS_EXHAUSTED]: "Image generation credits are exhausted",
	[ERROR_NAMES.AI_IMAGE_GENERATION_FAILED]: "Image generation failed",
} as const;

export interface CustomErrorObject {
	name: string;
	message: string;
}

export type NotAuthenticatedErrorObject = CustomErrorObject & {
	name: (typeof ERROR_NAMES)[`${typeof ERROR_NAMES.NOT_AUTHENTICATED}`];
};
export type NotAuthorizedErrorObject = CustomErrorObject & {
	name: (typeof ERROR_NAMES)[`${typeof ERROR_NAMES.NOT_AUTHORIZED}`];
};
export type NotFoundErrorObject = CustomErrorObject & {
	name: (typeof ERROR_NAMES)[`${typeof ERROR_NAMES.NOT_FOUND}`];
};
export type UserInputValidationErrorObject = CustomErrorObject & {
	name: (typeof ERROR_NAMES)[`${typeof ERROR_NAMES.VALIDATION_ERROR}`];
	fields?: { field: string; message: string }[];
};
export type IdempotencyKeyConflictErrorObject = CustomErrorObject & {
	name: (typeof ERROR_NAMES)[`${typeof ERROR_NAMES.IDEMPOTENCY_KEY_CONFLICT}`];
};
export type ConflictErrorObject = CustomErrorObject & {
	name: (typeof ERROR_NAMES)[`${typeof ERROR_NAMES.CONFLICT}`];
};
export type InvalidAuctionStateErrorObject = CustomErrorObject & {
	name: (typeof ERROR_NAMES)[`${typeof ERROR_NAMES.INVALID_AUCTION_STATE}`];
};
export type AppUrlNotConfiguredErrorObject = CustomErrorObject & {
	name: (typeof ERROR_NAMES)[`${typeof ERROR_NAMES.APP_URL_NOT_CONFIGURED}`];
};
export type RateLimitedErrorObject = CustomErrorObject & {
	name: (typeof ERROR_NAMES)[`${typeof ERROR_NAMES.RATE_LIMITED}`];
};

export function fromErrorObject(obj: CustomErrorObject): Error {
	const error = new Error(obj.message);
	error.name = obj.name;
	return error;
}

export interface CustomErrorProps {
	message: string;
	name?: string;
}

class CustomError extends Error {
	constructor(err: CustomErrorProps) {
		super(err.message);
		this.name = err.name ?? "CustomError";
	}

	toObject(): CustomErrorObject {
		return {
			name: this.name,
			message: this.message,
		};
	}
}

export class NotAuthenticatedError extends CustomError {
	constructor(message?: string) {
		super({
			message: message ?? DEFAULT_ERROR_MESSAGES[ERROR_NAMES.NOT_AUTHENTICATED],
			name: ERROR_NAMES.NOT_AUTHENTICATED,
		});
	}

	override toObject(): NotAuthenticatedErrorObject {
		return {
			name: ERROR_NAMES.NOT_AUTHENTICATED,
			message: this.message,
		};
	}
}

export class NotAuthorizedError extends CustomError {
	constructor(message?: string) {
		super({
			message: message ?? DEFAULT_ERROR_MESSAGES[ERROR_NAMES.NOT_AUTHORIZED],
			name: ERROR_NAMES.NOT_AUTHORIZED,
		});
	}

	override toObject(): NotAuthorizedErrorObject {
		return {
			name: ERROR_NAMES.NOT_AUTHORIZED,
			message: this.message,
		};
	}
}

export class NotFoundError extends CustomError {
	constructor(message?: string) {
		super({
			message: message ?? DEFAULT_ERROR_MESSAGES[ERROR_NAMES.NOT_FOUND],
			name: ERROR_NAMES.NOT_FOUND,
		});
	}

	override toObject(): NotFoundErrorObject {
		return {
			name: ERROR_NAMES.NOT_FOUND,
			message: this.message,
		};
	}
}

export class UserInputValidationError extends CustomError {
	readonly fields: { field: string; message: string }[];

	constructor(
		props: Omit<CustomErrorProps, "message"> & {
			message?: string;
			fields?: { field: string; message: string }[];
		}
	) {
		const message =
			props.fields?.map((field) => `${field.field}: ${field.message}`).join(", ") ??
			props.message ??
			"Validation error";
		super({ message, name: ERROR_NAMES.VALIDATION_ERROR });
		this.fields = props.fields ?? [];
	}

	override toObject(): UserInputValidationErrorObject {
		return {
			name: this.name as (typeof ERROR_NAMES)["VALIDATION_ERROR"],
			message: this.message,
			fields: this.fields,
		};
	}
}

export class ConflictError extends CustomError {
	constructor(message?: string) {
		super({
			message: message ?? DEFAULT_ERROR_MESSAGES[ERROR_NAMES.CONFLICT],
			name: ERROR_NAMES.CONFLICT,
		});
	}

	override toObject(): ConflictErrorObject {
		return {
			name: ERROR_NAMES.CONFLICT,
			message: this.message,
		};
	}
}

export class IdempotencyKeyConflictError extends CustomError {
	constructor(message?: string) {
		super({
			message: message ?? DEFAULT_ERROR_MESSAGES[ERROR_NAMES.IDEMPOTENCY_KEY_CONFLICT],
			name: ERROR_NAMES.IDEMPOTENCY_KEY_CONFLICT,
		});
	}

	override toObject(): IdempotencyKeyConflictErrorObject {
		return {
			name: ERROR_NAMES.IDEMPOTENCY_KEY_CONFLICT,
			message: this.message,
		};
	}
}

export class InvalidAuctionStateError extends CustomError {
	constructor(message?: string) {
		super({
			message: message ?? DEFAULT_ERROR_MESSAGES[ERROR_NAMES.INVALID_AUCTION_STATE],
			name: ERROR_NAMES.INVALID_AUCTION_STATE,
		});
	}

	override toObject(): InvalidAuctionStateErrorObject {
		return {
			name: ERROR_NAMES.INVALID_AUCTION_STATE,
			message: this.message,
		};
	}
}

export class AppUrlNotConfiguredError extends CustomError {
	constructor(message?: string) {
		super({
			message: message ?? DEFAULT_ERROR_MESSAGES[ERROR_NAMES.APP_URL_NOT_CONFIGURED],
			name: ERROR_NAMES.APP_URL_NOT_CONFIGURED,
		});
	}

	override toObject(): AppUrlNotConfiguredErrorObject {
		return {
			name: ERROR_NAMES.APP_URL_NOT_CONFIGURED,
			message: this.message,
		};
	}
}
export class RateLimitedError extends CustomError {
	constructor(message?: string) {
		super({
			message: message ?? DEFAULT_ERROR_MESSAGES[ERROR_NAMES.RATE_LIMITED],
			name: ERROR_NAMES.RATE_LIMITED,
		});
	}

	override toObject(): RateLimitedErrorObject {
		return {
			name: ERROR_NAMES.RATE_LIMITED,
			message: this.message,
		};
	}
}

export type MenuAIImageErrorName =
	| typeof ERROR_NAMES.AI_IMAGE_GENERATION_IN_PROGRESS
	| typeof ERROR_NAMES.AI_IMAGE_MONTHLY_LIMIT_REACHED
	| typeof ERROR_NAMES.AI_IMAGE_CREDITS_EXHAUSTED
	| typeof ERROR_NAMES.AI_IMAGE_GENERATION_FAILED;

export type MenuAIImageErrorObject = CustomErrorObject & { name: MenuAIImageErrorName };

/** AI menu image generation refusals (workstream B). The name is the stable code the UI maps. */
export class MenuAIImageError extends CustomError {
	readonly errorName: MenuAIImageErrorName;

	constructor(name: MenuAIImageErrorName, message?: string) {
		super({ message: message ?? DEFAULT_ERROR_MESSAGES[name], name });
		this.errorName = name;
	}

	override toObject(): MenuAIImageErrorObject {
		return { name: this.errorName, message: this.message };
	}
}
