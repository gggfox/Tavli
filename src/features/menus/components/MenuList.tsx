import { EmptyState, InlineEditInput } from "@/global/components";
import { MenusKeys } from "@/global/i18n";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Edit, ToggleLeft, ToggleRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface MenuListProps {
	menus: Doc<"menus">[];
	onUpdate: (data: { menuId: Id<"menus">; name?: string; isActive?: boolean }) => Promise<unknown>;
	onSelect: (menuId: Id<"menus">) => void;
}

export function MenuList({ menus, onUpdate, onSelect }: Readonly<MenuListProps>) {
	const { t } = useTranslation();
	const [editingId, setEditingId] = useState<Id<"menus"> | null>(null);

	const sorted = [...menus].sort((a, b) => a.displayOrder - b.displayOrder);

	return (
		<div className="space-y-4">
			<div className="space-y-2">
				{sorted.map((menu) => (
					<div
						key={menu._id}
						className="flex items-center justify-between px-4 py-3 rounded-lg cursor-pointer hover:bg-hover bg-muted border border-border"
						onClick={() => onSelect(menu._id)}
					>
						<div className="flex-1">
							{editingId === menu._id ? (
								<InlineEditInput
									value={menu.name}
									placeholder={menu.name}
									autoFocus
									onSave={async (next) => {
										const trimmed = next.trim();
										if (trimmed && trimmed !== menu.name) {
											await onUpdate({ menuId: menu._id, name: trimmed });
										}
										setEditingId(null);
									}}
								/>
							) : (
								<span className="text-sm font-medium text-foreground">{menu.name}</span>
							)}
						</div>
						<div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
							<button
								onClick={() => onUpdate({ menuId: menu._id, isActive: !menu.isActive })}
								className="p-1.5 rounded-md hover:bg-hover text-success"
								title={
									menu.isActive
										? t(MenusKeys.LIST_TOGGLE_DEACTIVATE)
										: t(MenusKeys.LIST_TOGGLE_ACTIVATE)
								}
							>
								{menu.isActive ? (
									<ToggleRight size={20} />
								) : (
									<ToggleLeft size={20} className="text-faint-foreground" />
								)}
							</button>
							<button
								onClick={() => setEditingId(menu._id)}
								className="p-1.5 rounded-md hover:bg-hover text-muted-foreground"
								title={t(MenusKeys.LIST_RENAME)}
							>
								<Edit size={16} />
							</button>
						</div>
					</div>
				))}
				{sorted.length === 0 && (
					<EmptyState variant="inline" title={t(MenusKeys.LIST_EMPTY)} className="py-8" />
				)}
			</div>
		</div>
	);
}
