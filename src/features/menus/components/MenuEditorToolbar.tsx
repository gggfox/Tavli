import { LanguageTabBar, SearchInput } from "@/global/components";
import { useClickOutside, useEscapeKey } from "@/global/hooks";
import { MenusKeys } from "@/global/i18n";
import {
	ChevronsDownUp,
	ChevronsUpDown,
	Download,
	Ellipsis,
	Eye,
	EyeOff,
	Globe,
	LayoutGrid,
	ListChecks,
	Trash2,
	X,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { STATION_STYLE } from "./itemEditor/StationPicker";

const TOOL_BUTTON =
	"flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-faint-foreground hover:bg-hover disabled:opacity-50";

export interface MenuEditorToolbarProps {
	isTranslationMode: boolean;
	search: string;
	onSearchChange: (value: string) => void;
	languages: string[];
	defaultLanguage: string;
	selectedLanguage: string;
	onSelectLanguage: (lang: string) => void;
	languageSettingsOpen: boolean;
	onToggleLanguageSettings: () => void;
	onOpenOptionGroups: () => void;
	anyExpanded: boolean;
	canToggleAll: boolean;
	onToggleAll: () => void;
	visibleItemCount: number;
	onSelectAll: () => void;
	/** Phone only: the page header's Export moves into the ⋯ menu. */
	onExport?: () => void;
	exportLabel?: string;
	selection: {
		count: number;
		categoryCount: number;
		onClear: () => void;
		onHide: () => void;
		onShow: () => void;
		onKitchen: () => void;
		onBar: () => void;
		onDelete: () => void;
	};
}

/**
 * The menu editor's sticky toolbar. While items are selected it turns into
 * the bulk-action bar. On phones the secondary tools fold into a ⋯ menu so
 * the toolbar is one row: search, language, ⋯.
 */
export function MenuEditorToolbar(props: Readonly<MenuEditorToolbarProps>) {
	const { t } = useTranslation();
	const { selection } = props;

	if (!props.isTranslationMode && selection.count > 0) {
		return <BulkBar {...props} />;
	}

	const collapseLabel = props.anyExpanded
		? t(MenusKeys.EDITOR_COLLAPSE_ALL)
		: t(MenusKeys.EDITOR_EXPAND_ALL);
	const CollapseIcon = props.anyExpanded ? ChevronsDownUp : ChevronsUpDown;

	return (
		<div className="flex min-h-9 items-center gap-2 md:gap-3">
			{props.isTranslationMode ? null : (
				<button
					type="button"
					onClick={props.onSelectAll}
					disabled={props.visibleItemCount === 0}
					className={`${TOOL_BUTTON} hidden text-muted-foreground md:flex`}
				>
					<ListChecks size={16} aria-hidden /> {t(MenusKeys.EDITOR_SELECT_ALL)}
				</button>
			)}
			<SearchInput
				className="h-11 min-w-0 md:h-9"
				inputClassName="py-0"
				placeholder={t(MenusKeys.EDITOR_FILTER_PLACEHOLDER)}
				value={props.search}
				onChange={props.onSearchChange}
			/>
			<LanguageTabBar
				compact
				className="md:hidden"
				languages={props.languages}
				defaultLanguage={props.defaultLanguage}
				selectedLanguage={props.selectedLanguage}
				onSelect={props.onSelectLanguage}
			/>
			<MoreMenu
				items={[
					...(props.isTranslationMode
						? []
						: [
								{
									icon: <ListChecks size={17} />,
									label: t(MenusKeys.EDITOR_SELECT_ALL),
									onClick: props.onSelectAll,
								},
							]),
					{ icon: <CollapseIcon size={17} />, label: collapseLabel, onClick: props.onToggleAll },
					{
						icon: <Globe size={17} />,
						label: t(MenusKeys.EDITOR_LANGUAGES_LABEL),
						onClick: props.onToggleLanguageSettings,
					},
					{
						icon: <LayoutGrid size={17} />,
						label: t(MenusKeys.EDITOR_OPTIONS_TITLE),
						onClick: props.onOpenOptionGroups,
					},
					...(props.onExport && props.exportLabel
						? [{ icon: <Download size={17} />, label: props.exportLabel, onClick: props.onExport }]
						: []),
				]}
			/>
			<div className="ml-auto hidden shrink-0 items-center gap-1 md:flex">
				<button
					type="button"
					onClick={props.onToggleAll}
					disabled={!props.canToggleAll}
					className={TOOL_BUTTON}
					title={collapseLabel}
				>
					<CollapseIcon size={16} aria-hidden />
					<span className="hidden xl:inline">{collapseLabel}</span>
				</button>
				<LanguageTabBar
					languages={props.languages}
					defaultLanguage={props.defaultLanguage}
					selectedLanguage={props.selectedLanguage}
					onSelect={props.onSelectLanguage}
				/>
				<button
					type="button"
					onClick={props.onToggleLanguageSettings}
					className={`${TOOL_BUTTON} ${props.languageSettingsOpen ? "text-primary" : ""}`}
					title={t(MenusKeys.EDITOR_LANGUAGES_TITLE)}
				>
					<Globe size={16} aria-hidden />
					<span className="hidden xl:inline">{t(MenusKeys.EDITOR_LANGUAGES_LABEL)}</span>
				</button>
				<button
					type="button"
					onClick={props.onOpenOptionGroups}
					className={TOOL_BUTTON}
					title={t(MenusKeys.EDITOR_OPTIONS_TITLE)}
				>
					<LayoutGrid size={16} aria-hidden />
					<span className="hidden xl:inline">{t(MenusKeys.EDITOR_OPTIONS_LABEL)}</span>
				</button>
			</div>
		</div>
	);
}

function BulkBar({ selection, visibleItemCount, onSelectAll }: Readonly<MenuEditorToolbarProps>) {
	const { t } = useTranslation();
	return (
		<div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-primary/12 py-1 pl-1.5 pr-2 ring-1 ring-primary/45 md:min-h-10">
			<button
				type="button"
				onClick={selection.onClear}
				aria-label={t(MenusKeys.EDITOR_BULK_CLEAR)}
				title={t(MenusKeys.EDITOR_BULK_CLEAR)}
				className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground hover:bg-primary/20 md:h-8 md:w-8"
			>
				<X size={16} />
			</button>
			<span className="text-sm font-medium text-foreground" aria-live="polite">
				{t(MenusKeys.EDITOR_BULK_SELECTED, { count: selection.count })}
				<span className="ml-1.5 hidden font-normal text-muted-foreground sm:inline">
					{t(MenusKeys.EDITOR_BULK_IN_CATEGORIES, { count: selection.categoryCount })}
				</span>
			</span>
			{selection.count < visibleItemCount ? (
				<button
					type="button"
					onClick={onSelectAll}
					className="ml-1 text-xs text-primary hover:underline"
				>
					{t(MenusKeys.EDITOR_BULK_SELECT_EVERY, { count: visibleItemCount })}
				</button>
			) : null}
			<div className="flex w-full flex-wrap items-center gap-1 md:ml-auto md:w-auto">
				<BulkButton onClick={selection.onHide}>
					<EyeOff size={14} aria-hidden /> {t(MenusKeys.CATEGORY_BULK_HIDE)}
				</BulkButton>
				<BulkButton onClick={selection.onShow}>
					<Eye size={14} aria-hidden /> {t(MenusKeys.CATEGORY_BULK_SHOW)}
				</BulkButton>
				<span aria-hidden className="mx-1 hidden h-5 w-px bg-border md:block" />
				<BulkButton onClick={selection.onKitchen}>
					<span aria-hidden className={`h-2 w-2 rounded-full ${STATION_STYLE.kitchen.dot}`} />
					{t(MenusKeys.CATEGORY_BULK_MARK_KITCHEN)}
				</BulkButton>
				<BulkButton onClick={selection.onBar}>
					<span aria-hidden className={`h-2 w-2 rounded-full ${STATION_STYLE.bar.dot}`} />
					{t(MenusKeys.CATEGORY_BULK_MARK_BAR)}
				</BulkButton>
				<span aria-hidden className="mx-1 hidden h-5 w-px bg-border md:block" />
				<BulkButton onClick={selection.onDelete} danger>
					<Trash2 size={14} aria-hidden /> {t(MenusKeys.CATEGORY_BULK_DELETE)}
				</BulkButton>
			</div>
		</div>
	);
}

function BulkButton({
	children,
	onClick,
	danger,
}: Readonly<{ children: ReactNode; onClick: () => void; danger?: boolean }>) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium hover:bg-primary/20 md:h-8 ${
				danger ? "text-destructive" : "text-foreground"
			}`}
		>
			{children}
		</button>
	);
}

interface MoreMenuItem {
	icon: ReactNode;
	label: string;
	onClick: () => void;
}

/** Phone-only overflow for the toolbar's secondary tools. */
function MoreMenu({ items }: Readonly<{ items: readonly MoreMenuItem[] }>) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	useClickOutside([rootRef], () => setOpen(false), { enabled: open });
	useEscapeKey(() => setOpen(false), { enabled: open });

	return (
		<div ref={rootRef} className="relative shrink-0 md:hidden">
			<button
				type="button"
				aria-label={t(MenusKeys.EDITOR_MORE_ACTIONS)}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
				className="flex h-11 w-11 items-center justify-center rounded-lg hover-btn-secondary"
			>
				<Ellipsis size={18} />
			</button>
			{open ? (
				<ul
					role="menu"
					className="absolute right-0 top-12 z-40 w-64 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-[var(--shadow-lg)]"
				>
					{items.map((item) => (
						<li key={item.label} role="none">
							<button
								type="button"
								role="menuitem"
								onClick={() => {
									item.onClick();
									setOpen(false);
								}}
								className="flex h-11 w-full items-center gap-3 px-4 text-left text-sm text-foreground hover:bg-hover"
							>
								<span aria-hidden className="text-muted-foreground">
									{item.icon}
								</span>
								{item.label}
							</button>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
