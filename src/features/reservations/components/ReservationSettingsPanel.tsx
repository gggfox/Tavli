/**
 * Reservation settings panel for staff.
 *
 * Edits per-restaurant policy: default turn time, per-capacity overrides,
 * booking horizon, no-show grace, blackout windows, and the global
 * "accepting reservations" toggle.
 */
import {
	DateTimeField,
	InfoTooltip,
	InlineError,
	NumberField,
	TextField,
} from "@/global/components";
import { useConvexMutate } from "@/global/hooks";
import { unwrapResult } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

const FIELD_DESCRIPTIONS = {
	accepting:
		"Master switch. When off, customers cannot create new reservations through any channel.",
	defaultTurn:
		"How long, on average, a party occupies a table before it is considered available again.",
	minAdvance:
		"Earliest gap (in minutes) between now and a reservation start time that we still accept.",
	maxAdvance: "How many days into the future customers can book a reservation.",
	noShowGrace:
		"How long after the start time we wait before automatically marking a reservation as no-show.",
	turnRanges:
		"Override the default turn time for specific party-size ranges. First matching range wins.",
	blackouts:
		"Date ranges in which we will not accept any reservations regardless of other settings.",
} as const;

interface ReservationSettingsPanelProps {
	restaurantId: Id<"restaurants">;
}

interface TurnRange {
	minPartySize: number;
	maxPartySize: number;
	turnMinutes: number;
}

interface BlackoutWindow {
	startsAt: number;
	endsAt: number;
	reason?: string;
}

