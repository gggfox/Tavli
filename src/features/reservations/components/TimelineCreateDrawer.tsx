import { Drawer } from "@/global/components";
import { ReservationsKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatTimeOnly, toDateTimeLocalValue } from "@/features/reservations/utils";

const ERROR_TO_KEY: Record<string, string> = {
	ERROR_NOT_ACCEPTING_RESERVATIONS: ReservationsKeys.REASON_NOT_ACCEPTING,
	ERROR_OUTSIDE_BOOKING_HORIZON: ReservationsKeys.REASON_OUTSIDE_BOOKING_HORIZON,
	ERROR_BLACKOUT_WINDOW: ReservationsKeys.REASON_BLACKOUT_WINDOW,
	ERROR_NO_TABLES_AVAILABLE: ReservationsKeys.REASON_NO_TABLES,
};

function mapCreateError(message: string, t: (key: string) => string): string {
	const key = ERROR_TO_KEY[message];
	return key ? t(key) : t(ReservationsKeys.FORM_GENERIC_ERROR);
}

interface TimelineCreateDrawerProps {
	readonly restaurantId: Id<"restaurants">;
	readonly tableId: Id<"tables">;
	readonly tableLabel: string;
	readonly startsAt: number;
	readonly onClose: () => void;
}

export function TimelineCreateDrawer({
	restaurantId,
	tableId,
	tableLabel,
	startsAt,
	onClose,
}: TimelineCreateDrawerProps) {
	const { t, i18n } = useTranslation();
	const [name, setName] = useState("");
	const [phone, setPhone] = useState("");
	const [partySize, setPartySize] = useState(2);
	const [notes, setNotes] = useState("");
	const [dateTime, setDateTime] = useState(toDateTimeLocalValue(startsAt));
	const [error, setError] = useState<string | null>(null);

	const createMutation = useMutation({
		mutationFn: useConvexMutation(api.reservations.createAsStaff),
	});

	const confirmMutation = useMutation({
		mutationFn: useConvexMutation(api.reservations.confirm),
	});

	const handleSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			setError(null);

			if (!name.trim() || !phone.trim()) {
				setError(t(ReservationsKeys.FORM_REQUIRED_ERROR));
				return;
			}

			const parsedStartsAt = new Date(dateTime).getTime();
			if (Number.isNaN(parsedStartsAt)) {
				setError(t(ReservationsKeys.FORM_GENERIC_ERROR));
				return;
			}

			try {
				const result = await createMutation.mutateAsync({
					restaurantId,
					partySize,
					startsAt: parsedStartsAt,
					contact: { name: name.trim(), phone: phone.trim() },
					notes: notes.trim() || undefined,
				});
				const reservationId = unwrapResult(result);

				await confirmMutation.mutateAsync({
					reservationId: reservationId!,
					tableIds: [tableId],
				});

				onClose();
			} catch (err) {
				const msg = err instanceof Error ? err.message : "";
				setError(mapCreateError(msg, t));
			}
		},
		[
			name,
			phone,
			partySize,
			dateTime,
			notes,
			restaurantId,
			tableId,
			createMutation,
			confirmMutation,
			onClose,
			t,
		]
	);

	const isSaving = createMutation.isPending || confirmMutation.isPending;
	const timeLabel = formatTimeOnly(startsAt, i18n.language);

	return (
		<Drawer isOpen onClose={onClose} ariaLabel="Create reservation">
			<div className="p-5 space-y-5">
				<div>
					<h2 className="text-lg font-semibold text-foreground">
						{t(ReservationsKeys.TIMELINE_CREATE_TITLE, { tableLabel })}
					</h2>
					<p className="text-xs text-muted-foreground mt-0.5">{timeLabel}</p>
				</div>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label htmlFor="tl-name" className="block text-sm font-medium mb-1 text-foreground">
							{t(ReservationsKeys.FORM_NAME)}
						</label>
						<input
							id="tl-name"
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
							className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
						/>
					</div>

					<div>
						<label htmlFor="tl-phone" className="block text-sm font-medium mb-1 text-foreground">
							{t(ReservationsKeys.FORM_PHONE)}
						</label>
						<input
							id="tl-phone"
							type="tel"
							value={phone}
							onChange={(e) => setPhone(e.target.value)}
							required
							className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
						/>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div>
							<label htmlFor="tl-party" className="block text-sm font-medium mb-1 text-foreground">
								{t(ReservationsKeys.FORM_PARTY_SIZE)}
							</label>
							<input
								id="tl-party"
								type="number"
								min={1}
								max={50}
								value={partySize}
								onChange={(e) => setPartySize(Number(e.target.value))}
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
							/>
						</div>
						<div>
							<label htmlFor="tl-time" className="block text-sm font-medium mb-1 text-foreground">
								{t(ReservationsKeys.FORM_DATE_TIME)}
							</label>
							<input
								id="tl-time"
								type="datetime-local"
								value={dateTime}
								onChange={(e) => setDateTime(e.target.value)}
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
							/>
						</div>
					</div>

					<div>
						<label htmlFor="tl-notes" className="block text-sm font-medium mb-1 text-foreground">
							{t(ReservationsKeys.FORM_NOTES)}
						</label>
						<textarea
							id="tl-notes"
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							rows={2}
							className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
						/>
					</div>

					{error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

					<div className="flex gap-2 pt-2">
						<button
							type="submit"
							disabled={isSaving}
							className="flex-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
						>
							{isSaving ? t(ReservationsKeys.FORM_SUBMITTING) : t(ReservationsKeys.FORM_SUBMIT)}
						</button>
						<button
							type="button"
							onClick={onClose}
							className="px-4 py-2 rounded-lg text-sm font-medium bg-muted border border-border text-foreground hover:bg-hover"
						>
							{t(ReservationsKeys.ACTION_BACK)}
						</button>
					</div>
				</form>
			</div>
		</Drawer>
	);
}
