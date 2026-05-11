/**
 * Tab strip for switching between layouts. Visible tabs cap at TAB_OVERFLOW;
 * remaining layouts collapse into a "More" dropdown. The "+" affordance
 * creates a new empty layout via the supplied `onCreate` callback.
 */
import { Surface } from "@/global/components";
import { DashboardKeys } from "@/global/i18n";
import type { Id } from "convex/_generated/dataModel";
import { Copy, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DashboardLayout } from "../types";

const TAB_OVERFLOW = 6;

interface DashboardLayoutTabsProps {
	layouts: ReadonlyArray<DashboardLayout>;
	activeLayoutId: Id<"dashboardLayouts"> | undefined;
	onActivate: (id: Id<"dashboardLayouts">) => void;
	onCreate: () => void;
	onRename: (id: Id<"dashboardLayouts">, name: string) => Promise<void> | void;
	onDuplicate: (id: Id<"dashboardLayouts">) => void;
	onDelete: (id: Id<"dashboardLayouts">) => void;
}

export function DashboardLayoutTabs({
	layouts,
	activeLayoutId,
	onActivate,
	onCreate,
	onRename,
	onDuplicate,
	onDelete,
}: DashboardLayoutTabsProps) {
	const { t } = useTranslation();
	const [overflowOpen, setOverflowOpen] = useState(false);
	const [renamingId, setRenamingId] = useState<Id<"dashboardLayouts"> | null>(null);
	const overflowRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!overflowOpen) return;
		const onClickAway = (event: MouseEvent) => {
			if (
				overflowRef.current &&
				!overflowRef.current.contains(event.target as Node)
			) {
				setOverflowOpen(false);
			}
		};
		document.addEventListener("mousedown", onClickAway);
		return () => document.removeEventListener("mousedown", onClickAway);
	}, [overflowOpen]);

	const visible = layouts.slice(0, TAB_OVERFLOW);
	const overflow = layouts.slice(TAB_OVERFLOW);

	return (
		<div className="flex flex-wrap items-center gap-1">
			{visible.map((layout) => {
				const isActive = layout._id === activeLayoutId;
				const isRenaming = layout._id === renamingId;
				return (
					<div key={layout._id} className="flex items-center gap-1">
						{isRenaming ? (
							<RenameTabInput
								initialValue={layout.name}
								onCancel={() => setRenamingId(null)}
								onSubmit={async (name) => {
									await onRename(layout._id, name);
									setRenamingId(null);
								}}
							/>
						) : (
							<TabButton
								active={isActive}
								onClick={() => onActivate(layout._id)}
								onContextMenu={(e) => {
									e.preventDefault();
									setRenamingId(layout._id);
								}}
								label={layout.name}
							/>
						)}
						{isActive && !isRenaming && (
							<TabActions
								onRename={() => setRenamingId(layout._id)}
								onDuplicate={() => onDuplicate(layout._id)}
								onDelete={() => {
									if (window.confirm(t(DashboardKeys.TABS_DELETE_CONFIRM))) {
										onDelete(layout._id);
									}
								}}
							/>
						)}
					</div>
				);
			})}

			{overflow.length > 0 && (
				<div className="relative" ref={overflowRef}>
					<button
						type="button"
						onClick={() => setOverflowOpen((v) => !v)}
						className="text-xs px-2 py-1 rounded-md hover:bg-(--bg-hover) text-faint-foreground inline-flex items-center gap-1"
						aria-label={t(DashboardKeys.TABS_OVERFLOW)}
					>
						<MoreHorizontal size={14} />
					</button>
					{overflowOpen && (
						<Surface
							tone="elevated"
							className="absolute right-0 top-full mt-1 z-10 min-w-40 py-1"
						>
							{overflow.map((layout) => (
								<button
									key={layout._id}
									type="button"
									onClick={() => {
										onActivate(layout._id);
										setOverflowOpen(false);
									}}
									className="w-full text-left text-xs px-3 py-1.5 hover:bg-(--bg-hover) text-foreground"
								>
									{layout.name}
								</button>
							))}
						</Surface>
					)}
				</div>
			)}

			<button
				type="button"
				onClick={onCreate}
				className="text-xs px-2 py-1 rounded-md hover:bg-(--bg-hover) text-foreground inline-flex items-center gap-1"
				aria-label={t(DashboardKeys.TABS_NEW)}
			>
				<Plus size={14} />
				<span>{t(DashboardKeys.TABS_NEW)}</span>
			</button>
		</div>
	);
}

interface TabButtonProps {
	active: boolean;
	onClick: () => void;
	onContextMenu?: (event: React.MouseEvent) => void;
	label: string;
}

function TabButton({ active, onClick, onContextMenu, label }: TabButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			onContextMenu={onContextMenu}
			className={[
				"text-xs px-3 py-1 rounded-md transition-colors",
				active
					? "bg-(--btn-primary-bg) text-(--btn-primary-text)"
					: "text-faint-foreground hover:bg-(--bg-hover) hover:text-foreground",
			].join(" ")}
		>
			{label}
		</button>
	);
}

interface TabActionsProps {
	onRename: () => void;
	onDuplicate: () => void;
	onDelete: () => void;
}

function TabActions({ onRename, onDuplicate, onDelete }: TabActionsProps) {
	const { t } = useTranslation();
	return (
		<div className="flex items-center gap-0.5">
			<button
				type="button"
				onClick={onRename}
				className="p-1 rounded hover:bg-(--bg-hover) text-faint-foreground"
				aria-label={t(DashboardKeys.TABS_RENAME)}
				title={t(DashboardKeys.TABS_RENAME)}
			>
				<Pencil size={11} />
			</button>
			<button
				type="button"
				onClick={onDuplicate}
				className="p-1 rounded hover:bg-(--bg-hover) text-faint-foreground"
				aria-label={t(DashboardKeys.TABS_DUPLICATE)}
				title={t(DashboardKeys.TABS_DUPLICATE)}
			>
				<Copy size={11} />
			</button>
			<button
				type="button"
				onClick={onDelete}
				className="p-1 rounded hover:bg-(--bg-hover) text-faint-foreground hover:text-rose-500"
				aria-label={t(DashboardKeys.TABS_DELETE)}
				title={t(DashboardKeys.TABS_DELETE)}
			>
				<Trash2 size={11} />
			</button>
		</div>
	);
}

interface RenameTabInputProps {
	initialValue: string;
	onCancel: () => void;
	onSubmit: (value: string) => Promise<void> | void;
}

function RenameTabInput({ initialValue, onCancel, onSubmit }: RenameTabInputProps) {
	const [value, setValue] = useState(initialValue);
	return (
		<input
			autoFocus
			value={value}
			onChange={(e) => setValue(e.target.value)}
			onBlur={() => {
				const trimmed = value.trim();
				if (trimmed && trimmed !== initialValue) {
					void onSubmit(trimmed);
				} else {
					onCancel();
				}
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					const trimmed = value.trim();
					if (trimmed) void onSubmit(trimmed);
					else onCancel();
				} else if (e.key === "Escape") {
					onCancel();
				}
			}}
			className="text-xs px-2 py-1 rounded-md bg-background border border-(--border-default) w-32"
		/>
	);
}
