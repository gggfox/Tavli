import { useConvexMutate } from "@/global/hooks";
import { MenusKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { formatCentsInput, parseDollarsToCents } from "@/global/utils/money";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { MENU_ITEM_IMAGE_SOURCE, PREP_STATION } from "convex/constants";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { uploadImage } from "../utils/imageUtils";

export type PrepStation = (typeof PREP_STATION)[keyof typeof PREP_STATION];
export type EditableMenuItem = Doc<"menuItems"> & { imageUrl?: string | null };

export interface ItemFields {
	name: string;
	/** The literal text of the price input; parsed to cents on save. */
	price: string;
	description: string;
	prepStation: PrepStation;
	isAvailable: boolean;
	optionGroupIds: Id<"optionGroups">[];
}

/**
 * The image the editor will commit on Guardar. `ai` is a generated draft
 * waiting for the manager's approval — saving approves it.
 */
export type ImageChange =
	| { kind: "keep" }
	| { kind: "file"; file: File; previewUrl: string }
	| { kind: "remove" }
	| { kind: "ai"; draftId: Id<"menuItemAIImageGenDrafts">; url: string };

const sameIds = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Everything the item editor edits — fields, visibility, option groups and the
 * image — held as one draft and committed by one Guardar.
 *
 * Edits are stored as overrides on top of the live item, so a field the
 * manager has not touched keeps following the server.
 */
export function useMenuItemDraft(item: EditableMenuItem) {
	const { t } = useTranslation();
	const linkedGroupsQuery = useQuery(
		convexQuery(api.optionGroups.getGroupsForMenuItem, { menuItemId: item._id })
	);
	const { data: generation } = useQuery(
		convexQuery(api.menuAIImageGen.getItemGeneration, { menuItemId: item._id })
	);

	const updateItem = useConvexMutate(api.menuItems.update);
	const removeImage = useConvexMutate(api.menuItems.removeImage);
	const approveDraft = useConvexMutate(api.menuAIImageGen.approveDraft);
	const rejectDraft = useConvexMutate(api.menuAIImageGen.rejectDraft);
	const startGeneration = useConvexMutate(api.menuAIImageGen.startGeneration);
	const generateUploadUrlMutation = useConvexMutation(api.menuItems.generateUploadUrl);

	const [edits, setEdits] = useState<Partial<ItemFields>>({});
	const [image, setImage] = useState<ImageChange>({ kind: "keep" });
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Free an object URL once its preview is replaced or the editor closes.
	useEffect(() => {
		if (image.kind !== "file") return;
		return () => URL.revokeObjectURL(image.previewUrl);
	}, [image]);

	const serverGroupIds = (linkedGroupsQuery.data ?? [])
		.filter((g): g is NonNullable<typeof g> => g != null)
		.sort((a, b) => a.linkDisplayOrder - b.linkDisplayOrder)
		.map((g) => g._id);

	const base: ItemFields = {
		name: item.name,
		price: formatCentsInput(item.basePrice),
		description: item.description ?? "",
		prepStation: item.prepStation ?? PREP_STATION.KITCHEN,
		isAvailable: item.isAvailable,
		optionGroupIds: serverGroupIds,
	};
	const fields: ItemFields = { ...base, ...edits };

	// A pending AI draft is shown as the image to approve unless the manager
	// has already picked something else.
	const pendingDraft = generation?.pendingDraft ?? null;
	const effectiveImage: ImageChange =
		image.kind === "keep" && pendingDraft
			? { kind: "ai", draftId: pendingDraft.draftId, url: pendingDraft.imageUrl }
			: image;
	const previewUrl =
		effectiveImage.kind === "file"
			? effectiveImage.previewUrl
			: effectiveImage.kind === "ai"
				? effectiveImage.url
				: effectiveImage.kind === "remove"
					? null
					: (item.imageUrl ?? null);

	const changed = {
		name: fields.name.trim() !== base.name,
		price: parseDollarsToCents(fields.price) !== item.basePrice,
		description: fields.description !== base.description,
		prepStation: fields.prepStation !== base.prepStation,
		isAvailable: fields.isAvailable !== base.isAvailable,
		optionGroupIds:
			linkedGroupsQuery.isSuccess && !sameIds(fields.optionGroupIds, base.optionGroupIds),
	};
	const imageChanged = effectiveImage.kind !== "keep";
	const dirty = imageChanged || Object.values(changed).some(Boolean);
	const priceCents = parseDollarsToCents(fields.price);
	const valid = fields.name.trim().length > 0 && !Number.isNaN(priceCents) && priceCents >= 0;

	const set = <K extends keyof ItemFields>(key: K, value: ItemFields[K]) =>
		setEdits((prev) => ({ ...prev, [key]: value }));

	const takeFile = (file: File | null | undefined) => {
		if (!file?.type.startsWith("image/")) return;
		setImage({ kind: "file", file, previewUrl: URL.createObjectURL(file) });
	};

	const reset = () => {
		setEdits({});
		setImage({ kind: "keep" });
		setError(null);
	};

	/** Commits the whole draft. Resolves `true` when everything saved. */
	const save = async (): Promise<boolean> => {
		if (!valid) return false;
		setSaving(true);
		setError(null);
		try {
			let imageStorageId: Id<"_storage"> | undefined;
			if (effectiveImage.kind === "ai") {
				unwrapResult(await approveDraft.mutateAsync({ draftId: effectiveImage.draftId }));
			} else if (effectiveImage.kind === "remove") {
				unwrapResult(await removeImage.mutateAsync({ itemId: item._id }));
			} else if (effectiveImage.kind === "file") {
				imageStorageId = await uploadImage(
					() =>
						generateUploadUrlMutation({ restaurantId: item.restaurantId }) as Promise<
							[string, null] | [null, unknown]
						>,
					effectiveImage.file
				);
			}

			const patch = {
				...(changed.name && { name: fields.name.trim() }),
				...(changed.price && { basePrice: priceCents }),
				...(changed.description && { description: fields.description }),
				...(changed.prepStation && { prepStation: fields.prepStation }),
				...(changed.isAvailable && { isAvailable: fields.isAvailable }),
				...(changed.optionGroupIds && { optionGroupIds: fields.optionGroupIds }),
				...(imageStorageId && { imageStorageId }),
			};
			if (Object.keys(patch).length > 0) {
				unwrapResult(await updateItem.mutateAsync({ itemId: item._id, ...patch }));
			}
			reset();
			return true;
		} catch (err) {
			setError(getErrorMessage(err, t, MenusKeys.ITEM_EDITOR_SAVE_FAILED));
			return false;
		} finally {
			setSaving(false);
		}
	};

	const generate = async () => {
		setError(null);
		try {
			// A fresh generation supersedes a file the manager picked but never saved.
			if (image.kind !== "keep") setImage({ kind: "keep" });
			unwrapResult(await startGeneration.mutateAsync({ menuItemId: item._id }));
		} catch (err) {
			setError(getErrorMessage(err, t, MenusKeys.AI_IMAGE_FAILED));
		}
	};

	/** Clears the pending image: rejects an AI draft (so it stops reappearing) or drops the current photo. */
	const clearImage = async () => {
		setError(null);
		if (effectiveImage.kind === "ai") {
			try {
				unwrapResult(await rejectDraft.mutateAsync({ draftId: effectiveImage.draftId }));
			} catch (err) {
				setError(getErrorMessage(err, t, MenusKeys.AI_IMAGE_FAILED));
			}
			setImage({ kind: "keep" });
			return;
		}
		setImage(item.imageUrl ? { kind: "remove" } : { kind: "keep" });
	};

	return {
		fields,
		set,
		dirty,
		valid,
		saving,
		error,
		reset,
		save,
		image: {
			change: effectiveImage,
			previewUrl,
			isAI:
				effectiveImage.kind === "ai" ||
				(effectiveImage.kind === "keep" && item.imageSource === MENU_ITEM_IMAGE_SOURCE.GENERATED),
			changed: imageChanged,
			takeFile,
			clear: clearImage,
			generate,
			generation,
			generating:
				startGeneration.isPending ||
				Boolean(generation?.activeJob && generation.activeJob.status !== "failed"),
			busy: approveDraft.isPending || rejectDraft.isPending,
		},
		optionGroupsLoading: linkedGroupsQuery.isPending,
	};
}

export type MenuItemDraft = ReturnType<typeof useMenuItemDraft>;
