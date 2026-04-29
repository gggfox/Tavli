import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Phase machine for animated `<dialog>` elements.
 *
 *   closed     -> nothing rendered
 *   preparing  -> dialog mounted at off-screen position; `showModal()` called
 *   open       -> data-state flipped to "open"; CSS transition fires
 *   closing    -> data-state flipped to "closing"; CSS transition fires
 *   closed     -> `dialog.close()` called once the closing transition ends
 *
 * The double-RAF wait between `preparing` and `open` lets the browser commit
 * the off-screen state before transitioning to the on-screen state. Without
 * it, the transition would not fire because the initial state was never
 * rendered.
 *
 * Native `<dialog>`'s top-layer rendering means no portal is needed: the
 * dialog escapes any ancestor `overflow` or `z-index` containers
 * automatically.
 */
export type DialogPhase = "closed" | "preparing" | "open" | "closing";

export interface UseDialogPhaseOptions {
	readonly isOpen: boolean;
	readonly durationMs?: number;
}

export interface UseDialogPhaseReturn {
	readonly phase: DialogPhase;
	readonly dialogRef: RefObject<HTMLDialogElement | null>;
}

const DEFAULT_DURATION_MS = 250;

export function useDialogPhase({
	isOpen,
	durationMs = DEFAULT_DURATION_MS,
}: UseDialogPhaseOptions): UseDialogPhaseReturn {
	const [phase, setPhase] = useState<DialogPhase>("closed");
	const dialogRef = useRef<HTMLDialogElement | null>(null);

	useEffect(() => {
		if (isOpen) {
			setPhase((current) =>
				current === "open" || current === "preparing" ? current : "preparing"
			);
		} else {
			setPhase((current) =>
				current === "closed" || current === "closing" ? current : "closing"
			);
		}
	}, [isOpen]);

	useEffect(() => {
		if (phase !== "closing") return;
		const timeout = globalThis.window.setTimeout(() => setPhase("closed"), durationMs);
		return () => globalThis.window.clearTimeout(timeout);
	}, [phase, durationMs]);

	useEffect(() => {
		if (phase !== "preparing") return;
		let id2: number | null = null;
		const id1 = requestAnimationFrame(() => {
			id2 = requestAnimationFrame(() => setPhase("open"));
		});
		return () => {
			cancelAnimationFrame(id1);
			if (id2 !== null) cancelAnimationFrame(id2);
		};
	}, [phase]);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (phase === "preparing" || phase === "open") {
			if (!dialog.open) {
				try {
					dialog.showModal();
				} catch {
					// Dialog may already be open in another mode; ignore.
				}
			}
		} else if (phase === "closed") {
			if (dialog.open) {
				dialog.close();
			}
		}
	}, [phase]);

	return { phase, dialogRef };
}
