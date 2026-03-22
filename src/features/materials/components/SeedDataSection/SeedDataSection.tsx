/**
 * SeedDataSection - Admin component for seeding reference data
 *
 * Allows admins to populate categories, forms, finishes, and choices
 * using the seed mutation. The mutation is idempotent - it only inserts
 * data that doesn't already exist.
 */
import { api } from "convex/_generated/api";
import { useMutation } from "convex/react";
import { AlertCircle, Database, Loader2 } from "lucide-react";
import { useState } from "react";
import { ClearDataButton } from "./ClearDataButton.tsx";
import { ClearResultsDisplay } from "./ClearResultsDisplay.tsx";
import { ResultsDisplay } from "./ResultsDisplay.tsx";
import type { ClearResults, SeedResults } from "./types.ts";

export function SeedDataSection() {
	const seedMutation = useMutation(api._seed.referenceData.seedReferenceData);
	const clearMutation = useMutation(api._seed.referenceData.clearReferenceData);

	const [isSeeding, setIsSeeding] = useState(false);
	const [isClearing, setIsClearing] = useState(false);
	const [seedResults, setSeedResults] = useState<SeedResults | null>(null);
	const [clearResults, setClearResults] = useState<ClearResults | null>(null);
	const [error, setError] = useState<string | null>(null);

	const handleSeed = async () => {
		setIsSeeding(true);
		setError(null);
		setSeedResults(null);
		setClearResults(null);

		try {
			const results = await seedMutation();
			setSeedResults(results);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to seed reference data");
		} finally {
			setIsSeeding(false);
		}
	};

	const handleClear = async () => {
		setIsClearing(true);
		setError(null);
		setSeedResults(null);
		setClearResults(null);

		try {
			const results = await clearMutation();
			setClearResults(results);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to clear reference data");
		} finally {
			setIsClearing(false);
		}
	};

	return (
		<div>
			<h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
				Seed Reference Data
			</h3>

			<div
				className="p-4 rounded-lg border"
				style={{
					backgroundColor: "var(--bg-secondary)",
					borderColor: "var(--border-default)",
				}}
			>
				<p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
					Populate the database with reference data including categories, forms, finishes, and
					choices. This operation is idempotent—existing data will not be duplicated.
				</p>

				<div className="flex items-center gap-3">
					<button
						onClick={handleSeed}
						disabled={isSeeding || isClearing}
						className="flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
						style={{
							backgroundColor: "rgb(34, 197, 94)",
							color: "white",
						}}
					>
						{isSeeding ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
						<span>{isSeeding ? "Seeding..." : "Seed Data"}</span>
					</button>

					<ClearDataButton
						onClear={handleClear}
						isClearing={isClearing}
						disabled={isSeeding || isClearing}
					/>
				</div>

				{error && (
					<div
						className="mt-4 p-3 rounded-md flex items-center gap-2"
						style={{
							backgroundColor: "rgba(239, 68, 68, 0.1)",
							color: "rgb(239, 68, 68)",
						}}
					>
						<AlertCircle size={16} />
						<span className="text-sm">{error}</span>
					</div>
				)}

				{seedResults && <ResultsDisplay results={seedResults} />}
				{clearResults && <ClearResultsDisplay results={clearResults} />}
			</div>
		</div>
	);
}
