export function AuthLoadingState() {
	return (
		<div className="flex items-center justify-center p-8">
			<div className="text-center">
				<div
					className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3"
					style={{ borderColor: "var(--accent-primary)", borderTopColor: "transparent" }}
				/>
				<p style={{ color: "var(--text-secondary)" }}>Verifying authentication...</p>
			</div>
		</div>
	);
}



