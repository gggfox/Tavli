/**
 * Public-facing reservation form. Renders at /r/$slug/reserve.
 *
 * Customer submits party size, date/time, and contact. The form runs the
 * availability query reactively so users see whether their pick is bookable
 * before submitting, then calls the public `reservations.create` mutation.
 */
import { unwrapResult } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { CalendarClock, Check } from "lucide-react";
import { useMemo, useState } from "react";
import {
	formatReservationTime,
	fromDateTimeLocalValue,
	toDateTimeLocalValue,
} from "../utils";

interface CustomerReservationFormProps {
	restaurantId: Id<"restaurants">;
	restaurantName: string;
}

const REASON_LABELS: Record<string, string> = {
	ERROR_NOT_ACCEPTING_RESERVATIONS:
		"This restaurant isn't taking reservations right now.",
	ERROR_OUTSIDE_BOOKING_HORIZON:
		"That time is outside the booking window. Try a closer or further-out time.",
	ERROR_BLACKOUT_WINDOW: "The restaurant is closed during that window.",
	ERROR_NO_TABLES_AVAILABLE: "No tables are free for that party at that time.",
};

export function CustomerReservationForm({
	restaurantId,
	restaurantName,
}: Readonly<CustomerReservationFormProps>) {
	const defaultStartMs = useMemo(() => {
		const d = new Date();
		d.setMinutes(d.getMinutes() + 60);
		d.setMinutes(Math.round(d.getMinutes() / 15) * 15, 0, 0);
		return d.getTime();
	}, []);

	const [partySize, setPartySize] = useState(2);
	const [startsAtMs, setStartsAtMs] = useState<number>(defaultStartMs);
	const [name, setName] = useState("");
	const [phone, setPhone] = useState("");
	const [email, setEmail] = useState("");
	const [notes, setNotes] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [createdId, setCreatedId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const { data: rawAvailability } = useQuery(
		convexQuery(api.reservations.getAvailability, {
			restaurantId,
			partySize,
			startsAt: startsAtMs,
		})
	);
	const availability = rawAvailability ?? null;

	const createMutation = useMutation({
		mutationFn: useConvexMutation(api.reservations.create),
	});

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		if (!name.trim() || !phone.trim()) {
			setError("Name and phone are required.");
			return;
		}
		setSubmitting(true);
		try {
			const id = unwrapResult(
				await createMutation.mutateAsync({
					restaurantId,
					partySize,
					startsAt: startsAtMs,
					contact: {
						name: name.trim(),
						phone: phone.trim(),
						email: email.trim() || undefined,
					},
					notes: notes.trim() || undefined,
				})
			);
			setCreatedId(id);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not create reservation");
		} finally {
			setSubmitting(false);
		}
	};

	if (createdId) {
		return (
			<div
				className="max-w-md mx-auto rounded-xl p-6 text-center space-y-3"
				style={{
					backgroundColor: "var(--bg-secondary)",
					border: "1px solid var(--border-default)",
				}}
			>
				<Check size={32} style={{ color: "var(--accent-success)", margin: "0 auto" }} />
				<h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
					Reservation requested
				</h2>
				<p className="text-sm" style={{ color: "var(--text-secondary)" }}>
					{restaurantName} will confirm shortly. We've recorded your party of {partySize} for{" "}
					{formatReservationTime(startsAtMs)}.
				</p>
			</div>
		);
	}

	const reasonLabel =
		availability && !availability.available && availability.reason
			? REASON_LABELS[availability.reason] ?? availability.reason
			: null;

	return (
		<form
			onSubmit={handleSubmit}
			className="max-w-md mx-auto rounded-xl p-6 space-y-4"
			style={{
				backgroundColor: "var(--bg-secondary)",
				border: "1px solid var(--border-default)",
			}}
		>
			<header className="space-y-1">
				<div className="flex items-center gap-2">
					<CalendarClock size={18} style={{ color: "var(--text-secondary)" }} />
					<h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
						Reserve at {restaurantName}
					</h1>
				</div>
			</header>

			<div className="grid grid-cols-2 gap-3">
				<NumberField
					id="rf-party"
					label="Party size"
					value={partySize}
					onChange={setPartySize}
					min={1}
				/>
				<DateTimeField
					id="rf-start"
					label="Date & time"
					valueMs={startsAtMs}
					onChangeMs={setStartsAtMs}
				/>
			</div>

			{availability && (
				<div
					className="rounded-md px-3 py-2 text-xs"
					style={{
						backgroundColor: availability.available
							? "var(--bg-primary)"
							: "rgba(220, 38, 38, 0.08)",
						color: availability.available
							? "var(--accent-success)"
							: "var(--accent-danger)",
						border: `1px solid ${
							availability.available
								? "var(--border-default)"
								: "rgba(220, 38, 38, 0.3)"
						}`,
					}}
				>
					{availability.available
						? `Available · ${availability.turnMinutes} min turn`
						: reasonLabel}
					{!availability.available && availability.suggestedTimes.length > 0 && (
						<div className="mt-1 flex flex-wrap gap-1">
							{availability.suggestedTimes.map((ms) => (
								<button
									key={ms}
									type="button"
									onClick={() => setStartsAtMs(ms)}
									className="text-xs px-2 py-0.5 rounded-full"
									style={{
										backgroundColor: "var(--bg-secondary)",
										border: "1px solid var(--border-default)",
										color: "var(--text-primary)",
									}}
								>
									{new Date(ms).toLocaleTimeString(undefined, {
										hour: "numeric",
										minute: "2-digit",
									})}
								</button>
							))}
						</div>
					)}
				</div>
			)}

			<TextField id="rf-name" label="Name" value={name} onChange={setName} required />
			<TextField id="rf-phone" label="Phone" value={phone} onChange={setPhone} required />
			<TextField id="rf-email" label="Email (optional)" value={email} onChange={setEmail} />

			<label htmlFor="rf-notes" className="flex flex-col gap-1 text-xs">
				<span style={{ color: "var(--text-secondary)" }}>Notes (optional)</span>
				<textarea
					id="rf-notes"
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
					rows={2}
					className="rounded-md px-3 py-2 text-sm"
					style={{
						backgroundColor: "var(--bg-primary)",
						border: "1px solid var(--border-default)",
						color: "var(--text-primary)",
					}}
				/>
			</label>

			{error && (
				<p className="text-xs" style={{ color: "var(--accent-danger)" }}>
					{error}
				</p>
			)}

			<button
				type="submit"
				disabled={submitting || (availability ? !availability.available : false)}
				className="w-full px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
				style={{
					opacity: submitting || (availability ? !availability.available : false) ? 0.6 : 1,
				}}
			>
				{submitting ? "Submitting…" : "Request reservation"}
			</button>
		</form>
	);
}

