import { useCallback, useRef, type TouchEvent } from "react";

const MOVE_THRESHOLD_PX = 10;
const DEFAULT_DELAY_MS = 500;

export interface UseLongPressOptions {
	onLongPress: () => void;
	onCancel?: () => void;
	delay?: number;
	disabled?: boolean;
}

export interface UseLongPressHandlers {
	onTouchStart: (event: TouchEvent) => void;
	onTouchEnd: () => void;
	onTouchMove: (event: TouchEvent) => void;
	onTouchCancel: () => void;
	onContextMenu: (event: { preventDefault: () => void }) => void;
}

/**
 * Fires `onLongPress` after the finger stays down for `delay` ms.
 * Cancels on release, touch cancel, or movement beyond ~10px (scroll guard).
 */
export function useLongPress({
	onLongPress,
	onCancel,
	delay = DEFAULT_DELAY_MS,
	disabled = false,
}: UseLongPressOptions): UseLongPressHandlers {
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const startPosRef = useRef<{ x: number; y: number } | null>(null);
	const longPressFiredRef = useRef(false);

	const clearTimer = useCallback(() => {
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	const resetTouch = useCallback(() => {
		clearTimer();
		startPosRef.current = null;
		longPressFiredRef.current = false;
	}, [clearTimer]);

	const onTouchStart = useCallback(
		(event: TouchEvent) => {
			if (disabled) return;
			const touch = event.touches[0];
			if (!touch) return;
			startPosRef.current = { x: touch.clientX, y: touch.clientY };
			longPressFiredRef.current = false;
			clearTimer();
			timerRef.current = setTimeout(() => {
				longPressFiredRef.current = true;
				onLongPress();
			}, delay);
		},
		[disabled, delay, onLongPress, clearTimer]
	);

	const onTouchEnd = useCallback(() => {
		const didLongPress = longPressFiredRef.current;
		resetTouch();
		if (didLongPress) {
			onCancel?.();
		}
	}, [resetTouch, onCancel]);

	const onTouchMove = useCallback(
		(event: TouchEvent) => {
			if (!startPosRef.current) return;
			const touch = event.touches[0];
			if (!touch) return;
			const dx = touch.clientX - startPosRef.current.x;
			const dy = touch.clientY - startPosRef.current.y;
			if (Math.hypot(dx, dy) <= MOVE_THRESHOLD_PX) return;

			const didLongPress = longPressFiredRef.current;
			resetTouch();
			if (didLongPress) {
				onCancel?.();
			}
		},
		[resetTouch, onCancel]
	);

	const onContextMenu = useCallback((event: { preventDefault: () => void }) => {
		if (longPressFiredRef.current) {
			event.preventDefault();
		}
	}, []);

	return {
		onTouchStart,
		onTouchEnd,
		onTouchMove,
		onTouchCancel: onTouchEnd,
		onContextMenu,
	};
}
