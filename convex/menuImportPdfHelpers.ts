/** Limits and guards for PDF menu document parsing (TAVLI-18). */

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 50;

export function assertPdfBufferWithinLimits(buffer: Buffer): void {
	if (buffer.byteLength > MAX_PDF_BYTES) {
		throw new Error("PDF exceeds maximum allowed size");
	}
}
