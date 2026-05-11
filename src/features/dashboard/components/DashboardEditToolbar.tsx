/**
 * Bar shown above the grid in edit mode. Hosts Save / Discard, Add widget,
 * and (for managers) Save-as-template. Outside of edit mode, only the
 * "Edit layout" button is shown plus the "Templates" entry point.
 */
import { DashboardKeys } from "@/global/i18n";
import { Library, Pencil, Plus, Save, Undo2, UploadCloud } from "lucide-react";
import { useTranslation } from "react-i18next";

interface DashboardEditToolbarProps {
	editing: boolean;
	dirty: boolean;
	canPublishTemplate: boolean;
	onEnterEdit: () => void;
	onSave: () => void;
	onDiscard: () => void;
	onAddWidget: () => void;
	onPublishTemplate: () => void;
	onBrowseTemplates: () => void;
	saving: boolean;
}

export function DashboardEditToolbar({
	editing,
	dirty,
	canPublishTemplate,
	onEnterEdit,
	onSave,
	onDiscard,
	onAddWidget,
	onPublishTemplate,
	onBrowseTemplates,
	saving,
}: DashboardEditToolbarProps) {
	const { t } = useTranslation();

	if (!editing) {
		return (
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={onBrowseTemplates}
					className="text-xs px-2.5 py-1 rounded-md border border-(--border-default) hover:bg-(--bg-hover) text-foreground inline-flex items-center gap-1.5"
				>
					<Library size={12} />
					<span>{t(DashboardKeys.TEMPLATES_BROWSE)}</span>
				</button>
				<button
					type="button"
					onClick={onEnterEdit}
					className="text-xs px-2.5 py-1 rounded-md bg-(--btn-primary-bg) text-(--btn-primary-text) inline-flex items-center gap-1.5"
				>
					<Pencil size={12} />
					<span>{t(DashboardKeys.EDIT_ENTER)}</span>
				</button>
			</div>
		);
	}

	return (
		<div className="flex flex-wrap items-center gap-2">
			<button
				type="button"
				onClick={onAddWidget}
				className="text-xs px-2.5 py-1 rounded-md border border-(--border-default) hover:bg-(--bg-hover) text-foreground inline-flex items-center gap-1.5"
			>
				<Plus size={12} />
				<span>{t(DashboardKeys.EDIT_ADD_WIDGET)}</span>
			</button>
			{canPublishTemplate && (
				<button
					type="button"
					onClick={onPublishTemplate}
					className="text-xs px-2.5 py-1 rounded-md border border-(--border-default) hover:bg-(--bg-hover) text-foreground inline-flex items-center gap-1.5"
				>
					<UploadCloud size={12} />
					<span>{t(DashboardKeys.TEMPLATES_PUBLISH)}</span>
				</button>
			)}
			{dirty && (
				<span className="text-[11px] text-amber-600 dark:text-amber-400">
					{t(DashboardKeys.EDIT_UNSAVED_CHANGES)}
				</span>
			)}
			<div className="ml-auto flex items-center gap-2">
				<button
					type="button"
					onClick={onDiscard}
					disabled={saving}
					className="text-xs px-2.5 py-1 rounded-md border border-(--border-default) hover:bg-(--bg-hover) text-foreground inline-flex items-center gap-1.5 disabled:opacity-50"
				>
					<Undo2 size={12} />
					<span>{t(DashboardKeys.EDIT_DISCARD)}</span>
				</button>
				<button
					type="button"
					onClick={onSave}
					disabled={saving}
					className="text-xs px-2.5 py-1 rounded-md bg-(--btn-primary-bg) text-(--btn-primary-text) inline-flex items-center gap-1.5 disabled:opacity-50"
				>
					<Save size={12} />
					<span>{t(DashboardKeys.EDIT_SAVE)}</span>
				</button>
			</div>
		</div>
	);
}
