import { useUserSettings } from "@/features/users/hooks";
import { i18n, Modal, useTheme } from "@/global";
import { Languages, SidebarKeys } from "@/global/i18n";
import { Config } from "@/global/utils/config";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { useConvex, useConvexAuth } from "convex/react";
import { Moon, ShieldCheck, Sun, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
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

	const { data: rawUserRoles } = useQuery({
		...convexQuery(api.admin.getCurrentUserRoles, {}),
		enabled: isAuthenticated,
	});
	const serverRoles: string[] = useMemo(
		() => (Array.isArray(rawUserRoles) && rawUserRoles[0] !== null ? rawUserRoles[0] : []),
		[rawUserRoles]
	);
	const [optimisticRoles, setOptimisticRoles] = useState<string[]>([]);
	const displayRoles: string[] = useMemo(
		() => Array.from(new Set([...serverRoles, ...optimisticRoles])),
		[serverRoles, optimisticRoles]
	);

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

	const convex = useConvex();
	const hasAdminRole = displayRoles.includes("admin");
	const [isAssigningAdmin, setIsAssigningAdmin] = useState(false);

	const handleSelfAssignAdmin = useCallback(async () => {
		setIsAssigningAdmin(true);
		try {
			const [result, error] = await convex.mutation(api.admin.selfAssignAdminRole, {});
			if (error) {
				console.error("Failed to self-assign admin role:", error);
			} else if (result) {
				setOptimisticRoles((prev) => Array.from(new Set([...prev, "admin"])));
			}
		} catch (error) {
			console.error("Failed to self-assign admin role:", error);
		} finally {
			setIsAssigningAdmin(false);
		}
	}, [convex]);

	const adminButtonLabel = useMemo(() => {
		if (isAssigningAdmin) return t(SidebarKeys.ASSIGNING_ADMIN);
		if (hasAdminRole) return t(SidebarKeys.ADMIN_ALREADY_ASSIGNED);
		return t(SidebarKeys.SELF_ASSIGN_ADMIN);
	}, [isAssigningAdmin, hasAdminRole, t]);

	const handleToggleTheme = useCallback(() => {
		const root = document.documentElement;
		const newIsDark = !root.classList.contains("dark");
		if (newIsDark) {
			root.classList.add("dark");
		} else {
			root.classList.remove("dark");
		}
		toggleTheme();
	}, [toggleTheme]);

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

				{/* Roles Section */}
				{isAuthenticated && (
					<div className="mb-6">
						<h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-secondary)" }}>
							{t(SidebarKeys.ROLES)}
						</h3>
						<div className="flex flex-wrap gap-2">
							{displayRoles.length > 0 ? (
								displayRoles.map((role) => (
									<span
										key={role}
										className="px-3 py-1 rounded-full text-xs font-medium capitalize"
										style={{
											backgroundColor: "var(--bg-active)",
											color: "var(--text-primary)",
										}}
									>
										{role}
									</span>
								))
							) : (
								<span className="text-sm" style={{ color: "var(--text-muted)" }}>
									{t(SidebarKeys.NO_ROLES)}
								</span>
							)}
						</div>
					</div>
				)}

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
				<div className={Config.instance.isDev && isAuthenticated ? "mb-6" : ""}>
					<h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-secondary)" }}>
						{t(SidebarKeys.THEME)}
					</h3>
					<button
						onClick={handleToggleTheme}
						className="w-full flex items-center gap-3 rounded-lg hover-secondary px-4 py-2.5 text-sm transition-all"
						style={{ color: "var(--text-secondary)" }}
					>
						<ThemeIcon size={18} className="shrink-0" />
						<span>{themeLabel}</span>
					</button>
				</div>

				{/* Dev Tools Section (dev environment only) */}
				{Config.instance.isDev && isAuthenticated && (
					<div>
						<h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-secondary)" }}>
							{t(SidebarKeys.DEV_TOOLS)}
						</h3>
						<button
							onClick={handleSelfAssignAdmin}
							disabled={hasAdminRole || isAssigningAdmin}
							className="w-full flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed hover-secondary"
							style={{ color: "var(--text-secondary)" }}
						>
							<ShieldCheck size={18} className="shrink-0" />
							<span>{adminButtonLabel}</span>
						</button>
					</div>
				)}
			</div>
		</Modal>
	);
}
