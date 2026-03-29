import { ALL_LANGUAGES, LANGUAGE_LABELS } from "../constants";

interface MenuLanguageSettingsProps {
	defaultLanguage: string;
	supportedLanguages: string[];
	onDefaultChange: (lang: string) => void;
	onToggleLanguage: (lang: string) => void;
}

export function MenuLanguageSettings({
	defaultLanguage,
	supportedLanguages,
	onDefaultChange,
	onToggleLanguage,
}: Readonly<MenuLanguageSettingsProps>) {
	return (
		<div
			className="space-y-3 p-4 rounded-lg"
			style={{
				backgroundColor: "var(--bg-secondary)",
				border: "1px solid var(--border-default)",
			}}
		>
			<div>
				<label
					htmlFor="menu-default-language"
					className="block text-xs mb-1"
					style={{ color: "var(--text-muted)" }}
				>
					Default language (used for main item names)
				</label>
				<select
					id="menu-default-language"
					value={defaultLanguage}
					onChange={(e) => onDefaultChange(e.target.value)}
					className="w-full px-3 py-2 rounded-lg text-sm"
					style={{
						backgroundColor: "var(--bg-primary)",
						border: "1px solid var(--border-default)",
						color: "var(--text-primary)",
					}}
				>
					{ALL_LANGUAGES.map((lang) => (
						<option key={lang} value={lang}>
							{LANGUAGE_LABELS[lang] ?? lang}
						</option>
					))}
				</select>
			</div>
			<div>
				<span className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>
					Additional languages for translations
				</span>
				<div className="flex flex-wrap gap-2">
					{ALL_LANGUAGES.filter((l) => l !== defaultLanguage).map((lang) => (
						<button
							key={lang}
							type="button"
							onClick={() => onToggleLanguage(lang)}
							className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
							style={{
								backgroundColor: supportedLanguages.includes(lang)
									? "var(--accent-primary)"
									: "var(--bg-tertiary)",
								color: supportedLanguages.includes(lang) ? "white" : "var(--text-secondary)",
								border: "1px solid var(--border-default)",
							}}
						>
							{LANGUAGE_LABELS[lang] ?? lang}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
