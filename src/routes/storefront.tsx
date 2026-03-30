import { Storefront } from "@/features/ordering/components/Storefront";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/storefront")({
	component: StorefrontPage,
});

function StorefrontPage() {
	return <Storefront />;
}
