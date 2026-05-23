import { unwrapResult } from "@/global/utils/unwrapResult";
import { useConvexAction, useConvexMutation } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useCallback, useState } from "react";
import type { MenuExtraction } from "../../../../convex/menuImport";

type ImportStep = "idle" | "uploading" | "extracting" | "preview" | "inserting" | "done" | "error";

interface UseMenuImportOptions {
	restaurantId: Id<"restaurants"> | undefined;
}

export function useMenuImport({ restaurantId }: UseMenuImportOptions) {
	const [step, setStep] = useState<ImportStep>("idle");
	const [extraction, setExtraction] = useState<MenuExtraction | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<{
		categoriesCreated: number;
		categoriesMerged: number;
		itemsCreated: number;
	} | null>(null);

	const extractAction = useConvexAction(api.menuImport.extractMenuFromDocument);
	const generateUploadUrl = useConvexMutation(api.menuItems.generateUploadUrl);
	const batchInsert = useConvexMutation(api.menuImportMutation.batchInsertMenuCategories);

	const reset = useCallback(() => {
		setStep("idle");
		setExtraction(null);
		setError(null);
		setResult(null);
	}, []);

	const uploadAndExtract = useCallback(
		async (file: File) => {
			if (!restaurantId) return;

			try {
				setError(null);
				setStep("uploading");

				const uploadUrl = unwrapResult(await generateUploadUrl({ restaurantId })) as string;
				const response = await fetch(uploadUrl, {
					method: "POST",
					headers: { "Content-Type": file.type },
					body: file,
				});
				const { storageId } = await response.json();

				setStep("extracting");

				const extracted = await extractAction({
					storageId: storageId as Id<"_storage">,
					filename: file.name,
					restaurantId,
				});

				setExtraction(extracted);
				setStep("preview");
			} catch (err) {
				setError(err instanceof Error ? err.message : "Extraction failed");
				setStep("error");
			}
		},
		[restaurantId, generateUploadUrl, extractAction]
	);

	const confirmImport = useCallback(
		async (menuId: Id<"menus">, newMenuName?: string) => {
			if (!restaurantId || !extraction) return;

			try {
				setStep("inserting");

				const importResult = unwrapResult(
					await batchInsert({
						restaurantId,
						menuId,
						newMenuName,
						categories: extraction.categories.map((cat) => ({
							name: cat.name,
							description: cat.description,
							items: cat.items.map((item) => ({
								name: item.name,
								description: item.description,
								priceInCents: item.priceInCents,
							})),
						})),
					})
				) as { categoriesCreated: number; categoriesMerged: number; itemsCreated: number };

				setResult(importResult);
				setStep("done");
			} catch (err) {
				setError(err instanceof Error ? err.message : "Import failed");
				setStep("error");
			}
		},
		[restaurantId, extraction, batchInsert]
	);

	return {
		step,
		extraction,
		error,
		result,
		uploadAndExtract,
		confirmImport,
		reset,
	};
}