function NumberField({
	id,
	label,
	value,
	onChange,
	min,
}: Readonly<{ id: string; label: string; value: number; onChange: (v: number) => void; min?: number }>) {
	return (
		<label htmlFor={id} className="flex flex-col gap-1 text-xs">
			<span style={{ color: "var(--text-secondary)" }}>{label}</span>
			<input
				id={id}
				type="number"
				value={value}
				min={min}
				onChange={(e) => onChange(Number.parseInt(e.target.value, 10) || 0)}
				className="rounded-md px-3 py-2 text-sm"
				style={{
					backgroundColor: "var(--bg-primary)",
					border: "1px solid var(--border-default)",
					color: "var(--text-primary)",
				}}
			/>
		</label>
	);
}

function DateTimeField({
	id,
	label,
	valueMs,
	onChangeMs,
}: Readonly<{ id: string; label: string; valueMs: number; onChangeMs: (v: number) => void }>) {
	return (
		<label htmlFor={id} className="flex flex-col gap-1 text-xs">
			<span style={{ color: "var(--text-secondary)" }}>{label}</span>
			<input
				id={id}
				type="datetime-local"
				value={toDateTimeLocalValue(valueMs)}
				onChange={(e) => onChangeMs(fromDateTimeLocalValue(e.target.value))}
				className="rounded-md px-3 py-2 text-sm"
				style={{
					backgroundColor: "var(--bg-primary)",
					border: "1px solid var(--border-default)",
					color: "var(--text-primary)",
				}}
			/>
		</label>
	);
}

function TextField({
	id,
	label,
	value,
	onChange,
	required,
}: Readonly<{
	id: string;
	label: string;
	value: string;
	onChange: (v: string) => void;
	required?: boolean;
}>) {
	return (
		<label htmlFor={id} className="flex flex-col gap-1 text-xs">
			<span style={{ color: "var(--text-secondary)" }}>{label}</span>
			<input
				id={id}
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				required={required}
				className="rounded-md px-3 py-2 text-sm"
				style={{
					backgroundColor: "var(--bg-primary)",
					border: "1px solid var(--border-default)",
					color: "var(--text-primary)",
				}}
			/>
		</label>
	);
}
