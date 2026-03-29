import { InlineEditInput } from "@/global/components";
import { formatCents } from "@/global/utils/money";
import type { Doc, Id } from "convex/_generated/dataModel";
import { AlertTriangle } from "lucide-react";

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
	const translatedName = item.translations?.[selectedLang]?.name ?? "";
	const translatedDesc = item.translations?.[selectedLang]?.description ?? "";
	const isMissing = !translatedName;

	return (
		<div
			className="px-3 py-2.5 rounded-lg space-y-2"
			style={{
				backgroundColor: "var(--bg-primary)",
				border: isMissing ? "1px solid var(--accent-warning)" : "1px solid var(--border-default)",
			}}
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
						className="w-8 h-8 rounded flex-shrink-0"
						style={{ backgroundColor: "var(--bg-secondary)" }}
					/>
				)}
				<div className="flex-1 min-w-0 space-y-1.5">
					<div className="flex items-center gap-2">
						<span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
							{item.name} &rarr;
						</span>
						<InlineEditInput
							value={translatedName}
							placeholder={`${item.name} translation...`}
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
								className="shrink-0"
								style={{ color: "var(--accent-warning)" }}
							/>
						)}
					</div>
					{(item.description || translatedDesc) && (
						<div className="flex items-center gap-2">
							<span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
								desc &rarr;
							</span>
							<InlineEditInput
								value={translatedDesc}
								placeholder="Description translation..."
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
				<span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
					${formatCents(item.basePrice)}
				</span>
			</div>
		</div>
	);
}
