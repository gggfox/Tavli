/** Limits and guards for PDF menu document parsing (TAVLI-18). */

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 50;

/** Stable code for a PDF over {@link MAX_PDF_BYTES}; mapped to `errors.<CODE>` by the frontend. */
export const PDF_TOO_LARGE_ERROR = "ERROR_MENU_IMPORT_FILE_TOO_LARGE";

export function isPdfBufferWithinLimits(buffer: Buffer): boolean {
	return buffer.byteLength <= MAX_PDF_BYTES;
}

/**
 * Last-line guard inside the PDF parser. The import action checks
 * {@link isPdfBufferWithinLimits} first and *returns* the code, because a
 * thrown error's message does not survive to the client in production.
 */
export function assertPdfBufferWithinLimits(buffer: Buffer): void {
	if (!isPdfBufferWithinLimits(buffer)) {
		throw new Error(PDF_TOO_LARGE_ERROR);
	}
}
