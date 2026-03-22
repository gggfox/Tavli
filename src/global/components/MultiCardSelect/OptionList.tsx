import { getIconComponent } from "@/global/utils/iconMapper";
import { EmptyState } from "./EmptyState";
import { OptionCard } from "./OptionCard";
import { useMultiCardSelectControls } from "./hooks/useMultiCardSelectControls";

type OptionListProps<T extends { _id: string; name: string; icon?: string }> = Readonly<{
	options: T[];
	groupBy: (item: T) => string;
	selectedIds: string[];
	cardRefs: React.RefObject<(HTMLButtonElement | null)[]>;
	onChange: (ids: string[]) => void;
}>;

export function OptionList<T extends { _id: string; name: string; icon?: string }>({
	options,
	groupBy,
	selectedIds,
	onChange,
	cardRefs,
}: OptionListProps<T>) {
	const { flatOptions, toggleOption, handleKeyDown, groupEntries } = useMultiCardSelectControls({
		options,
		groupBy,
		selectedIds,
		onChange,
		cardRefs,
	});

	if (groupEntries.length === 0) return <EmptyState isEmpty={true} />;

	return (
		<div className="flex flex-row gap-6 flex-wrap">
			{groupEntries.map(([group, items]) => (
				<div key={group || "default"} className="space-y-2">
					<GroupHeader group={group} />

					{/* Cards Flex Container */}
					<div className="flex flex-row gap-3 flex-wrap">
						{items.map((opt) => {
							// Calculate global index for keyboard navigation
							const globalIndex = flatOptions.findIndex((o) => o._id === opt._id);
							const isSelected = selectedIds.includes(opt._id);
							const Icon = getIconComponent(opt.icon);

							return (
								<OptionCard
									key={opt._id}
									globalIndex={globalIndex}
									cardRefs={cardRefs}
									toggleOption={toggleOption}
									handleKeyDown={handleKeyDown}
									opt={opt}
									isSelected={isSelected}
									Icon={Icon}
								/>
							);
						})}
					</div>
				</div>
			))}
		</div>
	);
}

type GroupHeaderProps = Readonly<{
	group: string;
}>;

function GroupHeader({ group }: GroupHeaderProps) {
	if (!group) return <div className="hidden"></div>;
	return (
		<div
			className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider"
			style={{ color: "var(--text-muted)" }}
		>
			{group.replaceAll("_", " ")}
		</div>
	);
}
