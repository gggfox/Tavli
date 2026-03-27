import { describe, expect, it } from "vitest";
import {
	DEFAULT_ERROR_MESSAGES,
	ERROR_NAMES,
	fromErrorObject,
	IdempotencyKeyConflictError,
	NotAuthenticatedError,
	NotAuthorizedError,
	NotFoundError,
	UserInputValidationError,
} from "./errors";

describe("ERROR_NAMES", () => {
	it("contains all expected error names", () => {
		expect(ERROR_NAMES.NOT_AUTHENTICATED).toBe("NOT_AUTHENTICATED");
		expect(ERROR_NAMES.NOT_AUTHORIZED).toBe("NOT_AUTHORIZED");
		expect(ERROR_NAMES.NOT_FOUND).toBe("NOT_FOUND");
		expect(ERROR_NAMES.BAD_REQUEST).toBe("BAD_REQUEST");
		expect(ERROR_NAMES.INTERNAL_SERVER_ERROR).toBe("INTERNAL_SERVER_ERROR");
		expect(ERROR_NAMES.VALIDATION_ERROR).toBe("VALIDATION_ERROR");
		expect(ERROR_NAMES.IDEMPOTENCY_KEY_CONFLICT).toBe("IDEMPOTENCY_KEY_CONFLICT");
	});
});

describe("DEFAULT_ERROR_MESSAGES", () => {
	it("has a default message for every error name", () => {
		for (const key of Object.values(ERROR_NAMES)) {
			expect(DEFAULT_ERROR_MESSAGES[key]).toBeDefined();
			expect(typeof DEFAULT_ERROR_MESSAGES[key]).toBe("string");
		}
	});
});

describe("fromErrorObject", () => {
	it("creates an Error from a CustomErrorObject", () => {
		const obj = { name: "NOT_FOUND", message: "Item not found" };
		const error = fromErrorObject(obj);

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("NOT_FOUND");
		expect(error.message).toBe("Item not found");
	});

	it("round-trips through toObject()/fromErrorObject()", () => {
		const original = new NotFoundError("Missing record");
		const obj = original.toObject();
		const restored = fromErrorObject(obj);

		expect(restored.name).toBe(original.name);
		expect(restored.message).toBe(original.message);
	});
});

describe("NotAuthenticatedError", () => {
	it("uses default message when none provided", () => {
		const error = new NotAuthenticatedError();
		expect(error.message).toBe(DEFAULT_ERROR_MESSAGES.NOT_AUTHENTICATED);
		expect(error.name).toBe(ERROR_NAMES.NOT_AUTHENTICATED);
	});

	it("uses custom message when provided", () => {
		const error = new NotAuthenticatedError("Token expired");
		expect(error.message).toBe("Token expired");
	});

	it("serialises to object correctly", () => {
		const obj = new NotAuthenticatedError().toObject();
		expect(obj.name).toBe(ERROR_NAMES.NOT_AUTHENTICATED);
		expect(obj.message).toBe(DEFAULT_ERROR_MESSAGES.NOT_AUTHENTICATED);
	});
});

describe("NotAuthorizedError", () => {
	it("uses default message when none provided", () => {
		const error = new NotAuthorizedError();
		expect(error.message).toBe(DEFAULT_ERROR_MESSAGES.NOT_AUTHORIZED);
		expect(error.name).toBe(ERROR_NAMES.NOT_AUTHORIZED);
	});

	it("serialises to object correctly", () => {
		const obj = new NotAuthorizedError("Role missing").toObject();
		expect(obj.name).toBe(ERROR_NAMES.NOT_AUTHORIZED);
		expect(obj.message).toBe("Role missing");
	});
});

describe("NotFoundError", () => {
	it("uses default message when none provided", () => {
		const error = new NotFoundError();
		expect(error.message).toBe(DEFAULT_ERROR_MESSAGES.NOT_FOUND);
	});

	it("serialises to object correctly", () => {
		const obj = new NotFoundError("Restaurant not found").toObject();
		expect(obj.name).toBe(ERROR_NAMES.NOT_FOUND);
		expect(obj.message).toBe("Restaurant not found");
	});
});

describe("UserInputValidationError", () => {
	it("builds message from fields", () => {
		const error = new UserInputValidationError({
			fields: [
				{ field: "name", message: "required" },
				{ field: "slug", message: "taken" },
			],
		});
		expect(error.message).toBe("name: required, slug: taken");
		expect(error.name).toBe(ERROR_NAMES.VALIDATION_ERROR);
		expect(error.fields).toHaveLength(2);
	});

	it("uses explicit message when no fields provided", () => {
		const error = new UserInputValidationError({ message: "Invalid input" });
		expect(error.message).toBe("Invalid input");
		expect(error.fields).toEqual([]);
	});

	it("falls back to generic message when neither fields nor message provided", () => {
		const error = new UserInputValidationError({});
		expect(error.message).toBe("Validation error");
	});

	it("serialises to object with fields", () => {
		const fields = [{ field: "email", message: "invalid format" }];
		const obj = new UserInputValidationError({ fields }).toObject();
		expect(obj.name).toBe(ERROR_NAMES.VALIDATION_ERROR);
		expect(obj.fields).toEqual(fields);
	});
});

describe("IdempotencyKeyConflictError", () => {
	it("uses default message when none provided", () => {
		const error = new IdempotencyKeyConflictError();
		expect(error.message).toBe(DEFAULT_ERROR_MESSAGES.IDEMPOTENCY_KEY_CONFLICT);
		expect(error.name).toBe(ERROR_NAMES.IDEMPOTENCY_KEY_CONFLICT);
	});

	it("serialises to object correctly", () => {
		const obj = new IdempotencyKeyConflictError("Duplicate key").toObject();
		expect(obj.name).toBe(ERROR_NAMES.IDEMPOTENCY_KEY_CONFLICT);
		expect(obj.message).toBe("Duplicate key");
	});
});