export function ReservationSettingsPanel({
	restaurantId,
}: Readonly<ReservationSettingsPanelProps>) {
	const { data: rawSettings } = useQuery(
		convexQuery(api.reservationSettings.get, { restaurantId })
	);
	const settings = rawSettings ?? null;

	const updateMutation = useConvexMutate(api.reservationSettings.update);

	const [defaultTurnMinutes, setDefaultTurnMinutes] = useState(90);
	const [minAdvanceMinutes, setMinAdvanceMinutes] = useState(30);
	const [maxAdvanceDays, setMaxAdvanceDays] = useState(60);
	const [noShowGraceMinutes, setNoShowGraceMinutes] = useState(15);
	const [acceptingReservations, setAcceptingReservations] = useState(true);
	const [turnRanges, setTurnRanges] = useState<TurnRange[]>([]);
	const [blackouts, setBlackouts] = useState<BlackoutWindow[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		if (!settings) return;
		setDefaultTurnMinutes(settings.defaultTurnMinutes);
		setMinAdvanceMinutes(settings.minAdvanceMinutes);
		setMaxAdvanceDays(settings.maxAdvanceDays);
		setNoShowGraceMinutes(settings.noShowGraceMinutes);
		setAcceptingReservations(settings.acceptingReservations);
		setTurnRanges([...settings.turnMinutesByCapacity]);
		setBlackouts([...settings.blackoutWindows]);
	}, [settings]);

	const handleSave = async () => {
		setError(null);
		setSaved(false);
		try {
			unwrapResult(
				await updateMutation.mutateAsync({
					restaurantId,
					defaultTurnMinutes,
					minAdvanceMinutes,
					maxAdvanceDays,
					noShowGraceMinutes,
					acceptingReservations,
					turnMinutesByCapacity: turnRanges,
					blackoutWindows: blackouts,
				})
			);
			setSaved(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save");
		}
	};

	return (
		<div className="space-y-6 max-w-2xl">
			{error && <InlineError message={error} onDismiss={() => setError(null)} />}
			{saved && (
				<p className="text-xs" style={{ color: "var(--accent-success)" }}>
					Saved.
				</p>
			)}
			{settings?.isDefault && (
				<p className="text-xs" style={{ color: "var(--text-muted)" }}>
					Using defaults. Save to persist your own values.
				</p>
			)}

			<div className="flex items-center justify-between">
				<span className="flex items-center gap-1.5 text-sm font-medium">
					<label htmlFor="accepting">Accepting reservations</label>
					<InfoTooltip description={FIELD_DESCRIPTIONS.accepting} />
				</span>
				<input
					id="accepting"
					type="checkbox"
					checked={acceptingReservations}
					onChange={(e) => setAcceptingReservations(e.target.checked)}
				/>
			</div>

			<NumberField
				id="default-turn"
				label="Default turn time (minutes)"
				value={defaultTurnMinutes}
				onChange={setDefaultTurnMinutes}
				min={15}
				description={FIELD_DESCRIPTIONS.defaultTurn}
			/>
			<NumberField
				id="min-advance"
				label="Minimum advance (minutes)"
				value={minAdvanceMinutes}
				onChange={setMinAdvanceMinutes}
				min={0}
				description={FIELD_DESCRIPTIONS.minAdvance}
			/>
			<NumberField
				id="max-advance"
				label="Booking horizon (days)"
				value={maxAdvanceDays}
				onChange={setMaxAdvanceDays}
				min={1}
				description={FIELD_DESCRIPTIONS.maxAdvance}
			/>
			<NumberField
				id="grace"
				label="No-show grace (minutes)"
				value={noShowGraceMinutes}
				onChange={setNoShowGraceMinutes}
				min={0}
				description={FIELD_DESCRIPTIONS.noShowGrace}
			/>

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<span className="flex items-center gap-1.5">
						<h3 className="text-sm font-medium">Per-party-size turn time</h3>
						<InfoTooltip description={FIELD_DESCRIPTIONS.turnRanges} />
					</span>
					<button
						type="button"
						onClick={() =>
							setTurnRanges((rs) => [
								...rs,
								{ minPartySize: 1, maxPartySize: 4, turnMinutes: 90 },
							])
						}
						className="flex items-center gap-1 text-xs px-2 py-1 rounded-md"
						style={{ border: "1px solid var(--border-default)" }}
					>
						<Plus size={12} /> Add range
					</button>
				</div>
				<p className="text-xs" style={{ color: "var(--text-muted)" }}>
					First matching range wins. If no range matches, the default turn time is used.
				</p>
				{turnRanges.map((r, i) => (
					<div key={`${r.minPartySize}-${r.maxPartySize}-${i}`} className="flex items-end gap-2">
						<NumberField
							id={`min-party-${i}`}
							label="Min party"
							value={r.minPartySize}
							onChange={(v) =>
								setTurnRanges((rs) =>
									rs.map((rr, j) => (j === i ? { ...rr, minPartySize: v } : rr))
								)
							}
							min={1}
						/>
						<NumberField
							id={`max-party-${i}`}
							label="Max party"
							value={r.maxPartySize}
							onChange={(v) =>
								setTurnRanges((rs) =>
									rs.map((rr, j) => (j === i ? { ...rr, maxPartySize: v } : rr))
								)
							}
							min={1}
						/>
						<NumberField
							id={`turn-${i}`}
							label="Turn (min)"
							value={r.turnMinutes}
							onChange={(v) =>
								setTurnRanges((rs) =>
									rs.map((rr, j) => (j === i ? { ...rr, turnMinutes: v } : rr))
								)
							}
							min={15}
						/>
						<button
							type="button"
							onClick={() => setTurnRanges((rs) => rs.filter((_, j) => j !== i))}
							className="p-2 rounded-md"
							aria-label="Remove"
						>
							<Trash2 size={14} style={{ color: "var(--accent-danger)" }} />
						</button>
					</div>
				))}
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<span className="flex items-center gap-1.5">
						<h3 className="text-sm font-medium">Blackout windows</h3>
						<InfoTooltip description={FIELD_DESCRIPTIONS.blackouts} />
					</span>
					<button
						type="button"
						onClick={() => {
							const now = Date.now();
							setBlackouts((bs) => [
								...bs,
								{ startsAt: now, endsAt: now + 2 * 60 * 60 * 1000 },
							]);
						}}
						className="flex items-center gap-1 text-xs px-2 py-1 rounded-md"
						style={{ border: "1px solid var(--border-default)" }}
					>
						<Plus size={12} /> Add window
					</button>
				</div>
				{blackouts.map((b, i) => (
					<div
						key={`${b.startsAt}-${b.endsAt}-${i}`}
						className="flex items-end gap-2 flex-wrap"
					>
						<DateTimeField
							id={`bo-start-${i}`}
							label="Starts at"
							valueMs={b.startsAt}
							onChangeMs={(v) =>
								setBlackouts((bs) => bs.map((bb, j) => (j === i ? { ...bb, startsAt: v } : bb)))
							}
						/>
						<DateTimeField
							id={`bo-end-${i}`}
							label="Ends at"
							valueMs={b.endsAt}
							onChangeMs={(v) =>
								setBlackouts((bs) => bs.map((bb, j) => (j === i ? { ...bb, endsAt: v } : bb)))
							}
						/>
						<TextField
							id={`bo-reason-${i}`}
							label="Reason"
							value={b.reason ?? ""}
							onChange={(v) =>
								setBlackouts((bs) => bs.map((bb, j) => (j === i ? { ...bb, reason: v } : bb)))
							}
						/>
						<button
							type="button"
							onClick={() => setBlackouts((bs) => bs.filter((_, j) => j !== i))}
							className="p-2 rounded-md"
							aria-label="Remove"
						>
							<Trash2 size={14} style={{ color: "var(--accent-danger)" }} />
						</button>
					</div>
				))}
			</div>

			<button
				type="button"
				onClick={handleSave}
				className="px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
			>
				Save settings
			</button>
		</div>
	);
}
