import { isValidTimestamp } from "@/global";

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
