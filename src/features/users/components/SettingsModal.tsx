import { useUserSettings } from "@/features/users/hooks";
import { i18n, Modal, useTheme } from "@/global";
import { Languages, SidebarKeys } from "@/global/i18n";
import { useConvexAuth } from "convex/react";
import { Moon, Sun, X } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

interface SettingsModalProps {
	isOpen: boolean;
	onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: Readonly<SettingsModalProps>) {
	const { t } = useTranslation();
	const { language: currentLanguage, updateLanguage } = useUserSettings();
	const { isAuthenticated } = useConvexAuth();
	const { theme, toggleTheme } = useTheme();

	const handleLanguageChange = useCallback(
		async (newLanguage: typeof Languages.EN | typeof Languages.ES) => {
			// Check against current language to avoid unnecessary updates
			if (newLanguage === currentLanguage) return;

			// Update i18n immediately for responsive UI
			i18n.changeLanguage(newLanguage);

			if (isAuthenticated) {
				// Update Convex settings in the background
				const result = await updateLanguage(newLanguage);
				if (!result.success) {
					console.error("Failed to update language:", result.error);
					// Revert i18n if Convex update failed
					i18n.changeLanguage(currentLanguage);
				}
			}
		},
		[currentLanguage, updateLanguage, isAuthenticated]
	);

	const themeLabel = theme === "light" ? t(SidebarKeys.DARK_MODE) : t(SidebarKeys.LIGHT_MODE);
	const ThemeIcon = theme === "light" ? Moon : Sun;

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			ariaLabel={t(SidebarKeys.SETTINGS)}
			containerClassName="max-w-md"
			contentClassName="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-default)] shadow-lg"
		>
			<div className="p-6">
				{/* Header */}
				<div className="flex items-center justify-between mb-6">
					<h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
						{t(SidebarKeys.SETTINGS)}
					</h2>
					<button
						onClick={onClose}
						className="p-1.5 rounded-md hover-icon transition-colors"
						aria-label={t(SidebarKeys.CLOSE)}
					>
						<X size={20} />
					</button>
				</div>

				{/* Language Section */}
				<div className="mb-6">
					<h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-secondary)" }}>
						{t(SidebarKeys.SELECT_LANGUAGE)}
					</h3>
					<div className="flex gap-2">
						<button
							onClick={() => handleLanguageChange(Languages.EN)}
							className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm transition-all ${
								currentLanguage === Languages.EN ? "bg-[var(--bg-active)]" : "hover-secondary"
							}`}
							style={{ color: "var(--text-secondary)" }}
						>
							<span>{t(SidebarKeys.ENGLISH)}</span>
						</button>
						<button
							onClick={() => handleLanguageChange(Languages.ES)}
							className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm transition-all ${
								currentLanguage === Languages.ES ? "bg-[var(--bg-active)]" : "hover-secondary"
							}`}
							style={{ color: "var(--text-secondary)" }}
						>
							<span>{t(SidebarKeys.SPANISH)}</span>
						</button>
					</div>
				</div>

				{/* Theme Section */}
				<div>
					<h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-secondary)" }}>
						{t(SidebarKeys.THEME)}
					</h3>
					<button
						onClick={toggleTheme}
						className="w-full flex items-center gap-3 rounded-lg hover-secondary px-4 py-2.5 text-sm transition-all"
						style={{ color: "var(--text-secondary)" }}
					>
						<ThemeIcon size={18} className="shrink-0" />
						<span>{themeLabel}</span>
					</button>
				</div>
			</div>
		</Modal>
	);
}
