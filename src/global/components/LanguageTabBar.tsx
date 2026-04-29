const LANGUAGE_LABELS: Record<string, string> = {
	en: "English",
	es: "Espa\u00f1ol",
};

interface LanguageTabBarProps {
	languages: string[];
	defaultLanguage: string;
	selectedLanguage: string;
	onSelect: (lang: string) => void;
}

export function LanguageTabBar({
	languages,
	defaultLanguage,
	selectedLanguage,
	onSelect,
}: Readonly<LanguageTabBarProps>) {
	if (languages.length <= 1) return null;

	return (
		<div className="flex gap-1 p-1 rounded-lg bg-muted" >
			{languages.map((lang) => {
				const isActive = lang === selectedLanguage;
				const isDefault = lang === defaultLanguage;
				return (
					<button
						key={lang}
						type="button"
						onClick={() => onSelect(lang)}
						className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
						style={{backgroundColor: isActive ? "var(--btn-primary-bg)" : "transparent",
				color: isActive ? "var(--btn-primary-text)" : "var(--text-secondary)"}}
					>
						{LANGUAGE_LABELS[lang] ?? lang.toUpperCase()}
						{isDefault && (
							<span className="ml-1 opacity-60" style={{fontSize: "0.65rem"}}>
								(default)
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
