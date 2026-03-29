import { useTranslation } from "react-i18next";

export function RoleBadge({ role }: Readonly<{ role: string }>) {
	const { t } = useTranslation();

	const colorMap: Record<string, { bg: string; text: string }> = {
		admin: { bg: "rgba(239, 68, 68, 0.15)", text: "rgb(239, 68, 68)" },
		owner: { bg: "rgba(168, 85, 247, 0.15)", text: "rgb(168, 85, 247)" },
		manager: { bg: "rgba(59, 130, 246, 0.15)", text: "rgb(59, 130, 246)" },
		customer: { bg: "rgba(34, 197, 94, 0.15)", text: "rgb(34, 197, 94)" },
		employee: { bg: "rgba(245, 158, 11, 0.15)", text: "rgb(245, 158, 11)" },
	};

	const colors = colorMap[role] ?? { bg: "rgba(156, 163, 175, 0.15)", text: "rgb(156, 163, 175)" };

	return (
		<span
			className="px-2 py-0.5 rounded-full text-xs font-medium"
			style={{ backgroundColor: colors.bg, color: colors.text }}
		>
			{t(`roles.${role}`, role)}
		</span>
	);
}
