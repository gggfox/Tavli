import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, ShoppingBag } from "lucide-react";

export const Route = createFileRoute("/success")({
	validateSearch: (search: Record<string, unknown>) => ({
		session_id: (search.session_id as string) ?? "",
	}),
	component: SuccessPage,
});

/**
 * Post-checkout success page. Shown after a customer completes payment
 * on Stripe's hosted checkout. The `session_id` search param is provided
 * by Stripe's {CHECKOUT_SESSION_ID} template in the success URL.
 */
function SuccessPage() {
	const { session_id } = Route.useSearch();

	return (
		<div className="max-w-md mx-auto px-4 py-16 text-center space-y-6">
			<div
				className="mx-auto w-16 h-16 rounded-full flex items-center justify-center"
				style={{ backgroundColor: "var(--accent-success, #22c55e)", opacity: 0.9 }}
			>
				<CheckCircle2 size={32} color="white" />
			</div>

			<div className="space-y-2">
				<h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
					Payment Successful!
				</h1>
				<p className="text-sm" style={{ color: "var(--text-muted)" }}>
					Thank you for your purchase. Your payment has been processed successfully.
				</p>
			</div>

			{session_id && (
				<div
					className="rounded-xl p-4 text-left"
					style={{
						backgroundColor: "var(--bg-secondary)",
						border: "1px solid var(--border-default)",
					}}
				>
					<p className="text-xs" style={{ color: "var(--text-muted)" }}>
						Session ID
					</p>
					<p
						className="text-xs font-mono mt-1 break-all"
						style={{ color: "var(--text-secondary)" }}
					>
						{session_id}
					</p>
				</div>
			)}

			<Link
				to="/storefront"
				className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium hover-btn-primary"
			>
				<ShoppingBag size={16} />
				Back to Storefront
			</Link>
		</div>
	);
}
