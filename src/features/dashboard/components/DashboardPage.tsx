/**
 * Top-level orchestrator for the configurable dashboard.
 *
 * Wires together: scope switcher, layout tabs, edit toolbar, global controls,
 * widget grid, widget picker, templates drawer, and the publish-template
 * dialog. Holds the editing draft state in local React state and persists
 * via `dashboardLayouts.update` on Save.
 */
import "react-grid-layout/css/styles.css";

// Side-effect: every widget descriptor self-registers when this module loads.
import "../widgets";

import { useRestaurant } from "@/features/restaurants";
import {
	AdminPageLayout,
	DashboardShell,
	EmptyState,
	LoadingState,
	pushToast,
	Skeleton,
} from "@/global/components";
import { DashboardKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { LayoutDashboard } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layout as RGLLayout } from "react-grid-layout";
import { useTranslation } from "react-i18next";
import { BUSINESS_SUMMARY_CONFIG, BUSINESS_SUMMARY_NAME } from "../constants";
import { useDashboardLayouts } from "../hooks/useDashboardLayouts";
import { useDashboardPrefs } from "../hooks/useDashboardPrefs";
import type {
	DashboardLayout,
	DashboardLayoutConfig,
	DashboardRangeKind,
	DashboardWidgetInstance,
} from "../types";
import { type AnyWidgetDescriptor } from "../widgets";
import { DashboardEditToolbar } from "./DashboardEditToolbar";
import { DashboardGlobalControls } from "./DashboardGlobalControls";
import { DashboardGrid } from "./DashboardGrid";
import { DashboardLayoutTabs } from "./DashboardLayoutTabs";
import { DashboardScopeSwitcher } from "./DashboardScopeSwitcher";
import { PublishTemplateDialog } from "./PublishTemplateDialog";
import { TemplatesDrawer } from "./TemplatesDrawer";
import { WidgetPicker } from "./WidgetPicker";

interface DashboardPageProps {
	userRoles: ReadonlyArray<string>;
}

const DEFAULT_CONFIG: DashboardLayoutConfig = {
	globalDateRange: "week",
	compareToPrev: false,
	widgets: [],
};

