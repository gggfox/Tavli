import { useTranslation } from "react-i18next";

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
	admin: { bg: "var(--accent-danger-light)", text: "var(--accent-danger)" },
	owner: { bg: "rgba(168, 85, 247, 0.15)", text: "rgb(168, 85, 247)" },
	manager: { bg: "rgba(59, 130, 246, 0.15)", text: "rgb(59, 130, 246)" },
	customer: { bg: "var(--accent-success-light)", text: "var(--accent-success)" },
	employee: { bg: "rgba(245, 158, 11, 0.15)", text: "rgb(245, 158, 11)" },
};

const DEFAULT_COLORS = { bg: "rgba(156, 163, 175, 0.15)", text: "rgb(156, 163, 175)" };

export function RoleBadge({ role }: Readonly<{ role: string }>) {
	const { t } = useTranslation();
	const colors = ROLE_COLORS[role] ?? DEFAULT_COLORS;

	return (
		<span
			className="px-2 py-0.5 rounded-full text-xs font-medium"
			style={{ backgroundColor: colors.bg, color: colors.text }}
		>
			{t(`roles.${role}`, role)}
		</span>
	);
}
