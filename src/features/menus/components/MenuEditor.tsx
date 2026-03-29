import { OptionGroupManager } from "@/features/options";
import { LanguageTabBar, Modal } from "@/global/components";
import { Languages } from "@/global/i18n/locales";
import { convexQuery } from "@convex-dev/react-query";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Globe, LayoutGrid, Plus, X } from "lucide-react";
import { useState } from "react";
import { useCategories, useMenus } from "../hooks/useMenus";
import { CategorySection } from "./CategorySection";
import { MenuLanguageSettings } from "./MenuLanguageSettings";

interface MenuEditorProps {
	menuId: Id<"menus">;
	restaurantId: Id<"restaurants">;
}

export function MenuEditor({ menuId, restaurantId }: Readonly<MenuEditorProps>) {
	const { data: menu } = useQuery(convexQuery(api.menus.getMenuById, { menuId }));
	const { categories } = useCategories(menuId);
	const { createCategory, deleteCategory, updateMenu } = useMenus(restaurantId);

	const defaultLang = menu?.defaultLanguage ?? Languages.EN;
	const supportedLangs = menu?.supportedLanguages ?? [defaultLang];
	const [selectedLang, setSelectedLang] = useState(defaultLang);
	const isTranslationMode = selectedLang !== defaultLang;

	const [langSettingsOpen, setLangSettingsOpen] = useState(false);
	const [optionGroupsModalOpen, setOptionGroupsModalOpen] = useState(false);

	const categoryForm = useForm({
		defaultValues: { name: "" },
		onSubmit: async ({ value }) => {
			if (!value.name.trim()) return;
			await createCategory({ menuId, restaurantId, name: value.name.trim() });
			categoryForm.reset();
		},
	});

	const sorted = [...categories].sort((a, b) => a.displayOrder - b.displayOrder);

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

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-3">
				<LanguageTabBar
					languages={supportedLangs}
					defaultLanguage={defaultLang}
					selectedLanguage={selectedLang}
					onSelect={setSelectedLang}
				/>
				<button
					type="button"
					onClick={() => setLangSettingsOpen((prev) => !prev)}
					className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
					title="Configure languages"
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
						Languages
					</span>
				</button>
				<button
					type="button"
					onClick={() => setOptionGroupsModalOpen(true)}
					className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
					title="Manage option groups"
				>
					<LayoutGrid size={16} style={{ color: "var(--text-muted)" }} />
					<span className="text-xs" style={{ color: "var(--text-muted)" }}>
						Options
					</span>
				</button>
			</div>

			<Modal
				isOpen={optionGroupsModalOpen}
				onClose={() => setOptionGroupsModalOpen(false)}
				ariaLabel="Manage Option Groups"
				size="3xl"
			>
				<div
					className="rounded-xl overflow-hidden"
					style={{
						backgroundColor: "var(--bg-primary)",
						border: "1px solid var(--border-default)",
					}}
				>
					<div
						className="flex items-center justify-between px-6 py-4"
						style={{ borderBottom: "1px solid var(--border-default)" }}
					>
						<div>
							<h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
								Option Groups
							</h2>
							<p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
								Create reusable option groups and link them to menu items.
							</p>
						</div>
						<button
							type="button"
							onClick={() => setOptionGroupsModalOpen(false)}
							className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)]"
						>
							<X size={18} style={{ color: "var(--text-muted)" }} />
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

			{!isTranslationMode && (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						categoryForm.handleSubmit();
					}}
					className="flex gap-3"
				>
					<categoryForm.Field
						name="name"
						children={(field) => (
							<input
								type="text"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								placeholder="New category (e.g. Appetizers)"
								className="flex-1 px-3 py-2 rounded-lg text-sm"
								style={{
									backgroundColor: "var(--bg-secondary)",
									border: "1px solid var(--border-default)",
									color: "var(--text-primary)",
								}}
							/>
						)}
					/>
					<button
						type="submit"
						className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
					>
						<Plus size={16} /> Add Category
					</button>
				</form>
			)}

			{isTranslationMode && (
				<p className="text-xs" style={{ color: "var(--text-muted)" }}>
					Translating names and descriptions. Prices, images, and options are shared across all
					languages.
				</p>
			)}

			{sorted.map((cat) => (
				<CategorySection
					key={cat._id}
					category={cat}
					restaurantId={restaurantId}
					onDeleteCategory={() => deleteCategory({ categoryId: cat._id })}
					selectedLang={isTranslationMode ? selectedLang : undefined}
				/>
			))}
			{sorted.length === 0 && (
				<p className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>
					No categories yet. Add your first category above.
				</p>
			)}
		</div>
	);
}
