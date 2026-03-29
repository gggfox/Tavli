import { MenuEditor } from "@/features/menus";
import { useRestaurant } from "@/features/restaurants";
import { LoadingState } from "@/global/components";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/admin/menus/$menuId")({
	component: MenuEditorPage,
});

function MenuEditorPage() {
	const { menuId } = Route.useParams();
	const { restaurant } = useRestaurant();

	if (!restaurant) {
		return (
			<div className="p-6">
				<LoadingState />
			</div>
		);
	}

	return (
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6">
				<Link
					to="/admin/menus"
					className="flex items-center gap-1 text-sm mb-3 hover:underline"
					style={{ color: "var(--btn-primary-bg)" }}
				>
					<ArrowLeft size={16} /> Back to Menus
				</Link>
				<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
					Menu Editor
				</h1>
				<p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
					Add categories and items to this menu.
				</p>
			</div>
			<div className="flex-1 overflow-y-auto">
				<MenuEditor menuId={menuId as Id<"menus">} restaurantId={restaurant._id} />
			</div>
		</div>
	);
}
