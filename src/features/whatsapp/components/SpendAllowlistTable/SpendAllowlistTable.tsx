/**
 * Admin surface for the WhatsApp spend allowlist (TAVLI-91).
 *
 * A row here exempts one phone from the assistant's daily message caps — and
 * from nothing else. The screen says so, because the natural misreading ("this
 * number can do anything") is the one that would get an owner's regulars added.
 *
 * Built on `AdminTable` + `useAdminTable` rather than the hand-rolled table in
 * `FeatureFlagsTable`: this is a real create/remove list, whereas the flags
 * table renders rows from a code-owned registry and has no rows to add.
 */
import { AdminTable, InlineError } from "@/global/components";
import { formInputClasses, formInputStyle } from "@/global/components/Form/styles";
import { useAdminTable } from "@/global/hooks";
import { unwrapResult } from "@/global/utils";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { WHATSAPP_SPEND_ALLOWLIST_SEED } from "convex/constants";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { columns, type SpendAllowlistRow } from "./Columns";

export function SpendAllowlistTable() {
	const { t } = useTranslation();

	const tableState = useAdminTable<SpendAllowlistRow>({
		queryOptions: convexQuery(api.whatsappSpendAllowlist.list, {}),
		columns,
	});

	const addEntry = useMutation({ mutationFn: useConvexMutation(api.whatsappSpendAllowlist.add) });
	const removeEntry = useMutation({
		mutationFn: useConvexMutation(api.whatsappSpendAllowlist.remove),
	});
	const seedOperator = useMutation({
		mutationFn: useConvexMutation(api.whatsappSpendAllowlist.seedOperatorNumber),
	});

	const [phone, setPhone] = useState("");
	const [label, setLabel] = useState("");
	const [error, setError] = useState<string | null>(null);

	const handleAdd = async () => {
		setError(null);
		try {
			// Sent as typed. The backend canonicalizes and rejects what it cannot
			// place, so there is exactly one implementation of "what counts as this
			// phone" and the UI cannot drift from it.
			unwrapResult(await addEntry.mutateAsync({ phone, label }));
			setPhone("");
			setLabel("");
		} catch (err) {
			setError(getErrorMessage(err, t));
		}
	};

	// The one entry that ships with the product. Offered as a button rather than
	// inserted on deploy, so that removing it sticks.
	const operatorMissing = !(tableState.data ?? []).some(
		(row) => row.phone === WHATSAPP_SPEND_ALLOWLIST_SEED.phone
	);

	const handleSeedOperator = async () => {
		setError(null);
		try {
			// Reports refusal in-band (`{ ok: false, error }`) rather than as a
			// tuple, so it needs its own check — an ignored `ok: false` would look
			// like a click that did nothing.
			const result = await seedOperator.mutateAsync({});
			if (!result.ok) setError(getErrorMessage(result.error, t));
		} catch (err) {
			setError(getErrorMessage(err, t));
		}
	};

	const handleRemove = async (allowlistId: Id<"whatsappSpendAllowlist">) => {
		setError(null);
		try {
			unwrapResult(await removeEntry.mutateAsync({ allowlistId }));
		} catch (err) {
			setError(getErrorMessage(err, t));
		}
	};

	return (
		<div className="flex flex-col flex-1 h-full min-h-0 gap-4">
			{error && <InlineError message={error} onDismiss={() => setError(null)} />}

			<div className="rounded-lg p-4 space-y-3 bg-muted border border-border">
				<div>
					<h3 className="text-sm font-medium">Exempt a phone</h3>
					<p className="text-xs text-muted-foreground mt-1">
						Waives the assistant&rsquo;s daily message caps (25 inbound, 75 outbound per day) for
						this number. It does not waive the hourly reservation-write limit, and it does not waive
						the platform-wide daily ceiling.
					</p>
				</div>
				<div className="flex flex-wrap gap-2 items-end">
					<label
						htmlFor="allowlist-phone"
						className="flex flex-col gap-1 text-xs text-muted-foreground"
					>
						<span>Phone</span>
						<input
							id="allowlist-phone"
							type="tel"
							value={phone}
							onChange={(e) => setPhone(e.target.value)}
							placeholder="+52 811 490 6208"
							className={formInputClasses}
							style={formInputStyle}
						/>
					</label>
					<label
						htmlFor="allowlist-label"
						className="flex flex-col gap-1 text-xs text-muted-foreground"
					>
						<span>Label</span>
						<input
							id="allowlist-label"
							type="text"
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="Whose phone is this?"
							className={formInputClasses}
							style={formInputStyle}
						/>
					</label>
					<button
						type="button"
						onClick={handleAdd}
						className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
					>
						<Plus size={14} /> Add to allowlist
					</button>
				</div>
			</div>

			<AdminTable
				tableState={tableState}
				entityName="allowlisted phones"
				searchPlaceholder="Search allowlisted phones..."
				emptyIcon={ShieldCheck}
				emptyTitle="No phones are exempt"
				emptyDescription="Every phone is subject to the assistant's daily message caps. Add the operator's own number here so testing is not silenced after 25 messages."
				filteredEmptyTitle="No matching phones"
				notAuthenticatedMessage="Please sign in to view the WhatsApp spend allowlist."
				actions={
					operatorMissing ? (
						<button
							type="button"
							onClick={handleSeedOperator}
							className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-primary text-primary-foreground"
						>
							<Plus size={16} />
							Add operator number
						</button>
					) : undefined
				}
				renderRowActions={(row) => (
					<div className="flex justify-end">
						<button
							type="button"
							onClick={() => handleRemove(row._id)}
							className="p-1.5 rounded-md transition-colors hover:opacity-80 text-destructive"
							aria-label={`Remove ${row.label}`}
						>
							<Trash2 size={15} />
						</button>
					</div>
				)}
			/>
		</div>
	);
}
