export function ErrorState({ error, onRetry }: Readonly<{ error: Error; onRetry?: () => void }>) {
	const isAdminError = error.message.includes("Admin role required");

	return (
		<div
			className="flex flex-col items-center justify-center py-12 rounded-lg"
			style={{ backgroundColor: "rgba(239, 68, 68, 0.1)" }}
		>
			<p className="text-lg font-medium" style={{ color: "rgb(239, 68, 68)" }}>
				Error loading users
			</p>
			<p className="text-sm mt-1 text-center max-w-md" style={{ color: "var(--text-secondary)" }}>
				{error.message}
			</p>
			{isAdminError && (
				<p className="text-xs mt-3 text-center max-w-md" style={{ color: "var(--text-muted)" }}>
					You need admin role to view users. Use the &quot;Assign Admin Role&quot; button above to
					grant yourself admin access.
				</p>
			)}
			{onRetry && (
				<button
					onClick={onRetry}
					className="mt-4 px-4 py-2 rounded-lg text-sm transition-colors"
					style={{
						backgroundColor: "var(--bg-secondary)",
						color: "var(--text-primary)",
						border: "1px solid var(--border-default)",
					}}
				>
					Retry
				</button>
			)}
		</div>
	);
}
