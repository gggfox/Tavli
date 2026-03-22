import { useEffect, useState } from "react";

export function TimeRemaining({ endDate }: Readonly<{ endDate: number }>) {
	const [tick, setTick] = useState(0);

	// Update every second
	useEffect(() => {
		const interval = setInterval(() => setTick((t) => t + 1), 1000);
		return () => clearInterval(interval);
	}, []);

	// Use tick to force re-render
	void tick;

	const now = Date.now();
	const remaining = endDate - now;

	if (remaining <= 0) {
		return (
			<span className="text-lg font-semibold" style={{ color: "rgb(239, 68, 68)" }}>
				Auction Ended
			</span>
		);
	}

	const hours = Math.floor(remaining / (1000 * 60 * 60));
	const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
	const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

	const isUrgent = remaining < 1000 * 60 * 60; // Less than 1 hour

	return (
		<span
			className="text-lg font-semibold font-mono"
			style={{ color: isUrgent ? "rgb(239, 68, 68)" : "rgb(34, 197, 94)" }}
		>
			{hours.toString().padStart(2, "0")}:{minutes.toString().padStart(2, "0")}:
			{seconds.toString().padStart(2, "0")}
		</span>
	);
}
