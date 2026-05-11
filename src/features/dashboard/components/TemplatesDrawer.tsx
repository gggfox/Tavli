/**
 * Drawer that lists per-restaurant published templates and lets a user
 * clone one into a new owned layout. Managers (and above) also see a
 * "delete template" affordance.
 */
import { unwrapResult } from "@/global/utils";
import { Drawer, EmptyState, Surface } from "@/global/components";
import { DashboardKeys } from "@/global/i18n";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Library, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface TemplatesDrawerProps {
	open: boolean;
	restaurantId: Id<"restaurants"> | null;
	canManage: boolean;
	onClose: () => void;
	onCloned: (layoutId: Id<"dashboardLayouts">) => void;
}

export function TemplatesDrawer({
	open,
	restaurantId,
	canManage,
	onClose,
	onCloned,
}: TemplatesDrawerProps) {
	const { t } = useTranslation();

	const queryArgs = restaurantId ? { restaurantId } : "skip";
	const query = useQuery({
		...convexQuery(api.dashboardTemplates.list, queryArgs),
		select: unwrapResult<Doc<"dashboardTemplates">[]>,
	});

	const cloneMutation = useMutation({
		mutationFn: useConvexMutation(api.dashboardTemplates.cloneToLayout),
	});
	const deleteMutation = useMutation({
		mutationFn: useConvexMutation(api.dashboardTemplates.unpublish),
	});

	const handleClone = async (templateId: Id<"dashboardTemplates">) => {
		const result = await cloneMutation.mutateAsync({ templateId });
		const id = unwrapResult(result) as Id<"dashboardLayouts">;
		onCloned(id);
		onClose();
	};

	const handleDelete = async (templateId: Id<"dashboardTemplates">) => {
		if (!window.confirm(t(DashboardKeys.TEMPLATES_DELETE_CONFIRM))) return;
		const result = await deleteMutation.mutateAsync({ templateId });
		unwrapResult(result);
	};

	const templates = query.data ?? [];

	return (
		<Drawer
			isOpen={open}
			onClose={onClose}
			ariaLabel={t(DashboardKeys.TEMPLATES_TITLE)}
			side="right"
		>
			<div className="p-4 space-y-4">
				<div>
					<h2 className="text-sm font-semibold text-foreground">
						{t(DashboardKeys.TEMPLATES_TITLE)}
					</h2>
					<p className="text-xs text-faint-foreground mt-1">
						{t(DashboardKeys.TEMPLATES_DESCRIPTION)}
					</p>
				</div>

				{templates.length === 0 ? (
					<EmptyState
						icon={Library}
						title={t(DashboardKeys.TEMPLATES_EMPTY_TITLE)}
						description={t(DashboardKeys.TEMPLATES_EMPTY_DESCRIPTION)}
					/>
				) : (
					<ul className="space-y-2">
						{templates.map((template) => (
							<li key={template._id}>
								<Surface tone="secondary" className="p-3">
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0">
											<p className="text-sm font-medium text-foreground truncate">
												{template.name}
											</p>
											{template.description && (
												<p className="text-xs text-faint-foreground mt-1">
													{template.description}
												</p>
											)}
										</div>
										{canManage && (
											<button
												type="button"
												onClick={() => void handleDelete(template._id)}
												className="text-faint-foreground hover:text-rose-500 p-1"
												aria-label={t(DashboardKeys.TEMPLATES_DELETE)}
												title={t(DashboardKeys.TEMPLATES_DELETE)}
											>
												<Trash2 size={12} />
											</button>
										)}
									</div>
									<div className="mt-3 flex justify-end">
										<button
											type="button"
											onClick={() => void handleClone(template._id)}
											disabled={cloneMutation.isPending}
											className="text-xs px-2.5 py-1 rounded-md bg-(--btn-primary-bg) text-(--btn-primary-text) disabled:opacity-50"
										>
											{t(DashboardKeys.TEMPLATES_USE_THIS)}
										</button>
									</div>
								</Surface>
							</li>
						))}
					</ul>
				)}
			</div>
		</Drawer>
	);
}
