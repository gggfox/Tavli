export function LoadingSkeleton() {
	return (
		<aside
			className="h-full flex flex-col w-60 transition-all duration-300 ease-in-out"
			style={{
				backgroundColor: "var(--bg-secondary)",
				color: "var(--text-secondary)",
				borderRight: "1px solid var(--border-default)",
			}}
		>
			<div
				className="animate-pulse h-12"
				style={{ borderBottom: "1px solid var(--border-default)" }}
			/>
		</aside>
	);
}