export function DashboardPage({ userRoles }: DashboardPageProps) {
	const { t } = useTranslation();
	const {
		restaurant,
		restaurants,
		isMultiRestaurant,
		isLoading: restaurantsLoading,
	} = useRestaurant();
	const { scope, activeLayoutId, editMode, setScope, setActiveLayoutId, setEditMode } =
		useDashboardPrefs();

	const restaurantId = scope === "restaurant" ? (restaurant?._id ?? null) : null;
	// Currency for money widgets. Restaurant scope: the selected restaurant's.
	// Portfolio scope: best-effort first restaurant's (mirrors revenueOverTime,
	// which aggregates across possibly-different currencies).
	const currency =
		scope === "restaurant" ? (restaurant?.currency ?? null) : (restaurants[0]?.currency ?? null);

	const {
		layouts,
		isLoading: layoutsLoading,
		error: layoutsError,
		create,
		update,
		remove,
		duplicate,
	} = useDashboardLayouts({
		scopeKind: scope,
		restaurantId,
		enabled: scope === "portfolio" ? restaurants.length > 0 : Boolean(restaurantId),
	});

	const activeLayout = useMemo(() => {
		if (layouts.length === 0) return null;
		const fromId = layouts.find((l) => l._id === activeLayoutId);
		if (fromId) return fromId;
		return layouts[0];
	}, [layouts, activeLayoutId]);

	useEffect(() => {
		if (!activeLayout) return;
		if (activeLayout._id !== activeLayoutId) {
			setActiveLayoutId(activeLayout._id);
		}
	}, [activeLayout, activeLayoutId, setActiveLayoutId]);

	const [draftConfig, setDraftConfig] = useState<DashboardLayoutConfig | null>(null);
	// In-session config for the curated default view shown when the user has no
	// saved layout. Lets the global range / compare controls work before the
	// layout is materialized (on first edit).
	const [defaultViewConfig, setDefaultViewConfig] =
		useState<DashboardLayoutConfig>(BUSINESS_SUMMARY_CONFIG);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [templatesOpen, setTemplatesOpen] = useState(false);
	const [publishOpen, setPublishOpen] = useState(false);
	const [saving, setSaving] = useState(false);

	const lastLoadedLayoutId = useRef<string | null>(null);
	useEffect(() => {
		if (!editMode) return;
		if (!activeLayout) return;
		if (lastLoadedLayoutId.current !== activeLayout._id) {
			setDraftConfig(structuredClone(activeLayout.config));
			lastLoadedLayoutId.current = activeLayout._id;
		}
	}, [editMode, activeLayout]);

	useEffect(() => {
		if (!editMode) {
			setDraftConfig(null);
			lastLoadedLayoutId.current = null;
		}
	}, [editMode]);

	// No saved layout → show the curated "Business Summary" default config.
	const effectiveConfig: DashboardLayoutConfig =
		(editMode && draftConfig) || activeLayout?.config || defaultViewConfig;

	const dirty =
		editMode &&
		activeLayout !== null &&
		draftConfig !== null &&
		JSON.stringify(draftConfig) !== JSON.stringify(activeLayout.config);

	const canPublishTemplate = useMemo(() => {
		if (scope !== "restaurant") return false;
		return userRoles.some((r) => r === "admin" || r === "owner" || r === "manager");
	}, [scope, userRoles]);

	const publishTemplateMutation = useMutation({
		mutationFn: useConvexMutation(api.dashboardTemplates.publish),
	});

	const handleEnterEdit = useCallback(() => {
		// Editing the curated default materializes it as the user's own layout.
		if (!activeLayout) {
			void (async () => {
				const id = await create({
					name: BUSINESS_SUMMARY_NAME,
					config: structuredClone(defaultViewConfig),
				});
				setActiveLayoutId(id);
				setEditMode(true);
			})();
			return;
		}
		setEditMode(true);
	}, [activeLayout, create, defaultViewConfig, setActiveLayoutId, setEditMode]);

	const handleDiscard = useCallback(() => {
		setDraftConfig(null);
		lastLoadedLayoutId.current = null;
		setEditMode(false);
	}, [setEditMode]);

	const handleSave = useCallback(async () => {
		if (!activeLayout || !draftConfig) return;
		setSaving(true);
		try {
			await update({ layoutId: activeLayout._id, config: draftConfig });
			pushToast({
				id: `dashboard-saved-${Date.now()}`,
				kind: "success",
				title: t(DashboardKeys.EDIT_SAVED),
			});
			setEditMode(false);
		} catch (e) {
			pushToast({
				id: `dashboard-save-failed-${Date.now()}`,
				kind: "error",
				title: t(DashboardKeys.EDIT_SAVE_FAILED),
				body: e instanceof Error ? e.message : String(e),
			});
		} finally {
			setSaving(false);
		}
	}, [activeLayout, draftConfig, update, setEditMode, t]);

	const handleAddWidget = useCallback(
		(descriptor: AnyWidgetDescriptor) => {
			if (!editMode || !draftConfig) return;
			const newWidget: DashboardWidgetInstance = {
				instanceId: cryptoRandomId(),
				widgetType: descriptor.type,
				gridPosition: {
					x: 0,
					y: nextY(draftConfig),
					w: descriptor.defaultGrid.w,
					h: descriptor.defaultGrid.h,
				},
				options: descriptor.defaultOptions,
			};
			setDraftConfig({ ...draftConfig, widgets: [...draftConfig.widgets, newWidget] });
			setPickerOpen(false);
		},
		[editMode, draftConfig]
	);

	const handleRemoveWidget = useCallback(
		(instanceId: string) => {
			if (!editMode || !draftConfig) return;
			setDraftConfig({
				...draftConfig,
				widgets: draftConfig.widgets.filter((w) => w.instanceId !== instanceId),
			});
		},
		[editMode, draftConfig]
	);

	const handleGridChange = useCallback(
		(next: RGLLayout) => {
			if (!editMode || !draftConfig) return;
			const byId = new Map(next.map((l) => [l.i, l]));
			const updatedWidgets = draftConfig.widgets.map((w) => {
				const item = byId.get(w.instanceId);
				if (!item) return w;
				if (
					item.x === w.gridPosition.x &&
					item.y === w.gridPosition.y &&
					item.w === w.gridPosition.w &&
					item.h === w.gridPosition.h
				) {
					return w;
				}
				return {
					...w,
					gridPosition: {
						x: item.x,
						y: item.y,
						w: item.w,
						h: item.h,
					},
				};
			});
			setDraftConfig({ ...draftConfig, widgets: updatedWidgets });
		},
		[editMode, draftConfig]
	);

	const handleRangeChange = useCallback(
		(next: DashboardRangeKind) => {
			const baseConfig = effectiveConfig;
			const updated: DashboardLayoutConfig = {
				...baseConfig,
				globalDateRange: next,
			};
			if (editMode) {
				setDraftConfig(updated);
				return;
			}
			if (activeLayout) {
				void update({ layoutId: activeLayout._id, config: updated });
				return;
			}
			setDefaultViewConfig(updated);
		},
		[effectiveConfig, editMode, activeLayout, update]
	);

	const handleCompareToggle = useCallback(
		(next: boolean) => {
			const baseConfig = effectiveConfig;
			const updated: DashboardLayoutConfig = {
				...baseConfig,
				compareToPrev: next,
			};
			if (editMode) {
				setDraftConfig(updated);
				return;
			}
			if (activeLayout) {
				void update({ layoutId: activeLayout._id, config: updated });
				return;
			}
			setDefaultViewConfig(updated);
		},
		[effectiveConfig, editMode, activeLayout, update]
	);

	const handleCreateLayout = useCallback(async () => {
		const number = layouts.length + 1;
		const id = await create({
			name: t(DashboardKeys.TABS_DEFAULT_NAME, { number }),
			config: structuredClone(DEFAULT_CONFIG),
		});
		setActiveLayoutId(id);
	}, [create, layouts.length, setActiveLayoutId, t]);

	const handleRenameLayout = useCallback(
		async (id: Id<"dashboardLayouts">, name: string) => {
			await update({ layoutId: id, name });
		},
		[update]
	);

	const handleDuplicateLayout = useCallback(
		async (id: Id<"dashboardLayouts">) => {
			const newId = await duplicate({ layoutId: id });
			setActiveLayoutId(newId);
		},
		[duplicate, setActiveLayoutId]
	);

	const handleDeleteLayout = useCallback(
		async (id: Id<"dashboardLayouts">) => {
			await remove(id);
			if (activeLayoutId === id) {
				const next = layouts.find((l) => l._id !== id);
				setActiveLayoutId(next?._id);
			}
		},
		[remove, activeLayoutId, layouts, setActiveLayoutId]
	);

	const handlePublishTemplate = useCallback(
		async (args: { name: string; description?: string }) => {
			if (!restaurantId || !activeLayout) return;
			const result = await publishTemplateMutation.mutateAsync({
				restaurantId,
				name: args.name,
				description: args.description,
				config: activeLayout.config,
			});
			unwrapResult(result);
			pushToast({
				id: `dashboard-template-published-${Date.now()}`,
				kind: "success",
				title: t(DashboardKeys.EDIT_SAVED),
			});
		},
		[restaurantId, activeLayout, publishTemplateMutation, t]
	);

	if (restaurantsLoading) return <LoadingState />;

	if (restaurants.length === 0) {
		return (
			<AdminPageLayout>
				<EmptyState
					icon={LayoutDashboard}
					title={t(DashboardKeys.PAGE_NO_RESTAURANT_TITLE)}
					description={t(DashboardKeys.PAGE_NO_RESTAURANT_DESCRIPTION)}
				/>
			</AdminPageLayout>
		);
	}

	const restaurantLabel = restaurant?.name ?? t(DashboardKeys.PAGE_TITLE);

	const header = (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-3">
				{isMultiRestaurant && (
					<DashboardScopeSwitcher
						value={scope}
						onChange={setScope}
						restaurantLabel={restaurantLabel}
					/>
				)}
				<div className="ml-auto">
					<DashboardEditToolbar
						editing={editMode}
						dirty={dirty}
						canPublishTemplate={canPublishTemplate && !!activeLayout}
						onEnterEdit={handleEnterEdit}
						onSave={() => void handleSave()}
						onDiscard={handleDiscard}
						onAddWidget={() => setPickerOpen(true)}
						onPublishTemplate={() => setPublishOpen(true)}
						onBrowseTemplates={() => setTemplatesOpen(true)}
						saving={saving}
					/>
				</div>
			</div>

			<DashboardLayoutTabs
				layouts={layouts}
				activeLayoutId={activeLayout?._id}
				onActivate={(id) => setActiveLayoutId(id)}
				onCreate={() => void handleCreateLayout()}
				onRename={handleRenameLayout}
				onDuplicate={(id) => void handleDuplicateLayout(id)}
				onDelete={(id) => void handleDeleteLayout(id)}
			/>

			<DashboardGlobalControls
				rangeKind={effectiveConfig.globalDateRange}
				compareToPrev={effectiveConfig.compareToPrev}
				onRangeChange={handleRangeChange}
				onCompareToggle={handleCompareToggle}
			/>
		</div>
	);

	return (
		<>
			<AdminPageLayout>
				<DashboardShell
					isLoading={layoutsLoading}
					error={layoutsError as { message?: string } | null}
					entityName="dashboards"
					skeleton={<DashboardGridSkeleton />}
					header={header}
					gap="6"
				>
					<DashboardGrid
						config={effectiveConfig}
						scopeKind={scope}
						restaurantId={restaurantId}
						currency={currency}
						editing={editMode}
						onLayoutChange={handleGridChange}
						onRemoveWidget={handleRemoveWidget}
					/>
				</DashboardShell>
			</AdminPageLayout>

			<WidgetPicker
				open={pickerOpen}
				scopeKind={scope}
				userRoles={userRoles}
				onPick={handleAddWidget}
				onClose={() => setPickerOpen(false)}
			/>

			<TemplatesDrawer
				open={templatesOpen}
				restaurantId={restaurantId as Id<"restaurants"> | null}
				canManage={canPublishTemplate}
				onClose={() => setTemplatesOpen(false)}
				onCloned={(layoutId) => {
					setActiveLayoutId(layoutId);
					setTemplatesOpen(false);
				}}
			/>

			<PublishTemplateDialog
				open={publishOpen}
				defaultName={activeLayout?.name ?? ""}
				onSubmit={handlePublishTemplate}
				onClose={() => setPublishOpen(false)}
			/>
		</>
	);
}

function DashboardGridSkeleton() {
	return (
		<div className="grid grid-cols-12 gap-3">
			<Skeleton className="col-span-3 h-32 rounded-lg" />
			<Skeleton className="col-span-3 h-32 rounded-lg" />
			<Skeleton className="col-span-6 h-32 rounded-lg" />
			<Skeleton className="col-span-6 h-48 rounded-lg" />
			<Skeleton className="col-span-6 h-48 rounded-lg" />
		</div>
	);
}

function nextY(config: DashboardLayoutConfig): number {
	if (config.widgets.length === 0) return 0;
	return Math.max(...config.widgets.map((w) => w.gridPosition.y + w.gridPosition.h));
}

function cryptoRandomId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return Math.random().toString(36).slice(2);
}

export type { DashboardLayout };
