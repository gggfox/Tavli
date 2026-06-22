import { OptionGroupManager } from "@/features/options";
import { EmptyState, LanguageTabBar, Modal, SearchInput } from "@/global/components";
import { useAdminPageToolbar } from "@/global/hooks/useAdminPageToolbar";
import { useFuzzyMatch } from "@/global/hooks/useFuzzyMatch";
import { Languages, MenusKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Globe, LayoutGrid, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCategories, useMenus } from "../hooks/useMenus";
import { CategorySection } from "./CategorySection";
import { MenuLanguageSettings } from "./MenuLanguageSettings";

interface MenuEditorProps {
	menuId: Id<"menus">;
	restaurantId: Id<"restaurants">;
	onTranslationModeChange?: (isTranslationMode: boolean) => void;
	onAddCategoriesClick?: () => void;
}

export function MenuEditor({
	menuId,
	restaurantId,
	onTranslationModeChange,
	onAddCategoriesClick,
}: Readonly<MenuEditorProps>) {
	const { t } = useTranslation();
	const { data: menu } = useQuery(convexQuery(api.menus.getByIdForStaff, { menuId }));
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

	useEffect(() => {
		onTranslationModeChange?.(isTranslationMode);
	}, [isTranslationMode, onTranslationModeChange]);

	const sorted = [...categories].sort((a, b) => a.displayOrder - b.displayOrder);
	const categoryIdsFingerprint = useMemo(() => sorted.map((c) => c._id).join(","), [sorted]);

	useEffect(() => {
		setFilterVisibility({});
	}, [deferredSearchQuery, categoryIdsFingerprint]);

	const handleFilterVisibility = useCallback((categoryId: string, visible: boolean) => {
		setFilterVisibility((prev) => {
			if (prev[categoryId] === visible) return prev;
			return { ...prev, [categoryId]: visible };
		});
	}, []);

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

	const toolbar = useMemo(
		() => (
			<div className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center gap-3">
					<LanguageTabBar
						languages={supportedLangs}
						defaultLanguage={defaultLang}
						selectedLanguage={selectedLang}
						onSelect={setSelectedLang}
					/>
					<button
						type="button"
						onClick={() => setLangSettingsOpen((prev) => !prev)}
						className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-hover transition-colors"
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
						className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-hover transition-colors text-faint-foreground"
						title={t(MenusKeys.EDITOR_OPTIONS_TITLE)}
					>
						<LayoutGrid size={16} />
						<span className="text-xs text-faint-foreground">
							{t(MenusKeys.EDITOR_OPTIONS_LABEL)}
						</span>
					</button>
				</div>
				<SearchInput
					placeholder={t(MenusKeys.EDITOR_FILTER_PLACEHOLDER)}
					value={searchQuery}
					onChange={setSearchQuery}
				/>
			</div>
		),
		[defaultLang, langSettingsOpen, searchQuery, selectedLang, setSearchQuery, supportedLangs, t]
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
