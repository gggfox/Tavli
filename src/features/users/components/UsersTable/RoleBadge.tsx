export function RoleBadge({ role }: Readonly<{ role: string }>) {
	const colorMap: Record<string, { bg: string; text: string }> = {
		admin: { bg: "rgba(239, 68, 68, 0.15)", text: "rgb(239, 68, 68)" },
		seller: { bg: "rgba(59, 130, 246, 0.15)", text: "rgb(59, 130, 246)" },
		buyer: { bg: "rgba(34, 197, 94, 0.15)", text: "rgb(34, 197, 94)" },
	};

	const colors = colorMap[role] ?? { bg: "rgba(156, 163, 175, 0.15)", text: "rgb(156, 163, 175)" };

	return (
		<span
			className="px-2 py-0.5 rounded-full text-xs font-medium"
			style={{ backgroundColor: colors.bg, color: colors.text }}
		>
			{role}
		</span>
	);
}
