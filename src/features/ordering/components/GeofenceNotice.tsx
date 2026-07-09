import { OrderingKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { KeyRound, Loader2, MapPinOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GeofenceStatus } from "../hooks/useGeofence";

interface GeofenceNoticeProps {
	slug: string;
	status: GeofenceStatus;
	onRetry: () => void;
	/** Called when a staff bypass code is verified. */
	onBypass: () => void;
}

/**
 * Shown instead of the order/pay controls when the geofence blocks ordering.
 * The menu stays browsable; staff can hand out a bypass code for customers
 * whose location is denied or unavailable (TAVLI-6).
 */
export function GeofenceNotice({ slug, status, onRetry, onBypass }: Readonly<GeofenceNoticeProps>) {
	const { t } = useTranslation();
	const [code, setCode] = useState("");
	const [codeToVerify, setCodeToVerify] = useState<string | null>(null);

	const { data: verified, isFetching } = useQuery(
		convexQuery(
			api.restaurants.verifyGeofenceBypass,
			codeToVerify ? { slug, code: codeToVerify } : "skip"
		)
	);

	useEffect(() => {
		if (verified === true) {
			onBypass();
		}
	}, [verified, onBypass]);

	const showInvalid = codeToVerify !== null && verified === false && !isFetching;

	return (
		<div
			className="rounded-xl p-4 space-y-3 border border-border"
			style={{ backgroundColor: "rgba(217, 119, 6, 0.08)" }}
		>
			<div className="flex items-start gap-3">
				<MapPinOff size={18} className="shrink-0 mt-0.5 text-warning" />
				<div className="space-y-1">
					<p className="text-sm font-semibold text-foreground">
						{t(OrderingKeys.GEOFENCE_BLOCKED_TITLE)}
					</p>
					<p className="text-xs text-muted-foreground">
						{status === "unavailable"
							? t(OrderingKeys.GEOFENCE_LOCATION_UNAVAILABLE)
							: t(OrderingKeys.GEOFENCE_OUTSIDE)}
					</p>
				</div>
			</div>

			<div className="flex items-center gap-2">
				<div className="relative flex-1">
					<KeyRound
						size={14}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-faint-foreground"
					/>
					<input
						type="text"
						value={code}
						onChange={(e) => setCode(e.target.value.toUpperCase())}
						placeholder={t(OrderingKeys.GEOFENCE_CODE_PLACEHOLDER)}
						className="w-full pl-9 pr-3 py-2 rounded-lg text-sm uppercase bg-background border border-border text-foreground"
						aria-label={t(OrderingKeys.GEOFENCE_CODE_PLACEHOLDER)}
					/>
				</div>
				<button
					type="button"
					onClick={() => setCodeToVerify(code.trim() || null)}
					disabled={!code.trim() || isFetching}
					className="px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary disabled:opacity-50"
				>
					{isFetching ? (
						<Loader2 size={14} className="animate-spin" />
					) : (
						t(OrderingKeys.GEOFENCE_CODE_SUBMIT)
					)}
				</button>
			</div>
			{showInvalid && (
				<p className="text-xs text-destructive">{t(OrderingKeys.GEOFENCE_CODE_INVALID)}</p>
			)}

			<button
				type="button"
				onClick={onRetry}
				className="text-xs font-medium underline text-muted-foreground"
			>
				{t(OrderingKeys.GEOFENCE_RETRY)}
			</button>
		</div>
	);
}
