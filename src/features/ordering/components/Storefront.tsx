import { formatCents } from "@/global/utils/money";
import { convexQuery, useConvexAction } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Loader2, ShoppingBag, Store } from "lucide-react";
import { useState } from "react";

/**
 * Public storefront that displays all products across all connected accounts
 * (restaurants). Customers can browse products and click "Buy Now" to be
 * redirected to Stripe's hosted checkout page.
 *
 * This uses destination charges: the payment is processed on the platform,
 * and funds (minus the application fee) are automatically transferred to
 * the connected account.
 */
export function Storefront() {
	const { data: products, isLoading } = useQuery(
		convexQuery(api.stripeHelpers.listAllProducts, {})
	);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-16">
				<Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
			</div>
		);
	}

	if (!products || products.length === 0) {
		return (
			<div className="max-w-2xl mx-auto px-4 py-16 text-center">
				<ShoppingBag size={48} className="mx-auto mb-4" style={{ color: "var(--text-muted)" }} />
				<h2 className="text-xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
					No products available
				</h2>
				<p className="text-sm" style={{ color: "var(--text-muted)" }}>
					Check back soon — new products are being added.
				</p>
			</div>
		);
	}

	// Group products by restaurant for a clean storefront layout
	const grouped = products.reduce<
		Record<string, { restaurantName: string; restaurantSlug: string; items: typeof products }>
	>((acc, product) => {
		const key = product.restaurantId;
		if (!acc[key]) {
			acc[key] = {
				restaurantName: product.restaurantName,
				restaurantSlug: product.restaurantSlug,
				items: [],
			};
		}
		acc[key].items.push(product);
		return acc;
	}, {});

	return (
		<div className="max-w-5xl mx-auto px-4 py-8 space-y-10">
			{/* Storefront header */}
			<div className="text-center space-y-2">
				<h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
					Storefront
				</h1>
				<p className="text-sm" style={{ color: "var(--text-muted)" }}>
					Browse products from our restaurants and make a purchase.
				</p>
			</div>

			{/* Products grouped by restaurant */}
			{Object.entries(grouped).map(([restaurantId, group]) => (
				<section key={restaurantId} className="space-y-4">
					<div className="flex items-center gap-2">
						<Store size={20} style={{ color: "var(--accent-primary)" }} />
						<h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
							{group.restaurantName}
						</h2>
					</div>
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{group.items.map((product) => (
							<ProductCard key={product._id} product={product} />
						))}
					</div>
				</section>
			))}
		</div>
	);
}

/**
 * Individual product card with name, description, price, and a "Buy Now"
 * button that creates a Stripe Checkout Session and redirects the customer.
 */
function ProductCard({
	product,
}: Readonly<{
	product: {
		_id: Id<"products">;
		name: string;
		description?: string;
		priceInCents: number;
		currency: string;
		restaurantName: string;
	};
}>) {
	const createCheckout = useConvexAction(api.stripe.createCheckoutSession);
	const [loading, setLoading] = useState(false);

	const handleBuy = async () => {
		setLoading(true);
		try {
			const result = await createCheckout({
				productId: product._id,
				quantity: 1,
				successUrl: `${globalThis.location.origin}/success`,
				cancelUrl: `${globalThis.location.origin}/storefront`,
			});

			// Redirect to Stripe's hosted checkout page
			if (result.url) {
				globalThis.location.href = result.url;
			}
		} catch (err) {
			console.error("Checkout error:", err);
			setLoading(false);
		}
	};

	return (
		<div
			className="rounded-xl p-5 flex flex-col justify-between"
			style={{
				backgroundColor: "var(--bg-secondary)",
				border: "1px solid var(--border-default)",
			}}
		>
			<div className="space-y-2 mb-4">
				<h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
					{product.name}
				</h3>
				{product.description && (
					<p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
						{product.description}
					</p>
				)}
			</div>

			<div className="flex items-center justify-between">
				<span className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
					${formatCents(product.priceInCents)}
					<span
						className="text-xs font-normal uppercase ml-1"
						style={{ color: "var(--text-muted)" }}
					>
						{product.currency}
					</span>
				</span>

				<button
					onClick={handleBuy}
					disabled={loading}
					className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary disabled:opacity-50"
				>
					{loading ? (
						<>
							<Loader2 size={14} className="animate-spin" />
							Loading...
						</>
					) : (
						<>
							<ShoppingBag size={14} />
							Buy Now
						</>
					)}
				</button>
			</div>
		</div>
	);
}
