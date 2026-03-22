import { AddMaterialsToAuction, LiveAuctionsTable } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/live-auctions")({
	component: LiveAuctions,
});

function LiveAuctions() {
	return (
		<div
			className="h-full flex flex-col overflow-hidden"
			style={{ backgroundColor: "var(--bg-primary)" }}
		>
			<div className="p-6 flex flex-col h-full">
				<div className="mb-6 flex items-start justify-between">
					<div>
						<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
							Live Auctions
						</h1>
						<p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
							View and manage all materials in currently active auctions.
						</p>
					</div>
					<AddMaterialsToAuction />
				</div>
				<div className="flex-1 overflow-hidden">
					<LiveAuctionsTable />
				</div>
			</div>
		</div>
	);
}
