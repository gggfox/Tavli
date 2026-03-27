import { EmptyState, TextInput } from "@/global/components";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Edit, Plus, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { useState } from "react";

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
	const [newName, setNewName] = useState("");
	const [editingId, setEditingId] = useState<Id<"menus"> | null>(null);
	const [editName, setEditName] = useState("");

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
						placeholder="New menu name (e.g. Dinner Menu)"
					/>
				</div>
				<button
					type="submit"
					className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
				>
					<Plus size={16} /> Add Menu
				</button>
			</form>

			<div className="space-y-2">
				{sorted.map((menu) => (
					<div
						key={menu._id}
						className="flex items-center justify-between px-4 py-3 rounded-lg cursor-pointer hover:bg-[var(--bg-hover)]"
						style={{
							backgroundColor: "var(--bg-secondary)",
							border: "1px solid var(--border-default)",
						}}
						onClick={() => onSelect(menu._id)}
					>
						<div className="flex-1">
							{editingId === menu._id ? (
								<input
									type="text"
									value={editName}
									onChange={(e) => setEditName(e.target.value)}
									onBlur={async () => {
										if (editName.trim() && editName !== menu.name) {
											await onUpdate({ menuId: menu._id, name: editName.trim() });
										}
										setEditingId(null);
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter") (e.target as HTMLInputElement).blur();
									}}
									autoFocus
									className="px-2 py-1 rounded text-sm"
									style={{
										backgroundColor: "var(--bg-primary)",
										border: "1px solid var(--border-default)",
										color: "var(--text-primary)",
									}}
									onClick={(e) => e.stopPropagation()}
								/>
							) : (
								<span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
									{menu.name}
								</span>
							)}
						</div>
						<div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
							<button
								onClick={() => onUpdate({ menuId: menu._id, isActive: !menu.isActive })}
								className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
								title={menu.isActive ? "Deactivate" : "Activate"}
							>
								{menu.isActive ? (
									<ToggleRight size={20} style={{ color: "var(--accent-success)" }} />
								) : (
									<ToggleLeft size={20} style={{ color: "var(--text-muted)" }} />
								)}
							</button>
							<button
								onClick={() => {
									setEditingId(menu._id);
									setEditName(menu.name);
								}}
								className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
								title="Rename"
							>
								<Edit size={16} style={{ color: "var(--text-secondary)" }} />
							</button>
							<button
								onClick={() => onDelete({ menuId: menu._id })}
								className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
								title="Delete menu"
							>
								<Trash2 size={16} style={{ color: "var(--accent-danger)" }} />
							</button>
						</div>
					</div>
				))}
				{sorted.length === 0 && (
					<EmptyState
						variant="inline"
						title="No menus yet. Create your first menu above."
						className="py-8"
					/>
				)}
			</div>
		</div>
	);
}
