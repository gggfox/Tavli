/**
 * Pull an image out of a paste.
 *
 * Lives in `global` rather than beside the first caller: menu item photos
 * (`ItemImageManager`) and restaurant branding slots (`BrandingImageUploader`)
 * both take pasted images, and they sit in different feature slices. The
 * reading of a `DataTransfer` has nothing to do with either domain.
 *
 * Returns `null` for a paste carrying no image — plain text, a file of another
 * type, or an event whose `clipboardData` the browser withheld. Callers treat
 * that as "not for us" and leave the event alone.
 */
export function getImageFromClipboard(e: React.ClipboardEvent): File | null {
	const items = e.clipboardData?.items;
	if (!items) return null;
	for (const item of items) {
		if (item.type.startsWith("image/")) {
			return item.getAsFile();
		}
	}
	return null;
}
