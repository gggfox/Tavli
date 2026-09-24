import { MenusKeys } from "@/global/i18n";
import { getImageFromClipboard } from "@/global/utils";
import { MENU_AI_IMAGE_FAILURE } from "convex/constants";
import { ImagePlus, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { MenuItemDraft } from "../../hooks/useMenuItemDraft";

/** Below this many generations left this month, the count is shown. */
const SCARCE_THRESHOLD = 20;

const FAILURE_KEYS: Record<string, string> = {
	[MENU_AI_IMAGE_FAILURE.CREDITS_EXHAUSTED]: "errors.AI_IMAGE_CREDITS_EXHAUSTED",
	[MENU_AI_IMAGE_FAILURE.CONTENT_BLOCKED]: "errors.AI_IMAGE_CONTENT_BLOCKED",
};

const ACTION_BUTTON =
	"flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground ring-1 ring-border hover:bg-hover hover:text-foreground disabled:opacity-50 md:h-8 md:text-xs";

/**
 * The item's photo as one well: the picture, a drop and paste target, and its
 * actions. Every change here is part of the editor's draft — nothing reaches
 * diners until Guardar, including an AI draft (saving approves it).
 */
export function ItemImageWell({
	draft,
	itemName,
	aspectClassName = "aspect-square",
}: Readonly<{ draft: MenuItemDraft; itemName: string; aspectClassName?: string }>) {
	const { t } = useTranslation();
	const fileRef = useRef<HTMLInputElement>(null);
	const { image } = draft;
	const view = image.generation;
	const job = view?.activeJob;
	const exhausted = view ? view.remainingThisMonth <= 0 : false;
	const failure = job?.status === "failed" ? job.error : null;
	const isAIDraft = image.change.kind === "ai";

	return (
		<div>
			<input
				ref={fileRef}
				type="file"
				accept="image/*"
				hidden
				onChange={(e) => {
					image.takeFile(e.target.files?.[0]);
					e.target.value = "";
				}}
			/>
			<div
				// Focusable so a paste lands here; the photo itself is decorative.
				tabIndex={0}
				role="group"
				aria-label={t(MenusKeys.FORM_IMAGE_HEADER)}
				onPaste={(e) => {
					const file = getImageFromClipboard(e);
					if (!file) return;
					e.preventDefault();
					image.takeFile(file);
				}}
				onDragOver={(e) => e.preventDefault()}
				onDrop={(e) => {
					e.preventDefault();
					image.takeFile(e.dataTransfer.files[0]);
				}}
				className={`group/well relative ${aspectClassName} overflow-hidden rounded-xl bg-tertiary/40 outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-primary`}
			>
				{image.previewUrl ? (
					<>
						<img src={image.previewUrl} alt={itemName} className="h-full w-full object-cover" />
						{image.isAI ? (
							<span
								title={t(MenusKeys.AI_IMAGE_BADGE_TOOLTIP)}
								className="absolute left-2 top-2 rounded bg-primary px-1.5 text-[10px] font-bold leading-4 text-primary-foreground"
							>
								{isAIDraft ? t(MenusKeys.ITEM_EDITOR_AI_DRAFT) : t(MenusKeys.AI_IMAGE_BADGE)}
							</span>
						) : null}
						{image.changed && !isAIDraft ? (
							<span className="absolute right-2 top-2 rounded bg-warning px-1.5 text-[10px] font-semibold leading-4 text-inverse-foreground">
								{t(MenusKeys.ITEM_EDITOR_UNSAVED)}
							</span>
						) : null}
						<button
							type="button"
							onClick={() => void image.clear()}
							disabled={image.busy}
							aria-label={
								isAIDraft ? t(MenusKeys.AI_IMAGE_DISCARD) : t(MenusKeys.ITEM_EDITOR_REMOVE_PHOTO)
							}
							title={
								isAIDraft ? t(MenusKeys.AI_IMAGE_DISCARD) : t(MenusKeys.ITEM_EDITOR_REMOVE_PHOTO)
							}
							className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-lg bg-black/60 text-white backdrop-blur transition hover:bg-destructive focus-visible:opacity-100 md:h-8 md:w-8 md:opacity-0 md:group-hover/well:opacity-100"
						>
							<Trash2 size={15} />
						</button>
					</>
				) : (
					<button
						type="button"
						onClick={() => fileRef.current?.click()}
						className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-[inherit] border-2 border-dashed border-border-strong px-4 text-center text-xs text-faint-foreground hover:text-muted-foreground"
					>
						<ImagePlus size={22} aria-hidden />
						{t(MenusKeys.ITEM_EDITOR_DROP_HINT)}
					</button>
				)}
				{image.generating ? (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/65 text-xs text-white backdrop-blur-sm">
						<Loader2 size={20} className="animate-spin" aria-hidden />
						{t(MenusKeys.AI_IMAGE_GENERATING)}
						{job ? ` · ${t(MenusKeys.AI_IMAGE_ATTEMPT, { n: job.attempt })}` : null}
					</div>
				) : null}
			</div>

			<div className="mt-2 flex gap-1.5">
				<button type="button" onClick={() => fileRef.current?.click()} className={ACTION_BUTTON}>
					<ImagePlus size={14} aria-hidden />
					{image.previewUrl
						? t(MenusKeys.ITEM_EDITOR_CHANGE_PHOTO)
						: t(MenusKeys.ITEM_EDITOR_UPLOAD_PHOTO)}
				</button>
				{view && view.monthlyLimit > 0 ? (
					<button
						type="button"
						onClick={() => void image.generate()}
						disabled={image.generating || image.busy || exhausted}
						className={ACTION_BUTTON}
					>
						<Sparkles size={14} className="text-primary" aria-hidden />
						{isAIDraft ? t(MenusKeys.AI_IMAGE_REGENERATE) : t(MenusKeys.AI_IMAGE_GENERATE)}
					</button>
				) : null}
			</div>
			{view && view.monthlyLimit === 0 ? (
				<p className="mt-1.5 text-xs text-faint-foreground">{t(MenusKeys.AI_IMAGE_LIMIT_OFF)}</p>
			) : view && view.remainingThisMonth < SCARCE_THRESHOLD ? (
				<p className="mt-1.5 text-xs text-faint-foreground">
					{t(MenusKeys.AI_IMAGE_REMAINING, { count: view.remainingThisMonth })}
				</p>
			) : null}
			{failure ? (
				<p className="mt-1.5 text-xs text-destructive">
					{t(FAILURE_KEYS[failure] ?? MenusKeys.AI_IMAGE_FAILED)}
				</p>
			) : null}
		</div>
	);
}
