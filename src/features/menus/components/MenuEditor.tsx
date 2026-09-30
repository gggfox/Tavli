import { useMenuExport } from "@/features/exports";
import { EmptyState } from "@/global/components";
import { useAdminPageToolbar, useConvexMutate, useMediaQuery } from "@/global/hooks";
import { useFuzzyMatch } from "@/global/hooks/useFuzzyMatch";
import { ExportsKeys, Languages, MenusKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { PREP_STATION } from "convex/constants";
import { LayoutGrid } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EditableMenuItem } from "../hooks/useMenuItemDraft";
import { useCategories, useMenus } from "../hooks/useMenus";
import { toggleSection, toggleSelection } from "../utils/selection";
import { CategoryIndex } from "./CategoryIndex";
import { CategorySection } from "./CategorySection";
import { ItemEditorDialog } from "./itemEditor/ItemEditorDialog";
import { ItemEditorInspector } from "./itemEditor/ItemEditorInspector";
import { MenuEditorToolbar } from "./MenuEditorToolbar";
import { MenuLanguageSettings } from "./MenuLanguageSettings";
import { OptionGroupManagerModal } from "./OptionGroupManagerModal";

interface MenuEditorProps {
	menuId: Id<"menus">;
	restaurantId: Id<"restaurants">;
	onTranslationModeChange?: (isTranslationMode: boolean) => void;
	onAddCategoriesClick?: () => void;
	/** Offer Export in the phone toolbar's ⋯ menu (the page header hides it there). */
	canExport?: boolean;
}

interface EditingTarget {
	itemId: Id<"menuItems">;
	categoryId: Id<"menuCategories">;
}

/** Where the item editor opens: the right column from this width, a dialog below it. */
const DESKTOP_QUERY = "(min-width: 1024px)";

