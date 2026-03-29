import { unwrapResult } from "@/global/utils/unwrapResult";
import type { Id } from "convex/_generated/dataModel";

export async function uploadImage(
	generateUploadUrl: () => Promise<[string, null] | [null, any]>,
	file: File
): Promise<Id<"_storage">> {
	const url = unwrapResult(await generateUploadUrl()) as string;
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": file.type },
		body: file,
	});
	const { storageId } = await response.json();
	return storageId as Id<"_storage">;
}

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
