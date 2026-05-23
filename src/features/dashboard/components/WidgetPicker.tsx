/**
 * Modal-style picker for adding a new widget instance to the active layout.
 *
 * Widgets the user lacks the role for are hidden by default; we expose a
 * "show locked" toggle to surface them grayed-out so users at least know
 * they exist.
 *
 * For portfolio scope, widgets without `portfolioCapable: true` are filtered
 * out entirely.
 */
import { Drawer, Surface } from "@/global/components";
import { DashboardKeys } from "@/global/i18n";
import { Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listWidgetDescriptors, userHasWidgetRole, type AnyWidgetDescriptor } from "../widgets";
import type { DashboardScopeKind } from "../types";

interface WidgetPickerProps {
	open: boolean;
	scopeKind: DashboardScopeKind;
	userRoles: ReadonlyArray<string>;
	onPick: (descriptor: AnyWidgetDescriptor) => void;
	onClose: () => void;
}

export function WidgetPicker({ open, scopeKind, userRoles, onPick, onClose }: WidgetPickerProps) {
	const { t } = useTranslation();
	const [showLocked, setShowLocked] = useState(false);

	const filteredDescriptors = useMemo(() => {
		const all = listWidgetDescriptors();
		return all.filter((d) => {
			if (scopeKind === "portfolio" && !d.portfolioCapable) return false;
			const allowed = userHasWidgetRole(userRoles, d.requiredRole);
			return allowed || showLocked;
		});
	}, [scopeKind, userRoles, showLocked]);

	return (
		<Drawer isOpen={open} onClose={onClose} ariaLabel={t(DashboardKeys.PICKER_TITLE)} side="right">
			<div className="p-4 space-y-4">
				<div>
					<h2 className="text-sm font-semibold text-foreground">{t(DashboardKeys.PICKER_TITLE)}</h2>
					<p className="text-xs text-faint-foreground mt-1">
						{t(DashboardKeys.PICKER_DESCRIPTION)}
					</p>
				</div>

				<label className="flex items-center gap-2 text-xs text-faint-foreground">
					<input
						type="checkbox"
						checked={showLocked}
						onChange={(e) => setShowLocked(e.target.checked)}
					/>
					<span>{t(DashboardKeys.PICKER_LOCKED_BADGE)}</span>
				</label>

				<ul className="space-y-2">
					{filteredDescriptors.map((descriptor) => {
						const allowed = userHasWidgetRole(userRoles, descriptor.requiredRole);
						return (
							<li key={descriptor.type}>
								<WidgetCard
									descriptor={descriptor}
									allowed={allowed}
									onPick={() => allowed && onPick(descriptor)}
								/>
							</li>
						);
					})}
				</ul>
			</div>
		</Drawer>
	);
}

interface WidgetCardProps {
	descriptor: AnyWidgetDescriptor;
	allowed: boolean;
	onPick: () => void;
}

function WidgetCard({ descriptor, allowed, onPick }: WidgetCardProps) {
	const { t } = useTranslation();
	const Icon = descriptor.icon;
	return (
		<Surface
			as="button"
			type="button"
			onClick={onPick}
			interactive={allowed}
			tone="secondary"
			className={`w-full text-left p-3 flex gap-3 items-start ${
				allowed ? "" : "opacity-50 cursor-not-allowed"
			}`}
			disabled={!allowed}
		>
			<Icon size={18} className="text-faint-foreground shrink-0 mt-0.5" />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2 flex-wrap">
					<span className="text-sm font-medium text-foreground">{t(descriptor.i18nLabelKey)}</span>
					{!allowed && (
						<span
							className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-hover text-faint-foreground inline-flex items-center gap-1"
							title={t(DashboardKeys.PICKER_LOCKED_TOOLTIP)}
						>
							<Lock size={10} />
							{t(DashboardKeys.PICKER_LOCKED_BADGE)}
						</span>
					)}
					{descriptor.portfolioCapable && (
						<span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-hover text-faint-foreground">
							{t(DashboardKeys.PICKER_PORTFOLIO_BADGE)}
						</span>
					)}
				</div>
				<p className="text-xs text-faint-foreground mt-1">{t(descriptor.i18nDescriptionKey)}</p>
			</div>
		</Surface>
	);
}
