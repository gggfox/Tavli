import { RestaurantsKeys } from "@/global/i18n";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ResetStripeControlProps {
	confirmingReset: boolean;
	resetLoading: boolean;
	onRequestReset: () => void;
	onCancelReset: () => void;
	onConfirmReset: () => void;
}

/**
 * Two-step confirmation control for disconnecting the restaurant from its
 * Stripe account. Collapsed state renders a small danger-tinted button; the
 * expanded state renders a warning with explicit Confirm/Cancel actions.
 */
export function ResetStripeControl({
	confirmingReset,
	resetLoading,
	onRequestReset,
	onCancelReset,
	onConfirmReset,
}: Readonly<ResetStripeControlProps>) {
	const { t } = useTranslation();
	if (!confirmingReset) {
		return (
			<button
				type="button"
				onClick={onRequestReset}
				disabled={resetLoading}
				className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-(--bg-hover) disabled:opacity-50 border border-border text-destructive"
				
				data-testid="stripe-reset-button"
			>
				<Trash2 size={12} />
				{t(RestaurantsKeys.STRIPE_RESET_BUTTON)}
			</button>
		);
	}

	return (
		<div
			className="flex flex-col gap-2 w-full p-3 rounded-lg"
			style={{backgroundColor: "rgba(220, 38, 38, 0.08)",
				border: "1px solid rgba(220, 38, 38, 0.3)"}}
			data-testid="stripe-reset-confirm"
		>
			<div className="flex items-start gap-2 text-xs text-foreground" >
				<AlertTriangle
					size={14}
					className="mt-0.5 shrink-0 text-destructive"
					
				/>
				<span>{t(RestaurantsKeys.STRIPE_RESET_WARNING)}</span>
			</div>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onConfirmReset}
					disabled={resetLoading}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 bg-destructive"
					style={{color: "#fff"}}
					data-testid="stripe-reset-confirm-button"
				>
					{resetLoading ? (
						<>
							<Loader2 size={12} className="animate-spin" />
							{t(RestaurantsKeys.STRIPE_RESET_RESETTING)}
						</>
					) : (
						<>
							<Trash2 size={12} />
							{t(RestaurantsKeys.STRIPE_RESET_CONFIRM)}
						</>
					)}
				</button>
				<button
					type="button"
					onClick={onCancelReset}
					disabled={resetLoading}
					className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-(--bg-hover) disabled:opacity-50 text-muted-foreground border border-border"
					
				>
					{t(RestaurantsKeys.STRIPE_RESET_CANCEL)}
				</button>
			</div>
		</div>
	);
}
