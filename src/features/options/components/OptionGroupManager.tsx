import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useOptionGroups } from "../hooks/useOptionGroups";

interface OptionGroupManagerProps {
	restaurantId: Id<"restaurants">;
}

export function OptionGroupManager({ restaurantId }: Readonly<OptionGroupManagerProps>) {
	const { groups, createGroup, deleteGroup, createOption, deleteOption } =
		useOptionGroups(restaurantId);

	const [showForm, setShowForm] = useState(false);
	const [name, setName] = useState("");
	const [selType, setSelType] = useState<"single" | "multi">("single");
	const [isRequired, setIsRequired] = useState(false);

	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) return;
		await createGroup({
			restaurantId,
			name: name.trim(),
			selectionType: selType,
			isRequired,
			minSelections: isRequired ? 1 : 0,
			maxSelections: selType === "single" ? 1 : 10,
		});
		setName("");
		setShowForm(false);
	};

	const sorted = [...groups].sort((a, b) => a.displayOrder - b.displayOrder);

	return (
		<div className="space-y-6">
			{!showForm ? (
				<button
					onClick={() => setShowForm(true)}
					className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
				>
					<Plus size={16} /> New Option Group
				</button>
			) : (
				<form
					onSubmit={handleCreate}
					className="space-y-3 p-4 rounded-lg"
					style={{
						backgroundColor: "var(--bg-secondary)",
						border: "1px solid var(--border-default)",
					}}
				>
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder='Group name (e.g. "Meat Doneness")'
						required
						className="w-full px-3 py-2 rounded-lg text-sm"
						style={{
							backgroundColor: "var(--bg-primary)",
							border: "1px solid var(--border-default)",
							color: "var(--text-primary)",
						}}
					/>
					<div className="flex gap-4 items-center">
						<label
							className="flex items-center gap-2 text-sm"
							style={{ color: "var(--text-secondary)" }}
						>
							<select
								value={selType}
								onChange={(e) => setSelType(e.target.value as "single" | "multi")}
								className="px-2 py-1 rounded text-sm"
								style={{
									backgroundColor: "var(--bg-primary)",
									border: "1px solid var(--border-default)",
									color: "var(--text-primary)",
								}}
							>
								<option value="single">Single select</option>
								<option value="multi">Multi select</option>
							</select>
						</label>
						<label
							className="flex items-center gap-2 text-sm"
							style={{ color: "var(--text-secondary)" }}
						>
							<input
								type="checkbox"
								checked={isRequired}
								onChange={(e) => setIsRequired(e.target.checked)}
							/>
							Required
						</label>
					</div>
					<div className="flex gap-2">
						<button
							type="submit"
							className="px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
						>
							Create
						</button>
						<button
							type="button"
							onClick={() => setShowForm(false)}
							className="px-4 py-2 rounded-lg text-sm hover-btn-secondary"
						>
							Cancel
						</button>
					</div>
				</form>
			)}

			{sorted.map((group) => (
				<GroupCard
					key={group._id}
					group={group}
					restaurantId={restaurantId}
					onDelete={() => deleteGroup({ groupId: group._id })}
					onCreateOption={createOption}
					onDeleteOption={deleteOption}
				/>
			))}
		</div>
	);
}

function GroupCard({
	group,
	restaurantId,
	onDelete,
	onCreateOption,
	onDeleteOption,
}: Readonly<{
	group: Doc<"optionGroups">;
	restaurantId: Id<"restaurants">;
	onDelete: () => void;
	onCreateOption: (args: {
		optionGroupId: Id<"optionGroups">;
		restaurantId: Id<"restaurants">;
		name: string;
		priceModifier: number;
	}) => Promise<unknown>;
	onDeleteOption: (args: { optionId: Id<"options"> }) => Promise<unknown>;
}>) {
	const [expanded, setExpanded] = useState(false);
	const { data: options } = useQuery(
		convexQuery(api.optionGroups.getOptionsByGroup, { optionGroupId: group._id })
	);
	const [optName, setOptName] = useState("");
	const [optPrice, setOptPrice] = useState("0");

	const handleAddOption = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!optName.trim()) return;
		await onCreateOption({
			optionGroupId: group._id,
			restaurantId,
			name: optName.trim(),
			priceModifier: Math.round(Number.parseFloat(optPrice) * 100) || 0,
		});
		setOptName("");
		setOptPrice("0");
	};

	return (
		<div
			className="rounded-lg overflow-hidden"
			style={{ border: "1px solid var(--border-default)" }}
		>
			<div
				className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--bg-hover)]"
				style={{ backgroundColor: "var(--bg-secondary)" }}
				onClick={() => setExpanded(!expanded)}
			>
				<div className="flex items-center gap-2">
					{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
					<span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
						{group.name}
					</span>
					<span
						className="text-xs px-2 py-0.5 rounded-full"
						style={{ backgroundColor: "var(--bg-primary)", color: "var(--text-muted)" }}
					>
						{group.selectionType === "single" ? "Single" : "Multi"}{" "}
						{group.isRequired ? "• Required" : "• Optional"}
					</span>
				</div>
				<button
					onClick={(e) => {
						e.stopPropagation();
						onDelete();
					}}
					className="p-1 rounded hover:bg-[var(--bg-hover)]"
				>
					<Trash2 size={14} style={{ color: "var(--accent-danger)" }} />
				</button>
			</div>

			{expanded && (
				<div className="p-4 space-y-2">
					{(options ?? []).map((opt) => (
						<div
							key={opt._id}
							className="flex items-center justify-between px-3 py-2 rounded"
							style={{ backgroundColor: "var(--bg-primary)" }}
						>
							<div className="flex items-center gap-3">
								<span className="text-sm" style={{ color: "var(--text-primary)" }}>
									{opt.name}
								</span>
								{opt.priceModifier > 0 && (
									<span className="text-xs" style={{ color: "var(--accent-success)" }}>
										+${(opt.priceModifier / 100).toFixed(2)}
									</span>
								)}
							</div>
							<button
								onClick={() => onDeleteOption({ optionId: opt._id })}
								className="p-1 rounded hover:bg-[var(--bg-hover)]"
							>
								<Trash2 size={14} style={{ color: "var(--accent-danger)" }} />
							</button>
						</div>
					))}
					<form onSubmit={handleAddOption} className="flex gap-2 pt-2">
						<input
							type="text"
							value={optName}
							onChange={(e) => setOptName(e.target.value)}
							placeholder="Option name"
							required
							className="flex-1 px-2 py-1.5 rounded text-sm"
							style={{
								backgroundColor: "var(--bg-secondary)",
								border: "1px solid var(--border-default)",
								color: "var(--text-primary)",
							}}
						/>
						<input
							type="number"
							value={optPrice}
							onChange={(e) => setOptPrice(e.target.value)}
							placeholder="+$"
							step="0.01"
							min="0"
							className="w-20 px-2 py-1.5 rounded text-sm"
							style={{
								backgroundColor: "var(--bg-secondary)",
								border: "1px solid var(--border-default)",
								color: "var(--text-primary)",
							}}
						/>
						<button
							type="submit"
							className="px-3 py-1.5 rounded text-sm font-medium hover-btn-primary"
						>
							<Plus size={14} />
						</button>
					</form>
				</div>
			)}
		</div>
	);
}
