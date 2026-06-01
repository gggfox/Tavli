import { useEffect, useState } from "react";

const TICK_MS = 60_000;

/** Live clock for timeline markers; refreshes every minute. */
export function useTimelineNow(enabled = true): number {
	const [nowMs, setNowMs] = useState(() => Date.now());

	useEffect(() => {
		if (!enabled) return;

		setNowMs(Date.now());
		const id = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
		return () => window.clearInterval(id);
	}, [enabled]);

	return nowMs;
}
