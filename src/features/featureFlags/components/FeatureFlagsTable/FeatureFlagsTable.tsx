import { CopyableId, EmptyState } from "@/global/components";
import { formatDate, getDisplayTimestamp } from "@/global/utils/date";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { FEATURE_FLAG_METADATA, FEATURE_FLAGS } from "convex/featureFlags";
import { Flag } from "lucide-react";
import { useMemo, useState } from "react";

type FeatureFlagDoc = {
	_id: string;
	_creationTime: number;
	key: string;
	enabled: boolean;
	numericValue?: number;
	description?: string;
	createdAt: number;
	updatedAt: number;
	updatedBy?: string;
};

type FlagRow = {
	key: string;
	description: string;
	enabled: boolean;
	numericValue: number | undefined;
	updatedAt: number | undefined;
	creationTime: number | undefined;
	updatedBy: string | undefined;
};

export function FeatureFlagsTable() {
	const registeredKeys = useMemo(() => Object.values(FEATURE_FLAGS) as string[], []);

	const { data, isLoading, isError, error, refetch } = useQuery(
		convexQuery(api.featureFlags.getAllFeatureFlags, {})
	);

	const setFeatureFlag = useMutation({
		mutationFn: useConvexMutation(api.featureFlags.setFeatureFlag),
	});

	const [pendingKey, setPendingKey] = useState<string | null>(null);

	if (registeredKeys.length === 0) {
		return (
			<EmptyState
				icon={Flag}
				title="No feature flags registered"
				description="Add a key to FEATURE_FLAGS in convex/featureFlags.ts (and a matching entry in FEATURE_FLAG_METADATA) to manage it here."
				fill
			/>
		);
	}

	if (isLoading) {
		return (
			<EmptyState
				icon={Flag}
				title="Loading feature flags…"
				variant="card"
			/>
		);
	}

	if (isError) {
		return (
			<EmptyState
				icon={Flag}
				title="Couldn't load feature flags"
				description={error instanceof Error ? error.message : "Unknown error"}
				action={
					<button
						type="button"
						onClick={() => refetch()}
						className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground"
					>
						Retry
					</button>
				}
			/>
		);
	}

	const rowsByKey = new Map<string, FeatureFlagDoc>();
	for (const row of (data ?? []) as FeatureFlagDoc[]) {
		rowsByKey.set(row.key, row);
	}

	const metadataByKey = FEATURE_FLAG_METADATA as Record<string, { description: string } | undefined>;

	const rows: FlagRow[] = registeredKeys.map((key) => {
		const dbRow = rowsByKey.get(key);
		const metadata = metadataByKey[key];
		return {
			key,
			description: metadata?.description ?? "",
			enabled: dbRow?.enabled ?? false,
			numericValue: dbRow?.numericValue,
			updatedAt: dbRow?.updatedAt,
			creationTime: dbRow?._creationTime,
			updatedBy: dbRow?.updatedBy,
		};
	});

	const handleToggle = async (row: FlagRow) => {
		setPendingKey(row.key);
		try {
			await setFeatureFlag.mutateAsync({
				key: row.key,
				enabled: !row.enabled,
			});
		} finally {
			setPendingKey(null);
		}
	};

	const handleNumericChange = async (row: FlagRow, raw: string) => {
		const trimmed = raw.trim();
		const parsed = trimmed === "" ? undefined : Number(trimmed);
		if (parsed !== undefined && (Number.isNaN(parsed) || parsed < 0)) return;
		setPendingKey(row.key);
		try {
			await setFeatureFlag.mutateAsync({
				key: row.key,
				enabled: row.enabled,
				numericValue: parsed,
			});
		} finally {
			setPendingKey(null);
		}
	};

	return (
		<div className="rounded-lg bg-muted border border-border overflow-auto">
			<table className="w-full border-collapse">
				<thead>
					<tr>
						<th className="px-4 py-3 text-left text-sm font-medium sticky top-0 bg-muted text-muted-foreground border-b border-border">
							Key
						</th>
						<th className="px-4 py-3 text-left text-sm font-medium sticky top-0 bg-muted text-muted-foreground border-b border-border">
							Description
						</th>
						<th className="px-4 py-3 text-left text-sm font-medium sticky top-0 bg-muted text-muted-foreground border-b border-border">
							Last updated
						</th>
						<th className="px-4 py-3 text-left text-sm font-medium sticky top-0 bg-muted text-muted-foreground border-b border-border">
							Updated by
						</th>
						<th className="px-4 py-3 text-left text-sm font-medium sticky top-0 bg-muted text-muted-foreground border-b border-border">
							Numeric value
						</th>
						<th className="px-4 py-3 text-right text-sm font-medium sticky top-0 bg-muted text-muted-foreground border-b border-border">
							Status
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => {
						const isPending = pendingKey === row.key;
						const displayTimestamp = getDisplayTimestamp(row.updatedAt, row.creationTime);
						return (
							<tr key={row.key} className="border-b border-border">
								<td className="px-4 py-3 align-top">
									<span className="font-mono text-sm text-foreground">{row.key}</span>
								</td>
								<td className="px-4 py-3 align-top">
									{row.description ? (
										<span className="text-sm text-muted-foreground">{row.description}</span>
									) : (
										<span className="text-faint-foreground">—</span>
									)}
								</td>
								<td className="px-4 py-3 align-top">
									<span className="text-sm text-muted-foreground">
										{displayTimestamp ? formatDate(displayTimestamp) : "—"}
									</span>
								</td>
								<td className="px-4 py-3 align-top">
									{row.updatedBy ? (
										<CopyableId id={row.updatedBy} />
									) : (
										<span className="text-faint-foreground">—</span>
									)}
								</td>
								<td className="px-4 py-3 align-top">
									<input
										type="number"
										min={0}
										step={1}
										defaultValue={row.numericValue ?? ""}
										disabled={isPending}
										onBlur={(e) => {
											const raw = e.target.value;
											const next =
												raw.trim() === "" ? undefined : Number(raw);
											if (next === row.numericValue) return;
											void handleNumericChange(row, raw);
										}}
										className="w-24 px-2 py-1 rounded-md border border-border bg-background text-sm text-foreground"
										aria-label={`Numeric value for ${row.key}`}
										placeholder="—"
									/>
								</td>
								<td className="px-4 py-3 align-top text-right">
									<button
										type="button"
										role="switch"
										aria-checked={row.enabled}
										aria-label={`${row.enabled ? "Disable" : "Enable"} ${row.key}`}
										disabled={isPending}
										onClick={() => handleToggle(row)}
										className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
											row.enabled ? "bg-primary" : "bg-hover"
										} ${isPending ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
									>
										<span
											className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
												row.enabled ? "translate-x-6" : "translate-x-1"
											}`}
										/>
									</button>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
