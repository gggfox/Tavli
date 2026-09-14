/**
 * "Generar con IA" for one menu item, in place (workstream B).
 *
 * Subscribes to the item's generation state and renders one of: the button,
 * progress with the attempt number, a pending draft with approve / regenerate
 * / discard, or a recent failure with a retry. A draft only reaches diners
 * through *Usar esta imagen* — approval is the whole point.
 */
import { useConvexMutate } from "@/global/hooks";
import { MenusKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const SCARCE_THRESHOLD = 20;

const FAILURE_KEYS: Record<string, string> = {
	credits_exhausted: "errors.AI_IMAGE_CREDITS_EXHAUSTED",
};

export function AIImageGenerationPanel({ itemId }: Readonly<{ readonly itemId: Id<"menuItems"> }>) {
	const { t } = useTranslation();
	const { data: view } = useQuery(
		convexQuery(api.menuAIImageGen.getItemGeneration, { menuItemId: itemId })
	);
	const start = useConvexMutate(api.menuAIImageGen.startGeneration);
	const approve = useConvexMutate(api.menuAIImageGen.approveDraft);
	const reject = useConvexMutate(api.menuAIImageGen.rejectDraft);
	const [error, setError] = useState<string | null>(null);

	const run = async (fn: () => Promise<unknown>) => {
		setError(null);
		try {
			unwrapResult(await fn());
		} catch (err) {
			setError(getErrorMessage(err, t, MenusKeys.AI_IMAGE_FAILED));
		}
	};
	const generate = () => run(() => start.mutateAsync({ menuItemId: itemId }));

	if (!view) return null;
	const busy = start.isPending || approve.isPending || reject.isPending;
	const switchedOff = view.monthlyLimit === 0;
	const exhausted = view.remainingThisMonth <= 0;

	const generateButton = (
		<button
			type="button"
			onClick={() => void generate()}
			disabled={busy || exhausted}
			className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs hover:bg-hover border border-border text-muted-foreground disabled:opacity-50"
		>
			<Sparkles size={14} />
			{t(MenusKeys.AI_IMAGE_GENERATE)}
		</button>
	);

	if (view.activeJob && view.activeJob.status !== "failed") {
		return (
			<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
				<Loader2 size={14} className="animate-spin" />
				{t(MenusKeys.AI_IMAGE_GENERATING)} ·{" "}
				{t(MenusKeys.AI_IMAGE_ATTEMPT, { n: view.activeJob.attempt })}
			</span>
		);
	}

	if (view.pendingDraft) {
		const draft = view.pendingDraft;
		return (
			<div className="flex items-center gap-2">
				<img
					src={draft.imageUrl}
					alt={t(MenusKeys.AI_IMAGE_ATTEMPT, { n: draft.attempt })}
					className="w-16 h-12 rounded object-cover"
				/>
				<span className="text-[11px] text-faint-foreground">
					{t(MenusKeys.AI_IMAGE_ATTEMPT, { n: draft.attempt })}
				</span>
				<button
					type="button"
					onClick={() => void run(() => approve.mutateAsync({ draftId: draft.draftId }))}
					disabled={busy}
					className="px-2 py-1 rounded text-xs font-medium hover-btn-primary disabled:opacity-50"
				>
					{t(MenusKeys.AI_IMAGE_USE)}
				</button>
				<button
					type="button"
					onClick={() => void generate()}
					disabled={busy || exhausted}
					className="px-2 py-1 rounded text-xs hover-btn-secondary disabled:opacity-50"
				>
					{t(MenusKeys.AI_IMAGE_REGENERATE)}
				</button>
				<button
					type="button"
					onClick={() => void run(() => reject.mutateAsync({ draftId: draft.draftId }))}
					disabled={busy}
					className="px-2 py-1 rounded text-xs text-destructive hover:bg-hover disabled:opacity-50"
				>
					{t(MenusKeys.AI_IMAGE_DISCARD)}
				</button>
				{error ? <span className="text-xs text-destructive">{error}</span> : null}
			</div>
		);
	}

	const failure = view.activeJob?.status === "failed" ? view.activeJob.error : null;
	return (
		<div className="flex flex-wrap items-center gap-2">
			{generateButton}
			{switchedOff ? (
				<span className="text-xs text-faint-foreground">{t(MenusKeys.AI_IMAGE_LIMIT_OFF)}</span>
			) : view.remainingThisMonth < SCARCE_THRESHOLD ? (
				<span className="text-xs text-faint-foreground">
					{t(MenusKeys.AI_IMAGE_REMAINING, { count: view.remainingThisMonth })}
				</span>
			) : null}
			{failure ? (
				<span className="text-xs text-destructive">
					{t(FAILURE_KEYS[failure] ?? MenusKeys.AI_IMAGE_FAILED)}
				</span>
			) : null}
			{error ? <span className="text-xs text-destructive">{error}</span> : null}
		</div>
	);
}
