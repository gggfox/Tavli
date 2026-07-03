import { OptionGroupManager } from "@/features/options";
import { EmptyState, LanguageTabBar, Modal, SearchInput } from "@/global/components";
import { useAdminPageToolbar } from "@/global/hooks/useAdminPageToolbar";
import { useFuzzyMatch } from "@/global/hooks/useFuzzyMatch";
import { Languages, MenusKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ChevronsDownUp, ChevronsUpDown, Globe, LayoutGrid, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCategories, useMenus } from "../hooks/useMenus";
import { CategorySection } from "./CategorySection";
import { MenuBulkActionBar } from "./MenuBulkActionBar";
import { MenuLanguageSettings } from "./MenuLanguageSettings";

interface MenuEditorProps {
	menuId: Id<"menus">;
	restaurantId: Id<"restaurants">;
	onTranslationModeChange?: (isTranslationMode: boolean) => void;
	onAddCategoriesClick?: () => void;
}

const toolbarButtonClass =
	"flex h-9 items-center gap-1.5 rounded-lg px-2 transition-colors hover:bg-hover";

export function MenuEditor({
	menuId,
	restaurantId,
	onTranslationModeChange,
	onAddCategoriesClick,
}: Readonly<MenuEditorProps>) {
	const { t } = useTranslation();
	const { data: menu } = useQuery(convexQuery(api.menus.getMenuById, { menuId }));
	const { categories } = useCategories(menuId);
	const { deleteCategory, updateMenu } = useMenus(restaurantId);

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
	const [visibleItemIdsByCategory, setVisibleItemIdsByCategory] = useState<
		Record<string, Id<"menuItems">[]>
	>({});
	const [categoryExpanded, setCategoryExpanded] = useState<Record<string, boolean>>({});
	const selectAllRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		onTranslationModeChange?.(isTranslationMode);
	}, [isTranslationMode, onTranslationModeChange]);

	useEffect(() => {
		if (isTranslationMode) setSelectedIds(new Set());
	}, [isTranslationMode]);

	const sorted = [...categories].sort((a, b) => a.displayOrder - b.displayOrder);
	const categoryIdsFingerprint = useMemo(() => sorted.map((c) => c._id).join(","), [sorted]);

	useEffect(() => {
		setFilterVisibility({});
		setVisibleItemIdsByCategory({});
	}, [deferredSearchQuery, categoryIdsFingerprint]);

	useEffect(() => {
		setCategoryExpanded((prev) => {
			const next: Record<string, boolean> = {};
			let changed = false;
			for (const cat of sorted) {
				next[cat._id] = prev[cat._id] ?? true;
				if (prev[cat._id] === undefined) changed = true;
			}
			if (Object.keys(prev).length !== sorted.length) changed = true;
			return changed ? next : prev;
		});
	}, [categoryIdsFingerprint, sorted]);

	const handleFilterVisibility = useCallback((categoryId: string, visible: boolean) => {
		setFilterVisibility((prev) => {
			if (prev[categoryId] === visible) return prev;
			return { ...prev, [categoryId]: visible };
		});
	}, []);

	const handleVisibleItemIdsChange = useCallback(
		(categoryId: string, itemIds: Id<"menuItems">[]) => {
			setVisibleItemIdsByCategory((prev) => {
				const prevIds = prev[categoryId];
				const nextIds = itemIds.join(",");
				if (prevIds?.join(",") === nextIds) return prev;
				return { ...prev, [categoryId]: itemIds };
			});
		},
		[]
	);

	const visibleCategoryIds = useMemo(() => {
		if (!isFilterActive) return sorted.map((cat) => cat._id);
		return sorted.filter((cat) => filterVisibility[cat._id] === true).map((cat) => cat._id);
	}, [sorted, isFilterActive, filterVisibility]);

	const allVisibleItemIds = useMemo(() => {
		const ids = new Set<Id<"menuItems">>();
		for (const categoryId of visibleCategoryIds) {
			for (const itemId of visibleItemIdsByCategory[categoryId] ?? []) {
				ids.add(itemId);
			}
		}
		return ids;
	}, [visibleCategoryIds, visibleItemIdsByCategory]);

	const allVisibleItemIdsFingerprint = useMemo(
		() => [...allVisibleItemIds].sort((a, b) => a.localeCompare(b)).join(","),
		[allVisibleItemIds]
	);

	useEffect(() => {
		setSelectedIds((prev) => {
			let changed = false;
			const next = new Set<Id<"menuItems">>();
			for (const id of prev) {
				if (allVisibleItemIds.has(id)) next.add(id);
				else changed = true;
			}
			return changed ? next : prev;
		});
	}, [allVisibleItemIdsFingerprint, allVisibleItemIds]);

	const allSelected =
		allVisibleItemIds.size > 0 && [...allVisibleItemIds].every((id) => selectedIds.has(id));

	useEffect(() => {
		const el = selectAllRef.current;
		if (!el) return;
		el.indeterminate = selectedIds.size > 0 && !allSelected;
	}, [selectedIds, allSelected]);

	const anyVisibleCategoryExpanded = visibleCategoryIds.some(
		(categoryId) => categoryExpanded[categoryId] !== false
	);

	const handleToggleSelectAll = useCallback(() => {
		if (allSelected) {
			setSelectedIds(new Set());
			return;
		}
		setSelectedIds(new Set(allVisibleItemIds));
	}, [allSelected, allVisibleItemIds]);

	const handleToggleAllCategories = useCallback(() => {
		const nextExpanded = !anyVisibleCategoryExpanded;
		setCategoryExpanded((prev) => {
			const next = { ...prev };
			for (const categoryId of visibleCategoryIds) {
				next[categoryId] = nextExpanded;
			}
			return next;
		});
	}, [anyVisibleCategoryExpanded, visibleCategoryIds]);

	const reportedCount = Object.keys(filterVisibility).length;
	const hasFilterMatch = !isFilterActive || Object.values(filterVisibility).some(Boolean);
	const showFilterNoMatches =
		isFilterActive && sorted.length > 0 && reportedCount === sorted.length && !hasFilterMatch;

	const showBulkBar = !isTranslationMode && selectedIds.size > 0;

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

	const toolbar = useMemo(
		() => (
			<div className="flex flex-col gap-2">
				<div className="flex min-h-9 items-center justify-between gap-3">
					<div className="flex min-w-0 flex-1 items-center gap-3">
						{!isTranslationMode ? (
							<label className="flex h-9 shrink-0 cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
								<input
									ref={selectAllRef}
									type="checkbox"
									checked={allSelected}
									disabled={allVisibleItemIds.size === 0}
									onChange={handleToggleSelectAll}
									className="h-4 w-4 rounded border-border accent-[var(--btn-primary-bg)]"
								/>
								<span className="hidden sm:inline">
									{allSelected ? t(MenusKeys.EDITOR_DESELECT_ALL) : t(MenusKeys.EDITOR_SELECT_ALL)}
								</span>
							</label>
						) : null}
						<SearchInput
							className="h-9"
							inputClassName="py-0"
							placeholder={t(MenusKeys.EDITOR_FILTER_PLACEHOLDER)}
							value={searchQuery}
							onChange={setSearchQuery}
						/>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<button
							type="button"
							onClick={handleToggleAllCategories}
							disabled={visibleCategoryIds.length === 0}
							className={`${toolbarButtonClass} text-faint-foreground disabled:opacity-50`}
							title={
								anyVisibleCategoryExpanded
									? t(MenusKeys.EDITOR_COLLAPSE_ALL)
									: t(MenusKeys.EDITOR_EXPAND_ALL)
							}
						>
							{anyVisibleCategoryExpanded ? (
								<ChevronsDownUp size={16} />
							) : (
								<ChevronsUpDown size={16} />
							)}
							<span className="hidden text-xs lg:inline">
								{anyVisibleCategoryExpanded
									? t(MenusKeys.EDITOR_COLLAPSE_ALL)
									: t(MenusKeys.EDITOR_EXPAND_ALL)}
							</span>
						</button>
						<LanguageTabBar
							languages={supportedLangs}
							defaultLanguage={defaultLang}
							selectedLanguage={selectedLang}
							onSelect={setSelectedLang}
						/>
						<button
							type="button"
							onClick={() => setLangSettingsOpen((prev) => !prev)}
							className={toolbarButtonClass}
							title={t(MenusKeys.EDITOR_LANGUAGES_TITLE)}
						>
							<Globe
								size={16}
								style={{
									color: langSettingsOpen ? "var(--btn-primary-bg)" : "var(--text-muted)",
								}}
							/>
							<span
								className="text-xs"
								style={{
									color: langSettingsOpen ? "var(--btn-primary-bg)" : "var(--text-muted)",
								}}
							>
								{t(MenusKeys.EDITOR_LANGUAGES_LABEL)}
							</span>
						</button>
						<button
							type="button"
							onClick={() => setOptionGroupsModalOpen(true)}
							className={`${toolbarButtonClass} text-faint-foreground`}
							title={t(MenusKeys.EDITOR_OPTIONS_TITLE)}
						>
							<LayoutGrid size={16} />
							<span className="text-xs text-faint-foreground">
								{t(MenusKeys.EDITOR_OPTIONS_LABEL)}
							</span>
						</button>
					</div>
				</div>
				{showBulkBar ? (
					<MenuBulkActionBar
						restaurantId={restaurantId}
						selectedIds={selectedIds}
						onClearSelection={() => setSelectedIds(new Set())}
					/>
				) : null}
			</div>
		),
		[
			allSelected,
			allVisibleItemIds.size,
			anyVisibleCategoryExpanded,
			defaultLang,
			isTranslationMode,
			langSettingsOpen,
			searchQuery,
			selectedIds,
			selectedLang,
			showBulkBar,
			supportedLangs,
			t,
			visibleCategoryIds.length,
			restaurantId,
			handleToggleAllCategories,
			handleToggleSelectAll,
		]
	);

	useAdminPageToolbar(toolbar);

	return (
		<div className="flex flex-col gap-6">
			<Modal
				isOpen={optionGroupsModalOpen}
				onClose={() => setOptionGroupsModalOpen(false)}
				ariaLabel={t(MenusKeys.EDITOR_OPTION_GROUPS_MODAL_ARIA)}
				size="3xl"
			>
				<div className="rounded-xl overflow-hidden bg-background border border-border">
					<div className="flex items-center justify-between px-6 py-4 border-b border-border">
						<div>
							<h2 className="text-lg font-semibold text-foreground">
								{t(MenusKeys.EDITOR_OPTION_GROUPS_HEADING)}
							</h2>
							<p className="text-xs mt-1 text-muted-foreground">
								{t(MenusKeys.EDITOR_OPTION_GROUPS_DESCRIPTION)}
							</p>
						</div>
						<button
							type="button"
							onClick={() => setOptionGroupsModalOpen(false)}
							className="p-1.5 rounded-lg hover:bg-hover text-faint-foreground"
						>
							<X size={18} />
						</button>
					</div>
					<div className="p-6 max-h-[70vh] overflow-y-auto">
						<OptionGroupManager restaurantId={restaurantId} />
					</div>
				</div>
			</Modal>

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
					onSelectedIdsChange={setSelectedIds}
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
	);
}
