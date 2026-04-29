import { InlineEditInput } from "@/global/components";
import { MenusKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import type { Doc, Id } from "convex/_generated/dataModel";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface MenuItemTranslationRowProps {
	item: Doc<"menuItems"> & { imageUrl?: string | null };
	selectedLang: string;
	onSaveTranslation: (args: {
		itemId: Id<"menuItems">;
		lang: string;
		name?: string;
		description?: string;
	}) => Promise<unknown>;
}

export function MenuItemTranslationRow({
	item,
	selectedLang,
	onSaveTranslation,
}: Readonly<MenuItemTranslationRowProps>) {
	const { t } = useTranslation();
	const translatedName = item.translations?.[selectedLang]?.name ?? "";
	const translatedDesc = item.translations?.[selectedLang]?.description ?? "";
	const isMissing = !translatedName;

	return (
		<div
			className="px-3 py-2.5 rounded-lg space-y-2 bg-background"
			style={{border: isMissing ? "1px solid var(--accent-warning)" : "1px solid var(--border-default)"}}
		>
			<div className="flex items-center gap-2.5">
				{item.imageUrl ? (
					<img
						src={item.imageUrl}
						alt={item.name}
						className="w-8 h-8 rounded object-cover flex-shrink-0 opacity-60"
					/>
				) : (
					<div
						className="w-8 h-8 rounded flex-shrink-0 bg-muted"
						
					/>
				)}
				<div className="flex-1 min-w-0 space-y-1.5">
					<div className="flex items-center gap-2">
						<span className="text-xs shrink-0 text-faint-foreground" >
							{item.name} &rarr;
						</span>
						<InlineEditInput
							value={translatedName}
							placeholder={t(MenusKeys.TRANSLATION_NAME_PLACEHOLDER, { name: item.name })}
							onSave={(val) =>
								onSaveTranslation({
									itemId: item._id,
									lang: selectedLang,
									name: val,
								})
							}
						/>
						{isMissing && (
							<AlertTriangle
								size={14}
								className="shrink-0 text-warning"
								
							/>
						)}
					</div>
					{(item.description || translatedDesc) && (
						<div className="flex items-center gap-2">
							<span className="text-xs shrink-0 text-faint-foreground" >
								{t(MenusKeys.TRANSLATION_DESC_LABEL)} &rarr;
							</span>
							<InlineEditInput
								value={translatedDesc}
								placeholder={t(MenusKeys.TRANSLATION_DESC_PLACEHOLDER)}
								onSave={(val) =>
									onSaveTranslation({
										itemId: item._id,
										lang: selectedLang,
										description: val,
									})
								}
							/>
						</div>
					)}
				</div>
				<span className="text-xs shrink-0 text-faint-foreground" >
					${formatCents(item.basePrice)}
				</span>
			</div>
		</div>
	);
}
