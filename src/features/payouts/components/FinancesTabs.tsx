import { PayoutsKeys } from "@/global/i18n";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PAYOUTS_ROUTE } from "../constants";

const tabClass =
	"border-b-2 px-1 pb-1 text-sm font-medium transition-colors border-transparent text-muted-foreground hover:text-foreground";
const activeTabClass =
	"border-b-2 px-1 pb-1 text-sm font-medium transition-colors border-foreground text-foreground";

/**
 * The Payments | Payouts switch behind the sidebar's single Finances entry.
 *
 * Links, not a segmented control: each tab is its own route, so both URLs keep
 * working for the notifications and emails that already point at them.
 */
export function FinancesTabs() {
	const { t } = useTranslation();
	return (
		<nav aria-label={t(PayoutsKeys.FINANCES_TABS_ARIA)} className="flex gap-6">
			<Link
				to="/admin/payments"
				className={tabClass}
				activeProps={{ className: activeTabClass, "aria-current": "page" }}
			>
				{t(PayoutsKeys.FINANCES_TABS_PAYMENTS)}
			</Link>
			<Link
				to={PAYOUTS_ROUTE}
				className={tabClass}
				activeProps={{ className: activeTabClass, "aria-current": "page" }}
			>
				{t(PayoutsKeys.FINANCES_TABS_PAYOUTS)}
			</Link>
		</nav>
	);
}
