export function InsufficientPermissionsState() {
	return (
		<div className="flex items-center justify-center p-8">
			<div className="text-center">
				<div
					className="w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center"
					style={{backgroundColor: "rgba(239, 68, 68, 0.15)"}}
				>
					<svg
						className="w-8 h-8"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						style={{color: "rgb(239, 68, 68)"}}
						aria-hidden="true"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
				</div>
				<h3 className="text-lg font-medium mb-1 text-foreground" >
					Access Restricted
				</h3>
				<p className="text-muted-foreground" >
					You need the appropriate role to access this section.
				</p>
			</div>
		</div>
	);
}
