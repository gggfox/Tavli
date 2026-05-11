/**
 * Decode a base64-encoded xlsx string and trigger a browser download.
 *
 * The export Convex actions return their workbook as base64 because action
 * responses must be JSON-serialisable. We turn it back into a Uint8Array
 * here, wrap it in a Blob with the xlsx mime type, and let the browser
 * handle saving via a synthetic anchor click.
 */
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function base64ToUint8Array(base64: string): Uint8Array {
	const binary = atob(base64);
	const length = binary.length;
	const bytes = new Uint8Array(length);
	for (let i = 0; i < length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export function downloadBase64Xlsx(
	base64: string,
	filename: string,
	mimeType: string = XLSX_MIME
): void {
	const bytes = base64ToUint8Array(base64);
	// Cast to BlobPart explicitly: Uint8Array<ArrayBufferLike> is structurally
	// compatible but some TS DOM lib versions reject it without a cast.
	const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
