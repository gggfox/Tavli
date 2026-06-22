import { describe, expect, it } from "vitest";
import { assertPdfBufferWithinLimits, MAX_PDF_BYTES } from "../menuImportPdfHelpers";

describe("menuImportPdfHelpers", () => {
	it("accepts PDFs within the size limit", () => {
		expect(() => assertPdfBufferWithinLimits(Buffer.alloc(1024))).not.toThrow();
	});

	it("rejects PDFs exceeding the size limit", () => {
		expect(() => assertPdfBufferWithinLimits(Buffer.alloc(MAX_PDF_BYTES + 1))).toThrow(
			"PDF exceeds maximum allowed size"
		);
	});
});