export function MenuEditor({
	menuId,
	restaurantId,
	onTranslationModeChange,
	onAddCategoriesClick,
	canExport = false,
}: Readonly<MenuEditorProps>) {
	const { t } = useTranslation();
	const { data: menu } = useQuery(convexQuery(api.menus.getByIdForStaff, { menuId }));
	const { categories } = useCategories(menuId);
	const { deleteCategory, updateMenu } = useMenus(restaurantId);
	const { exportMenu } = useMenuExport(restaurantId);
	const bulkRemoveItems = useConvexMutate(api.menuItems.bulkRemove);
	const bulkSetAvailability = useConvexMutate(api.menuItems.bulkSetAvailability);
	const bulkSetPrepStation = useConvexMutate(api.menuItems.bulkSetPrepStation);
	const isDesktop = useMediaQuery(DESKTOP_QUERY);

	const defaultLang = menu?.defaultLanguage ?? Languages.EN;
	const supportedLangs = useMemo(
		() => menu?.supportedLanguages ?? [defaultLang],
		[menu?.supportedLanguages, defaultLang]
	);
	const [selectedLang, setSelectedLang] = useState(defaultLang);
	const isTranslationMode = selectedLang !== defaultLang;
	const filterLang = isTranslationMode ? selectedLang : defaultLang;

	const [langSettingsOpen, setLangSettingsOpen] = useState(false);
	const [optionGroupsModalOpen, setOptionGroupsModalOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const deferredSearchQuery = useDeferredValue(searchQuery);
	const { isActive: isFilterActive } = useFuzzyMatch(deferredSearchQuery);
	const [filterVisibility, setFilterVisibility] = useState<Record<string, boolean>>({});
	const [selectedIds, setSelectedIds] = useState(() => new Set<Id<"menuItems">>());
	const selectionAnchor = useRef<Id<"menuItems"> | null>(null);
	const [visibleItemIdsByCategory, setVisibleItemIdsByCategory] = useState<
		Record<string, Id<"menuItems">[]>
	>({});
	const [categoryExpanded, setCategoryExpanded] = useState<Record<string, boolean>>({});
	const [editing, setEditing] = useState<EditingTarget | null>(null);

	useEffect(() => {
		onTranslationModeChange?.(isTranslationMode);
	}, [isTranslationMode, onTranslationModeChange]);

	useEffect(() => {
		if (isTranslationMode) {
			setSelectedIds(new Set());
			setEditing(null);
		}
	}, [isTranslationMode]);

	const sorted = [...categories].sort((a, b) => a.displayOrder - b.displayOrder);
	const categoryIdsFingerprint = sorted.map((c) => c._id).join(",");

	useEffect(() => {
		setFilterVisibility({});
		setVisibleItemIdsByCategory({});
	}, [deferredSearchQuery, categoryIdsFingerprint]);

	const handleFilterVisibility = useCallback((categoryId: string, visible: boolean) => {
		setFilterVisibility((prev) =>
			prev[categoryId] === visible ? prev : { ...prev, [categoryId]: visible }
		);
	}, []);

	const handleVisibleItemIdsChange = useCallback(
		(categoryId: string, itemIds: Id<"menuItems">[]) => {
			setVisibleItemIdsByCategory((prev) =>
				prev[categoryId]?.join(",") === itemIds.join(",")
					? prev
					: { ...prev, [categoryId]: itemIds }
			);
		},
		[]
	);

	const visibleCategories = isFilterActive
		? sorted.filter((cat) => filterVisibility[cat._id] === true)
		: sorted;
	/** Every visible item, in on-screen order — the order Shift+click ranges follow. */
	const orderedVisibleIds = visibleCategories.flatMap(
		(cat) => visibleItemIdsByCategory[cat._id] ?? []
	);
	const orderedVisibleKey = orderedVisibleIds.join(",");

	// Items that leave the view (filtered out, deleted) leave the selection.
	useEffect(() => {
		const visible = new Set(orderedVisibleKey.split(","));
		setSelectedIds((prev) => {
			const next = new Set([...prev].filter((id) => visible.has(id)));
			return next.size === prev.size ? prev : next;
		});
	}, [orderedVisibleKey]);

	// Esc clears the selection, unless an editor is open (Esc closes that first).
	useEffect(() => {
		if (editing || selectedIds.size === 0) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setSelectedIds(new Set());
		};
		globalThis.addEventListener("keydown", onKey);
		return () => globalThis.removeEventListener("keydown", onKey);
	}, [editing, selectedIds.size]);

	const toggleItem = (itemId: Id<"menuItems">, e: { shiftKey: boolean }) => {
		setSelectedIds((prev) =>
			toggleSelection(prev, itemId, orderedVisibleIds, selectionAnchor.current, e.shiftKey)
		);
		selectionAnchor.current = itemId;
	};

	const anyVisibleCategoryExpanded = visibleCategories.some(
		(cat) => categoryExpanded[cat._id] !== false
	);
	const toggleAllCategories = () => {
		const nextExpanded = !anyVisibleCategoryExpanded;
		setCategoryExpanded((prev) => {
			const next = { ...prev };
			for (const cat of visibleCategories) next[cat._id] = nextExpanded;
			return next;
		});
	};

	const selectedCategoryCount = visibleCategories.filter((cat) =>
		(visibleItemIdsByCategory[cat._id] ?? []).some((id) => selectedIds.has(id))
	).length;

	const runBulk = async (fn: (itemIds: Id<"menuItems">[]) => Promise<unknown>) => {
		const itemIds = [...selectedIds];
		if (itemIds.length === 0) return;
		await fn(itemIds);
		setSelectedIds(new Set());
	};

	const reportedCount = Object.keys(filterVisibility).length;
	const hasFilterMatch = !isFilterActive || Object.values(filterVisibility).some(Boolean);
	const showFilterNoMatches =
		isFilterActive && sorted.length > 0 && reportedCount === sorted.length && !hasFilterMatch;

	const handleDefaultLangChange = async (lang: string) => {
		const newSupported = supportedLangs.includes(lang) ? supportedLangs : [...supportedLangs, lang];
		await updateMenu({ menuId, defaultLanguage: lang, supportedLanguages: newSupported });
		if (selectedLang === defaultLang) setSelectedLang(lang);
	};

	const handleToggleLanguage = async (lang: string) => {
		if (lang === defaultLang) return;
		const newSupported = supportedLangs.includes(lang)
			? supportedLangs.filter((l) => l !== lang)
			: [...supportedLangs, lang];
		await updateMenu({ menuId, supportedLanguages: newSupported });
		if (!newSupported.includes(selectedLang)) setSelectedLang(defaultLang);
	};

	const toolbar = (
		<MenuEditorToolbar
			isTranslationMode={isTranslationMode}
			search={searchQuery}
			onSearchChange={setSearchQuery}
			languages={supportedLangs}
			defaultLanguage={defaultLang}
			selectedLanguage={selectedLang}
			onSelectLanguage={setSelectedLang}
			languageSettingsOpen={langSettingsOpen}
			onToggleLanguageSettings={() => setLangSettingsOpen((prev) => !prev)}
			onOpenOptionGroups={() => setOptionGroupsModalOpen(true)}
			anyExpanded={anyVisibleCategoryExpanded}
			canToggleAll={visibleCategories.length > 0}
			onToggleAll={toggleAllCategories}
			visibleItemCount={orderedVisibleIds.length}
			onSelectAll={() => setSelectedIds(new Set(orderedVisibleIds))}
			onExport={canExport ? () => void exportMenu() : undefined}
			exportLabel={t(ExportsKeys.BUTTON)}
			selection={{
				count: selectedIds.size,
				categoryCount: selectedCategoryCount,
				onClear: () => setSelectedIds(new Set()),
				onHide: () =>
					void runBulk(async (itemIds) =>
						unwrapResult(
							await bulkSetAvailability.mutateAsync({ restaurantId, itemIds, isAvailable: false })
						)
					),
				onShow: () =>
					void runBulk(async (itemIds) =>
						unwrapResult(
							await bulkSetAvailability.mutateAsync({ restaurantId, itemIds, isAvailable: true })
						)
					),
				onKitchen: () =>
					void runBulk(async (itemIds) =>
						unwrapResult(
							await bulkSetPrepStation.mutateAsync({
								restaurantId,
								itemIds,
								prepStation: PREP_STATION.KITCHEN,
							})
						)
					),
				onBar: () =>
					void runBulk(async (itemIds) =>
						unwrapResult(
							await bulkSetPrepStation.mutateAsync({
								restaurantId,
								itemIds,
								prepStation: PREP_STATION.BAR,
							})
						)
					),
				onDelete: () => {
					if (
						!globalThis.confirm(
							t(MenusKeys.EDITOR_BULK_DELETE_CONFIRM, { count: selectedIds.size })
						)
					)
						return;
					void runBulk(async (itemIds) =>
						unwrapResult(await bulkRemoveItems.mutateAsync({ restaurantId, itemIds }))
					);
				},
			}}
		/>
	);
	useAdminPageToolbar(toolbar);

	const editingCategory = editing ? sorted.find((c) => c._id === editing.categoryId) : undefined;
	const editor =
		editing && editingCategory ? (
			<EditingItem
				key={editing.itemId}
				target={editing}
				category={editingCategory}
				mode={isDesktop ? "inspector" : "dialog"}
				siblingIds={visibleItemIdsByCategory[editing.categoryId] ?? []}
				onGo={(itemId) => setEditing({ itemId, categoryId: editing.categoryId })}
				onClose={() => setEditing(null)}
			/>
		) : null;

	return (
		<div className="flex gap-8">
			<div className="flex min-w-0 flex-1 flex-col gap-5 pb-16">
				<OptionGroupManagerModal
					restaurantId={restaurantId}
					isOpen={optionGroupsModalOpen}
					onClose={() => setOptionGroupsModalOpen(false)}
				/>

				{langSettingsOpen && (
					<MenuLanguageSettings
						defaultLanguage={defaultLang}
						supportedLanguages={supportedLangs}
						onDefaultChange={handleDefaultLangChange}
						onToggleLanguage={handleToggleLanguage}
					/>
				)}

				{isTranslationMode && (
					<p className="text-xs text-faint-foreground">{t(MenusKeys.EDITOR_TRANSLATING_HINT)}</p>
				)}

				{showFilterNoMatches ? (
					<p className="text-sm text-muted-foreground">{t(MenusKeys.EDITOR_FILTER_NO_MATCHES)}</p>
				) : null}

				{sorted.map((cat) => (
					<CategorySection
						key={cat._id}
						category={cat}
						restaurantId={restaurantId}
						onDeleteCategory={() => deleteCategory({ categoryId: cat._id })}
						selectedLang={isTranslationMode ? selectedLang : undefined}
						searchQuery={deferredSearchQuery}
						filterLang={filterLang}
						onFilterVisibility={(visible) => handleFilterVisibility(cat._id, visible)}
						expanded={categoryExpanded[cat._id] ?? true}
						onExpandedChange={(nextExpanded) =>
							setCategoryExpanded((prev) => ({ ...prev, [cat._id]: nextExpanded }))
						}
						selectedIds={selectedIds}
						onToggleSelect={toggleItem}
						onToggleSection={(itemIds) => setSelectedIds((prev) => toggleSection(prev, itemIds))}
						editingItemId={editing?.itemId ?? null}
						onEditItem={(itemId) => setEditing({ itemId, categoryId: cat._id })}
						onVisibleItemIdsChange={(itemIds) => handleVisibleItemIdsChange(cat._id, itemIds)}
					/>
				))}
				{sorted.length === 0 && !isTranslationMode && (
					<EmptyState
						fill
						icon={LayoutGrid}
						title={t(MenusKeys.EDITOR_NO_CATEGORIES_TITLE)}
						description={t(MenusKeys.EDITOR_NO_CATEGORIES_DESCRIPTION)}
						action={
							onAddCategoriesClick ? (
								<button
									type="button"
									onClick={onAddCategoriesClick}
									className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
								>
									{t(MenusKeys.EDITOR_NO_CATEGORIES_ACTION)}
								</button>
							) : undefined
						}
					/>
				)}
			</div>

			{/* One fixed width for the index and the editor alike, so rows never reflow. */}
			{sorted.length > 0 ? (
				<div className="hidden w-[22rem] shrink-0 lg:block">
					{editor && isDesktop ? (
						editor
					) : (
						<CategoryIndex
							entries={visibleCategories.map((cat) => {
								const ids = visibleItemIdsByCategory[cat._id] ?? [];
								return {
									id: cat._id,
									name: isTranslationMode
										? cat.translations?.[selectedLang]?.name || cat.name
										: cat.name,
									itemCount: ids.length,
									selectedCount: ids.filter((id) => selectedIds.has(id)).length,
								};
							})}
							onJump={(id) => setCategoryExpanded((prev) => ({ ...prev, [id]: true }))}
							onAddCategory={isTranslationMode ? undefined : onAddCategoriesClick}
						/>
					)}
				</div>
			) : null}
			{editor && !isDesktop ? editor : null}
		</div>
	);
}

/**
 * Resolves the item being edited from its category's live list (the same
 * query the section already holds, so no extra fetch) and mounts the editor
 * shell for the viewport.
 */
function EditingItem({
	target,
	category,
	mode,
	siblingIds,
	onGo,
	onClose,
}: Readonly<{
	target: EditingTarget;
	category: Doc<"menuCategories">;
	mode: "inspector" | "dialog";
	siblingIds: Id<"menuItems">[];
	onGo: (itemId: Id<"menuItems">) => void;
	onClose: () => void;
}>) {
	const { data: items } = useQuery(
		convexQuery(api.menuItems.listByCategoryForStaff, { categoryId: target.categoryId })
	);
	const item = (items as EditableMenuItem[] | undefined)?.find((i) => i._id === target.itemId);

	// The item was deleted (here or elsewhere) while open.
	useEffect(() => {
		if (items && !item) onClose();
	}, [items, item, onClose]);

	if (!item) return null;
	return mode === "inspector" ? (
		<ItemEditorInspector item={item} categoryName={category.name} onClose={onClose} />
	) : (
		<ItemEditorDialog
			item={item}
			categoryName={category.name}
			siblingIds={siblingIds}
			onGo={onGo}
			onClose={onClose}
		/>
	);
}
