import { formatCents } from "@/global/utils/money";
import { convexQuery, useConvexAction } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { AlertCircle, Loader2, Package, Plus, Store } from "lucide-react";
import { useState } from "react";

/**
 * Admin component for managing platform-level Stripe products.
 *
 * Products are created on the platform's Stripe account (not on the connected
 * account) and mapped to a restaurant. When a customer purchases a product
 * via the storefront, a destination charge transfers funds to the restaurant's
 * connected account minus the platform's application fee.
 *
 * This component provides:
 * - A form to create new products linked to a restaurant
 * - A list of all existing products grouped by restaurant
 */
export function ProductManager() {
	const [showForm, setShowForm] = useState(false);

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<p className="text-sm text-muted-foreground" >
						Create and manage products that customers can purchase from the storefront.
					</p>
				</div>
				<button
					onClick={() => setShowForm(!showForm)}
					className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
				>
					<Plus size={16} />
					{showForm ? "Cancel" : "New Product"}
				</button>
			</div>

			{showForm && <CreateProductForm onSuccess={() => setShowForm(false)} />}

			<ProductList />
		</div>
	);
}

/**
 * Form to create a new Stripe product linked to a restaurant.
 * The restaurant must have completed Stripe onboarding to be selectable.
 */
function CreateProductForm({ onSuccess }: Readonly<{ onSuccess: () => void }>) {
	const createProduct = useConvexAction(api.stripe.createProduct);

	// Fetch restaurants that have completed Stripe onboarding
	const { data: restaurantsResult } = useQuery(convexQuery(api.restaurants.getAll, {}));
	const restaurants = restaurantsResult?.[0] ?? [];
	const onboardedRestaurants = restaurants.filter(
		(r) => r.stripeAccountId && r.stripeOnboardingComplete
	);

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [price, setPrice] = useState("");
	const [currency, setCurrency] = useState("usd");
	const [restaurantId, setRestaurantId] = useState<string>("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!restaurantId || !name || !price) return;

		setLoading(true);
		setError(null);

		try {
			const priceInCents = Math.round(Number.parseFloat(price) * 100);
			if (Number.isNaN(priceInCents) || priceInCents <= 0) {
				setError("Price must be a positive number");
				setLoading(false);
				return;
			}

			await createProduct({
				restaurantId: restaurantId as Id<"restaurants">,
				name,
				description: description || undefined,
				priceInCents,
				currency,
			});

			setName("");
			setDescription("");
			setPrice("");
			onSuccess();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create product");
		} finally {
			setLoading(false);
		}
	};

	return (
		<form
			onSubmit={handleSubmit}
			className="rounded-xl p-6 space-y-4 bg-muted border border-border"
			
		>
			<h3 className="text-sm font-semibold text-foreground" >
				Create New Product
			</h3>

			{error && (
				<div
					className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-destructive"
					style={{backgroundColor: "rgba(220, 38, 38, 0.1)"}}
				>
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			{/* Restaurant selector */}
			<div className="space-y-1.5">
				<label
					htmlFor="product-restaurant"
					className="text-xs font-medium text-muted-foreground"
					
				>
					Restaurant (Connected Account)
				</label>
				<select
					id="product-restaurant"
					value={restaurantId}
					onChange={(e) => setRestaurantId(e.target.value)}
					required
					className="w-full px-3 py-2 rounded-lg text-sm bg-background text-foreground border border-border"
					
				>
					<option value="">Select a restaurant...</option>
					{onboardedRestaurants.map((r) => (
						<option key={r._id} value={r._id}>
							{r.name}
						</option>
					))}
				</select>
				{onboardedRestaurants.length === 0 && (
					<p className="text-xs text-faint-foreground" >
						No restaurants have completed Stripe onboarding yet.
					</p>
				)}
			</div>

			{/* Product name */}
			<div className="space-y-1.5">
				<label
					htmlFor="product-name"
					className="text-xs font-medium text-muted-foreground"
					
				>
					Product Name
				</label>
				<input
					id="product-name"
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					required
					placeholder="e.g. Margherita Pizza"
					className="w-full px-3 py-2 rounded-lg text-sm bg-background text-foreground border border-border"
					
				/>
			</div>

			{/* Description */}
			<div className="space-y-1.5">
				<label
					htmlFor="product-description"
					className="text-xs font-medium text-muted-foreground"
					
				>
					Description (optional)
				</label>
				<textarea
					id="product-description"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder="A short description of the product"
					rows={2}
					className="w-full px-3 py-2 rounded-lg text-sm resize-none bg-background text-foreground border border-border"
					
				/>
			</div>

			{/* Price and currency */}
			<div className="flex gap-3">
				<div className="flex-1 space-y-1.5">
					<label
						htmlFor="product-price"
						className="text-xs font-medium text-muted-foreground"
						
					>
						Price
					</label>
					<input
						id="product-price"
						type="number"
						value={price}
						onChange={(e) => setPrice(e.target.value)}
						required
						min="0.01"
						step="0.01"
						placeholder="12.99"
						className="w-full px-3 py-2 rounded-lg text-sm bg-background text-foreground border border-border"
						
					/>
				</div>
				<div className="w-28 space-y-1.5">
					<label
						htmlFor="product-currency"
						className="text-xs font-medium text-muted-foreground"
						
					>
						Currency
					</label>
					<select
						id="product-currency"
						value={currency}
						onChange={(e) => setCurrency(e.target.value)}
						className="w-full px-3 py-2 rounded-lg text-sm bg-background text-foreground border border-border"
						
					>
						<option value="usd">USD</option>
						<option value="eur">EUR</option>
						<option value="mxn">MXN</option>
					</select>
				</div>
			</div>

			<button
				type="submit"
				disabled={loading || !restaurantId || !name || !price}
				className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary disabled:opacity-50"
			>
				{loading ? (
					<>
						<Loader2 size={14} className="animate-spin" />
						Creating...
					</>
				) : (
					<>
						<Package size={14} />
						Create Product
					</>
				)}
			</button>
		</form>
	);
}

/**
 * Displays all products grouped by their restaurant.
 */
function ProductList() {
	const { data: products, isLoading } = useQuery(
		convexQuery(api.stripeHelpers.listAllProducts, {})
	);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-8">
				<Loader2 size={20} className="animate-spin text-faint-foreground"  />
			</div>
		);
	}

	if (!products || products.length === 0) {
		return (
			<div
				className="rounded-xl p-8 text-center bg-muted border border-border"
				
			>
				<Package size={32} className="mx-auto mb-3 text-faint-foreground"  />
				<p className="text-sm font-medium text-foreground" >
					No products yet
				</p>
				<p className="text-xs mt-1 text-faint-foreground" >
					Create your first product to start selling on the storefront.
				</p>
			</div>
		);
	}

	// Group products by restaurant
	const grouped = products.reduce<
		Record<string, { restaurantName: string; items: typeof products }>
	>((acc, product) => {
		const key = product.restaurantId;
		if (!acc[key]) {
			acc[key] = { restaurantName: product.restaurantName, items: [] };
		}
		acc[key].items.push(product);
		return acc;
	}, {});

	return (
		<div className="space-y-6">
			{Object.entries(grouped).map(([restaurantId, group]) => (
				<div key={restaurantId} className="space-y-3">
					<div className="flex items-center gap-2 text-faint-foreground">
						<Store size={16}  />
						<h3 className="text-sm font-semibold text-foreground" >
							{group.restaurantName}
						</h3>
						<span
							className="text-xs px-2 py-0.5 rounded-full text-faint-foreground"
							style={{backgroundColor: "var(--bg-tertiary))"}}
						>
							{group.items.length} {group.items.length === 1 ? "product" : "products"}
						</span>
					</div>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{group.items.map((product) => (
							<div
								key={product._id}
								className="rounded-xl p-4 space-y-2 bg-muted border border-border"
								
							>
								<h4 className="text-sm font-medium text-foreground" >
									{product.name}
								</h4>
								{product.description && (
									<p className="text-xs text-faint-foreground" >
										{product.description}
									</p>
								)}
								<p className="text-sm font-semibold text-accent" >
									${formatCents(product.priceInCents)}{" "}
									<span
										className="text-xs font-normal uppercase text-faint-foreground"
										
									>
										{product.currency}
									</span>
								</p>
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
