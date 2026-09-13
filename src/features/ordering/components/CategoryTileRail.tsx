/**
 * "Explore the menu": a row of category tiles at the top of the menu, one
 * tap to jump. A tile shows the category's first dish photo, or its initial
 * on a brand-tinted square where no dish has one. The Rappi pattern — it is
 * the index while it is on screen; once it scrolls away the chip strip takes
 * over (see `useScrolledPast` in `MenuBrowser`).
 */
import { OrderingKeys } from "@/global/i18n";
import { getTranslatedField } from "@/global/utils/translations";
import type { Doc } from "convex/_generated/dataModel";
import { useTranslation } from "react-i18next";

interface CategoryTileRailProps {
	readonly categories: readonly Doc<"menuCategories">[];
	/** Category id → image url, from `firstImageByCategory`. */
	readonly tileImages: ReadonlyMap<string, string>;
	readonly onJump: (categoryId: string) => void;
	readonly lang?: string;
}

export function CategoryTileRail({
	categories,
	tileImages,
	onJump,
	lang,
}: Readonly<CategoryTileRailProps>) {
	const { t } = useTranslation();
	return (
		<div>
			<p className="px-4 text-sm font-semibold text-foreground mb-2">
				{t(OrderingKeys.MENU_EXPLORE)}
			</p>
			<div className="overflow-x-auto">
				<div className="flex w-max gap-3 px-4 pb-1">
					{categories.map((category) => {
						const label = getTranslatedField(category, lang);
						const image = tileImages.get(category._id);
						return (
							<button
								key={category._id}
								type="button"
								onClick={() => onJump(category._id)}
								className="w-20 shrink-0 text-center"
							>
								{image ? (
									<img
										src={image}
										alt=""
										loading="lazy"
										decoding="async"
										className="h-20 w-20 rounded-2xl object-cover"
									/>
								) : (
									<div
										aria-hidden
										className="h-20 w-20 rounded-2xl flex items-center justify-center text-2xl font-bold"
										style={{
											backgroundColor:
												"color-mix(in srgb, var(--btn-primary-bg) 22%, var(--bg-secondary))",
											color: "var(--btn-primary-bg)",
										}}
									>
										{label.slice(0, 1).toUpperCase()}
									</div>
								)}
								<span className="mt-1 block text-[11px] leading-tight text-foreground line-clamp-2">
									{label}
								</span>
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
}
