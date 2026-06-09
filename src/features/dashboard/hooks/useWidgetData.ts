/**
 * Bridges a widget's Convex query to a dev-only sample-data fallback (TAVLI-2).
 *
 * In production this is a pass-through. In development, when the real query is
 * empty/absent or erroring and a sample exists for `sampleKey`, it returns that
 * sample with `isSample: true` so the dashboard demos well against an empty (or
 * not-yet-connected) Convex deployment. Widgets must render a `SampleDataBadge`
 * whenever `isSample` is true — the sample must never look like real data.
 */
import { config } from "@/global/utils/config";
import { getSampleData } from "../mock/sampleData";

interface QueryLike<T> {
	data: T | undefined;
	isPending: boolean;
	error: unknown;
}

export interface WidgetData<T> {
	data: T | undefined;
	isSample: boolean;
	isPending: boolean;
	error: unknown;
}

export function useWidgetData<T>(
	sampleKey: string,
	query: QueryLike<T>,
	isEmpty: (data: T) => boolean
): WidgetData<T> {
	const sample = config.isDev ? (getSampleData(sampleKey) as T | undefined) : undefined;
	const realIsEmpty = query.data === undefined || isEmpty(query.data);
	const useSample =
		sample !== undefined && (query.error != null || (!query.isPending && realIsEmpty));

	if (useSample) {
		return { data: sample, isSample: true, isPending: false, error: null };
	}
	return {
		data: query.data,
		isSample: false,
		isPending: query.isPending,
		error: query.error,
	};
}
