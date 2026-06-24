/**
 * Top-level fallback shown when the dashboard tree throws (TAVLI-2: "in case of
 * an error, redirect the user to an email contact so they can submit a
 * report"). Renders a prefilled `mailto:` to `SUPPORT_EMAIL`.
 */
import { useRestaurant } from "@/features/restaurants";
import { EmptyState } from "@/global/components";
import { DashboardKeys } from "@/global/i18n";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SUPPORT_EMAIL } from "../constants";

export function DashboardErrorFallback() {
	const { t } = useTranslation();
	// Prefer the current restaurant's support email; fall back to the global
	// default (also covers the case where no restaurant is selected).
	const { restaurant } = useRestaurant();
	const supportEmail = restaurant?.supportEmail ?? SUPPORT_EMAIL;
	const subject = encodeURIComponent(t(DashboardKeys.ERROR_BOUNDARY_EMAIL_SUBJECT));
	return (
		<div className="p-6 flex items-center justify-center h-full">
			<EmptyState
				variant="inline"
				icon={AlertTriangle}
				title={t(DashboardKeys.ERROR_BOUNDARY_TITLE)}
				description={t(DashboardKeys.ERROR_BOUNDARY_DESCRIPTION)}
				action={
					<a
						href={`mailto:${supportEmail}?subject=${subject}`}
						className="text-xs px-3 py-1.5 rounded-md bg-(--btn-primary-bg) text-(--btn-primary-text)"
					>
						{t(DashboardKeys.ERROR_BOUNDARY_CONTACT_ACTION)}
					</a>
				}
			/>
		</div>
	);
}
