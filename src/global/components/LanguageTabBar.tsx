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
}

export function LanguageTabBar({
	languages,
	defaultLanguage,
	selectedLanguage,
	onSelect,
	className,
}: Readonly<LanguageTabBarProps>) {
	if (languages.length <= 1) return null;

	return (
		<div className={`flex h-9 items-center gap-1 rounded-lg bg-muted p-1 ${className ?? ""}`}>
			{languages.map((lang) => {
				const isActive = lang === selectedLanguage;
				const isDefault = lang === defaultLanguage;
				return (
					<button
						key={lang}
						type="button"
						onClick={() => onSelect(lang)}
						className="h-7 rounded-md px-3 text-xs font-medium transition-colors"
						style={{
							backgroundColor: isActive ? "var(--btn-primary-bg)" : "transparent",
							color: isActive ? "var(--btn-primary-text)" : "var(--text-secondary)",
						}}
					>
						{LANGUAGE_LABELS[lang] ?? lang.toUpperCase()}
						{isDefault && (
							<span className="ml-1 opacity-60" style={{ fontSize: "0.65rem" }}>
								(default)
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
