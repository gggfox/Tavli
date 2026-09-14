import { unwrapResult } from "@/global/utils/unwrapResult";
import type { Id } from "convex/_generated/dataModel";

export async function uploadImage(
	generateUploadUrl: () => Promise<[string, null] | [null, unknown]>,
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
