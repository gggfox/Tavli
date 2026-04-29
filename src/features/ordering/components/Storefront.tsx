import { formatCents } from "@/global/utils/money";
import { convexQuery, useConvexAction } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Loader2, ShoppingBag, Store } from "lucide-react";
import { useState } from "react";
import { StorefrontSkeleton } from "./StorefrontSkeleton";

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
		return <StorefrontSkeleton />;
	}

	if (!products || products.length === 0) {
		return (
			<div className="max-w-2xl mx-auto px-4 py-16 text-center">
				<ShoppingBag size={48} className="mx-auto mb-4 text-faint-foreground"  />
				<h2 className="text-xl font-bold mb-2 text-foreground" >
					No products available
				</h2>
				<p className="text-sm text-faint-foreground" >
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
				<h1 className="text-2xl font-bold text-foreground" >
					Storefront
				</h1>
				<p className="text-sm text-faint-foreground" >
					Browse products from our restaurants and make a purchase.
				</p>
			</div>

			{/* Products grouped by restaurant */}
			{Object.entries(grouped).map(([restaurantId, group]) => (
				<section key={restaurantId} className="space-y-4">
					<div className="flex items-center gap-2 text-accent">
						<Store size={20}  />
						<h2 className="text-lg font-semibold text-foreground" >
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
			className="rounded-xl p-5 flex flex-col justify-between bg-muted border border-border"
			
		>
			<div className="space-y-2 mb-4">
				<h3 className="text-sm font-semibold text-foreground" >
					{product.name}
				</h3>
				{product.description && (
					<p className="text-xs leading-relaxed text-faint-foreground" >
						{product.description}
					</p>
				)}
			</div>

			<div className="flex items-center justify-between">
				<span className="text-lg font-bold text-foreground" >
					${formatCents(product.priceInCents)}
					<span
						className="text-xs font-normal uppercase ml-1 text-faint-foreground"
						
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
