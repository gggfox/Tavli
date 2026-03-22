import { isValidTimestamp } from "@/global/utils/date";

export function formatDateShort(timestamp: number | undefined): string {
	if (!isValidTimestamp(timestamp)) {
		return "—";
	}
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(timestamp));
}

export function formatQuantity(normalizedQuantity: {
	quantity: number;
	unit: string;
	baseUnit: string;
	baseQuantity: number;
}): string {
	return `${normalizedQuantity.quantity} ${normalizedQuantity.unit}`;
}

export function formatCurrency(amount: number): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "MXN",
		minimumFractionDigits: 0,
		maximumFractionDigits: 2,
	}).format(amount);
}
