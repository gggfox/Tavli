/**
 * "Full menu" bottom sheet for phones: every category with today's dish
 * count, one tap to jump. The chip strip only ever shows a few categories at
 * a time; this is the whole index at once.
 */
import { OrderingKeys } from "@/global/i18n";
import { getTranslatedField } from "@/global/utils/translations";
import type { Doc } from "convex/_generated/dataModel";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface FullMenuSheetProps {
	readonly open: boolean;
	readonly categories: readonly Doc<"menuCategories">[];
	readonly counts: ReadonlyMap<string, number>;
	readonly activeId: string | null;
	readonly onJump: (categoryId: string) => void;
	readonly onClose: () => void;
	readonly lang?: string;
}

export function FullMenuSheet({
	open,
	categories,
	counts,
	activeId,
	onJump,
	onClose,
	lang,
}: Readonly<FullMenuSheetProps>) {
	const { t } = useTranslation();
	if (!open) return null;
	return (
		<div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onClose}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={t(OrderingKeys.MENU_FULL_MENU)}
				className="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-2xl bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between mb-1">
					<span className="text-base font-bold text-foreground">
						{t(OrderingKeys.MENU_FULL_MENU)}
					</span>
					<button
						type="button"
						onClick={onClose}
						aria-label={t(OrderingKeys.MENU_FULL_MENU_CLOSE)}
						className="p-1.5 rounded-full hover:bg-hover text-foreground"
					>
						<X size={18} />
					</button>
				</div>
				<ul>
					{categories.map((category) => {
						const isActive = category._id === activeId;
						return (
							<li key={category._id}>
								<button
									type="button"
									onClick={() => {
										onJump(category._id);
										onClose();
									}}
									aria-current={isActive ? "true" : undefined}
									className="w-full flex items-center justify-between gap-3 py-3 text-sm text-left border-b border-border"
									style={{ fontWeight: isActive ? 700 : 400 }}
								>
									<span className="text-foreground">{getTranslatedField(category, lang)}</span>
									<span className="text-faint-foreground tabular-nums">
										{counts.get(category._id) ?? 0}
									</span>
								</button>
							</li>
						);
					})}
				</ul>
			</div>
		</div>
	);
}
