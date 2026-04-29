import { EmptyState, InlineEditInput, TextInput } from "@/global/components";
import { MenusKeys } from "@/global/i18n";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Edit, Plus, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface MenuListProps {
	menus: Doc<"menus">[];
	restaurantId: Id<"restaurants">;
	onCreate: (data: {
		restaurantId: Id<"restaurants">;
		name: string;
		description?: string;
	}) => Promise<unknown>;
	onUpdate: (data: { menuId: Id<"menus">; name?: string; isActive?: boolean }) => Promise<unknown>;
	onDelete: (data: { menuId: Id<"menus"> }) => Promise<unknown>;
	onSelect: (menuId: Id<"menus">) => void;
}

export function MenuList({
	menus,
	restaurantId,
	onCreate,
	onUpdate,
	onDelete,
	onSelect,
}: Readonly<MenuListProps>) {
	const { t } = useTranslation();
	const [newName, setNewName] = useState("");
	const [editingId, setEditingId] = useState<Id<"menus"> | null>(null);

	const sorted = [...menus].sort((a, b) => a.displayOrder - b.displayOrder);

	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!newName.trim()) return;
		await onCreate({ restaurantId, name: newName.trim() });
		setNewName("");
	};

	return (
		<div className="space-y-4">
			<form onSubmit={handleCreate} className="flex gap-3">
				<div className="flex-1">
					<TextInput
						type="text"
						value={newName}
						onChange={(e) => setNewName(e.target.value)}
						placeholder={t(MenusKeys.LIST_NEW_PLACEHOLDER)}
					/>
				</div>
				<button
					type="submit"
					className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
				>
					<Plus size={16} /> {t(MenusKeys.LIST_ADD_BUTTON)}
				</button>
			</form>

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
							<button
								onClick={() => onDelete({ menuId: menu._id })}
								className="p-1.5 rounded-md hover:bg-hover text-destructive"
								title={t(MenusKeys.LIST_DELETE)}
							>
								<Trash2 size={16} />
							</button>
						</div>
					</div>
				))}
				{sorted.length === 0 && (
					<EmptyState
						variant="inline"
						title={t(MenusKeys.LIST_EMPTY)}
						className="py-8"
					/>
				)}
			</div>
		</div>
	);
}
