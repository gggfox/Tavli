import { ProductManager } from "@/features/restaurants/components/ProductManager";
import { AdminPageLayout } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/products")({
	component: AdminProductsPage,
});

function AdminProductsPage() {
	return (
		<AdminPageLayout
			title="Products"
			description="Create and manage Stripe products for the storefront."
		>
			<ProductManager />
		</AdminPageLayout>
	);
}
