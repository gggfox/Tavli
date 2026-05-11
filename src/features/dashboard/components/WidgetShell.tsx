/**
 * Visual chrome that wraps every widget body. Renders the widget's icon,
 * label, optional override badge and edit-mode controls (remove). Keeps the
 * widget body in a tone="secondary" Surface so all widgets visually match
 * the rest of the admin UI.
 */
import { Surface } from "@/global/components";
import { DashboardKeys } from "@/global/i18n";
import { GripVertical, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import type { AnyWidgetDescriptor } from "../widgets/registry";

interface WidgetShellProps {
	descriptor: AnyWidgetDescriptor;
	hasOverride: boolean;
	editing: boolean;
	onRemove?: () => void;
	children: ReactNode;
}

export function WidgetShell({
	descriptor,
	hasOverride,
	editing,
	onRemove,
	children,
}: WidgetShellProps) {
	const { t } = useTranslation();
	const Icon = descriptor.icon;
	return (
		<Surface
			tone="secondary"
			className="h-full flex flex-col overflow-hidden"
		>
			<div className="flex items-center gap-2 px-3 py-2 border-b border-(--border-default)">
				{editing ? (
					<button
						type="button"
						className="dashboard-drag-handle cursor-grab text-faint-foreground hover:text-foreground"
						aria-label={t(DashboardKeys.EDIT_DRAG_HANDLE)}
					>
						<GripVertical size={14} />
					</button>
				) : (
					<Icon size={14} className="text-faint-foreground" />
				)}
				<span className="text-sm font-medium text-foreground truncate">
					{t(descriptor.i18nLabelKey)}
				</span>
				{hasOverride && (
					<span className="ml-auto text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-hover text-faint-foreground">
						{t(DashboardKeys.OVERRIDE_BADGE)}
					</span>
				)}
				{editing && onRemove && (
					<button
						type="button"
						onClick={onRemove}
						aria-label={t(DashboardKeys.EDIT_REMOVE_WIDGET)}
						className="ml-auto text-faint-foreground hover:text-foreground"
					>
						<X size={14} />
					</button>
				)}
			</div>
			<div className="flex-1 min-h-0 p-3 overflow-auto">{children}</div>
		</Surface>
	);
}
