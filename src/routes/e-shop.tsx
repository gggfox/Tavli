import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/e-shop")({
	component: EShop,
});

function EShop() {
	return (
		<div className="h-full flex flex-col overflow-hidden" style={{ backgroundColor: "var(--bg-primary)" }}>
			<div className="p-6">
				<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
					E-Shop
				</h1>
			</div>
		</div>
	);
}


