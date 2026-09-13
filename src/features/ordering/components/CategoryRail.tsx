/**
 * Desktop index for the diner menu: a sticky left rail listing every category
 * with today's dish count, the current one marked. The DoorDash pattern —
 * chosen in the prototype review over horizontal chips, which waste a wide
 * screen and hide how big each section is.
 */
import { OrderingKeys } from "@/global/i18n";
import { getTranslatedField } from "@/global/utils/translations";
import type { Doc } from "convex/_generated/dataModel";
import { useTranslation } from "react-i18next";

interface CategoryRailProps {
	readonly categories: readonly Doc<"menuCategories">[];
	readonly counts: ReadonlyMap<string, number>;
	readonly activeId: string | null;
	readonly onJump: (categoryId: string) => void;
	readonly lang?: string;
	readonly className?: string;
}

export function CategoryRail({
	categories,
	counts,
	activeId,
	onJump,
	lang,
	className = "",
}: Readonly<CategoryRailProps>) {
	const { t } = useTranslation();
	return (
		<nav aria-label={t(OrderingKeys.MENU_FULL_MENU)} className={className}>
			<ul className="space-y-0.5">
				{categories.map((category) => {
					const isActive = category._id === activeId;
					return (
						<li key={category._id}>
							<button
								type="button"
								onClick={() => onJump(category._id)}
								aria-current={isActive ? "true" : undefined}
								className="w-full flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-left border-l-2 transition-colors hover-secondary"
								style={{
									borderColor: isActive ? "var(--btn-primary-bg)" : "transparent",
									color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
									fontWeight: isActive ? 600 : 400,
									backgroundColor: isActive ? "var(--bg-secondary)" : "transparent",
								}}
							>
								<span className="truncate">{getTranslatedField(category, lang)}</span>
								<span className="text-xs text-faint-foreground tabular-nums">
									{counts.get(category._id) ?? 0}
								</span>
							</button>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
