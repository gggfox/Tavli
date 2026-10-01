import { describe, expect, it } from "vitest";
import {
	assertPdfBufferWithinLimits,
	isPdfBufferWithinLimits,
	MAX_PDF_BYTES,
} from "../menuImportPdfHelpers";

describe("menuImportPdfHelpers", () => {
	it("accepts PDFs within the size limit", () => {
		expect(() => assertPdfBufferWithinLimits(Buffer.alloc(1024))).not.toThrow();
	});

	it("rejects PDFs exceeding the size limit", () => {
		expect(() => assertPdfBufferWithinLimits(Buffer.alloc(MAX_PDF_BYTES + 1))).toThrow(
			"ERROR_MENU_IMPORT_FILE_TOO_LARGE"
		);
		expect(isPdfBufferWithinLimits(Buffer.alloc(MAX_PDF_BYTES + 1))).toBe(false);
		expect(isPdfBufferWithinLimits(Buffer.alloc(MAX_PDF_BYTES))).toBe(true);
	});
});
