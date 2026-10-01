import { CommonKeys } from "@/global/i18n";
import { useTranslation } from "react-i18next";

/**
 * Endonyms on purpose: a language is labelled in its own language, so these
 * stay the same whichever UI language is active.
 */
const LANGUAGE_LABELS: Record<string, string> = {
	en: "English",
	es: "Espa\u00f1ol",
};

interface LanguageTabBarProps {
	languages: string[];
	defaultLanguage: string;
	selectedLanguage: string;
	onSelect: (lang: string) => void;
	className?: string;
	/** Language codes only (ES | EN) in 44px targets, for phone toolbars. */
	compact?: boolean;
}

export function LanguageTabBar({
	languages,
	defaultLanguage,
	selectedLanguage,
	onSelect,
	className,
	compact = false,
}: Readonly<LanguageTabBarProps>) {
	const { t } = useTranslation();
	if (languages.length <= 1) return null;

	return (
		<div
			className={`flex items-center gap-1 rounded-lg bg-muted p-1 ${compact ? "h-11" : "h-9"} ${className ?? ""}`}
		>
			{languages.map((lang) => {
				const isActive = lang === selectedLanguage;
				const isDefault = lang === defaultLanguage;
				return (
					<button
						key={lang}
						type="button"
						onClick={() => onSelect(lang)}
						aria-pressed={isActive}
						title={compact ? (LANGUAGE_LABELS[lang] ?? lang.toUpperCase()) : undefined}
						className={`rounded-md text-xs font-medium transition-colors ${compact ? "h-9 w-11 uppercase" : "h-7 px-3"}`}
						style={{
							backgroundColor: isActive ? "var(--btn-primary-bg)" : "transparent",
							color: isActive ? "var(--btn-primary-text)" : "var(--text-secondary)",
						}}
					>
						{compact ? lang : (LANGUAGE_LABELS[lang] ?? lang.toUpperCase())}
						{isDefault && !compact && (
							<span className="ml-1 opacity-60" style={{ fontSize: "0.65rem" }}>
								{t(CommonKeys.LANGUAGE_DEFAULT_SUFFIX)}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
