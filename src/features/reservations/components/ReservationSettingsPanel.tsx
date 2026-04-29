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
import { ReservationSettingsKeys, ReservationsKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

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
	const { t } = useTranslation();
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
			setError(err instanceof Error ? err.message : t(ReservationSettingsKeys.MSG_SAVE_FAILED));
		}
	};

	return (
		<div className="space-y-6 max-w-2xl">
			{error && <InlineError message={error} onDismiss={() => setError(null)} />}
			{saved && (
				<p className="text-xs text-success" >
					{t(ReservationSettingsKeys.MSG_SAVED)}
				</p>
			)}
			{settings?.isDefault && (
				<p className="text-xs text-faint-foreground" >
					{t(ReservationSettingsKeys.MSG_USING_DEFAULTS)}
				</p>
			)}

			<div className="flex items-center justify-between">
				<span className="flex items-center gap-1.5 text-sm font-medium">
					<label htmlFor="accepting">
						{t(ReservationSettingsKeys.LABEL_ACCEPTING)}
					</label>
					<InfoTooltip description={t(ReservationSettingsKeys.DESC_ACCEPTING)} />
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
				label={t(ReservationSettingsKeys.LABEL_DEFAULT_TURN)}
				value={defaultTurnMinutes}
				onChange={setDefaultTurnMinutes}
				min={15}
				description={t(ReservationSettingsKeys.DESC_DEFAULT_TURN)}
			/>
			<NumberField
				id="min-advance"
				label={t(ReservationSettingsKeys.LABEL_MIN_ADVANCE)}
				value={minAdvanceMinutes}
				onChange={setMinAdvanceMinutes}
				min={0}
				description={t(ReservationSettingsKeys.DESC_MIN_ADVANCE)}
			/>
			<NumberField
				id="max-advance"
				label={t(ReservationSettingsKeys.LABEL_MAX_ADVANCE)}
				value={maxAdvanceDays}
				onChange={setMaxAdvanceDays}
				min={1}
				description={t(ReservationSettingsKeys.DESC_MAX_ADVANCE)}
			/>
			<NumberField
				id="grace"
				label={t(ReservationSettingsKeys.LABEL_NO_SHOW_GRACE)}
				value={noShowGraceMinutes}
				onChange={setNoShowGraceMinutes}
				min={0}
				description={t(ReservationSettingsKeys.DESC_NO_SHOW_GRACE)}
			/>

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<span className="flex items-center gap-1.5">
						<h3 className="text-sm font-medium">
							{t(ReservationSettingsKeys.LABEL_TURN_RANGES)}
						</h3>
						<InfoTooltip description={t(ReservationSettingsKeys.DESC_TURN_RANGES)} />
					</span>
					<button
						type="button"
						onClick={() =>
							setTurnRanges((rs) => [
								...rs,
								{ minPartySize: 1, maxPartySize: 4, turnMinutes: 90 },
							])
						}
						className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border"
						
					>
						<Plus size={12} /> {t(ReservationSettingsKeys.ACTION_ADD_RANGE)}
					</button>
				</div>
				<p className="text-xs text-faint-foreground" >
					{t(ReservationSettingsKeys.MSG_RANGE_FALLBACK)}
				</p>
				{turnRanges.map((r, i) => (
					<div key={`${r.minPartySize}-${r.maxPartySize}-${i}`} className="flex items-end gap-2">
						<NumberField
							id={`min-party-${i}`}
							label={t(ReservationSettingsKeys.LABEL_MIN_PARTY)}
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
							label={t(ReservationSettingsKeys.LABEL_MAX_PARTY)}
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
							label={t(ReservationSettingsKeys.LABEL_TURN_MINUTES)}
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
							className="p-2 rounded-md text-destructive"
							aria-label={t(ReservationsKeys.ARIA_REMOVE)}
						>
							<Trash2 size={14}  />
						</button>
					</div>
				))}
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<span className="flex items-center gap-1.5">
						<h3 className="text-sm font-medium">
							{t(ReservationSettingsKeys.LABEL_BLACKOUTS)}
						</h3>
						<InfoTooltip description={t(ReservationSettingsKeys.DESC_BLACKOUTS)} />
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
						className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border"
						
					>
						<Plus size={12} /> {t(ReservationSettingsKeys.ACTION_ADD_WINDOW)}
					</button>
				</div>
				{blackouts.map((b, i) => (
					<div
						key={`${b.startsAt}-${b.endsAt}-${i}`}
						className="flex items-end gap-2 flex-wrap"
					>
						<DateTimeField
							id={`bo-start-${i}`}
							label={t(ReservationSettingsKeys.LABEL_STARTS_AT)}
							valueMs={b.startsAt}
							onChangeMs={(v) =>
								setBlackouts((bs) => bs.map((bb, j) => (j === i ? { ...bb, startsAt: v } : bb)))
							}
						/>
						<DateTimeField
							id={`bo-end-${i}`}
							label={t(ReservationSettingsKeys.LABEL_ENDS_AT)}
							valueMs={b.endsAt}
							onChangeMs={(v) =>
								setBlackouts((bs) => bs.map((bb, j) => (j === i ? { ...bb, endsAt: v } : bb)))
							}
						/>
						<TextField
							id={`bo-reason-${i}`}
							label={t(ReservationSettingsKeys.LABEL_REASON)}
							value={b.reason ?? ""}
							onChange={(v) =>
								setBlackouts((bs) => bs.map((bb, j) => (j === i ? { ...bb, reason: v } : bb)))
							}
						/>
						<button
							type="button"
							onClick={() => setBlackouts((bs) => bs.filter((_, j) => j !== i))}
							className="p-2 rounded-md text-destructive"
							aria-label={t(ReservationsKeys.ARIA_REMOVE)}
						>
							<Trash2 size={14}  />
						</button>
					</div>
				))}
			</div>

			<button
				type="button"
				onClick={handleSave}
				className="px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
			>
				{t(ReservationSettingsKeys.ACTION_SAVE)}
			</button>
		</div>
	);
}
