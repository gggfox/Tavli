import { MenusKeys } from "@/global/i18n";
import { useTranslation } from "react-i18next";
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
	const { t } = useTranslation();
	return (
		<div
			className="space-y-3 p-4 rounded-lg bg-muted border border-border"
			
		>
			<div>
				<label
					htmlFor="menu-default-language"
					className="block text-xs mb-1 text-faint-foreground"
					
				>
					{t(MenusKeys.LANG_DEFAULT_LABEL)}
				</label>
				<select
					id="menu-default-language"
					value={defaultLanguage}
					onChange={(e) => onDefaultChange(e.target.value)}
					className="w-full px-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground"
					
				>
					{ALL_LANGUAGES.map((lang) => (
						<option key={lang} value={lang}>
							{LANGUAGE_LABELS[lang] ?? lang}
						</option>
					))}
				</select>
			</div>
			<div>
				<span className="block text-xs mb-1.5 text-faint-foreground" >
					{t(MenusKeys.LANG_ADDITIONAL_LABEL)}
				</span>
				<div className="flex flex-wrap gap-2">
					{ALL_LANGUAGES.filter((l) => l !== defaultLanguage).map((lang) => (
						<button
							key={lang}
							type="button"
							onClick={() => onToggleLanguage(lang)}
							className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border border-border"
							style={{backgroundColor: supportedLanguages.includes(lang)
									? "var(--accent-primary)"
									: "var(--bg-tertiary)",
				color: supportedLanguages.includes(lang) ? "white" : "var(--text-secondary)"}}
						>
							{LANGUAGE_LABELS[lang] ?? lang}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
