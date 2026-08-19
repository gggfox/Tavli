import {
	DEFAULT_CAPACITY,
	MAX_INITIAL_TABLE_COUNT,
} from "@/features/restaurants/utils/tableLayout";
import { TextInput } from "@/global/components";
import { RestaurantsKeys } from "@/global/i18n";
import { useForm } from "@tanstack/react-form";
import type { Id } from "convex/_generated/dataModel";
import { Grid2x2Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NumberStepper } from "./NumberStepper";

interface NewSectionFormProps {
	restaurantId: Id<"restaurants">;
	onCreateSection: (input: {
		restaurantId: Id<"restaurants">;
		name?: string;
		initialTableCount: number;
		initialTableCapacity?: number;
	}) => Promise<void>;
}

const SEATS_HINT_ID = "new-section-seats-hint";

/**
 * "Add section" form — the heavier of the two floor-plan add actions: it can
 * create a section and up to `MAX_INITIAL_TABLE_COUNT` tables in one submit.
 * It is deliberately styled as a filled card with a primary, grid-icon button
 * whose label counts the tables it is about to create, so it can never be
 * mistaken for the single-table form below it (see `NewTableForm`).
 *
 * TAVLI-75: "Seats per table" is one number applied to every table this form
 * bulk-creates, and it used to disable itself whenever `tableCount` was 0 —
 * which read as "the app won't let me set the seats per table at all". The
 * field is now never disabled, and a hint under the row says what the number
 * actually is: a starting value shared by the new tables, changeable table by
 * table afterwards (`TableEditRow`) — or, at 0 tables, what to do to make it
 * apply. A per-table grid at creation time is deliberately not offered; the
 * per-table edit already exists once the section is on the floor plan.
 */
export function NewSectionForm({ restaurantId, onCreateSection }: Readonly<NewSectionFormProps>) {
	const { t } = useTranslation();

	const newSectionForm = useForm({
		defaultValues: { name: "", tableCount: 0, seats: DEFAULT_CAPACITY },
		onSubmit: async ({ value }) => {
			await onCreateSection({
				restaurantId,
				name: value.name || undefined,
				initialTableCount: value.tableCount,
				initialTableCapacity: value.tableCount > 0 ? value.seats : undefined,
			});
			newSectionForm.reset();
		},
	});

	return (
		<section className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
			<div>
				<h3 className="text-sm font-semibold text-foreground">
					{t(RestaurantsKeys.SECTIONS_HEADING)}
				</h3>
				<p className="text-xs text-faint-foreground max-w-md">{t(RestaurantsKeys.SECTIONS_HINT)}</p>
			</div>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					newSectionForm.handleSubmit();
				}}
				className="flex gap-2 items-end flex-wrap"
			>
				<newSectionForm.Field
					name="name"
					children={(field) => (
						<TextInput
							id="new-section-name"
							type="text"
							value={field.state.value}
							onChange={(e) => field.handleChange(e.target.value)}
							onBlur={field.handleBlur}
							placeholder={t(RestaurantsKeys.SECTIONS_NEW_NAME_PLACEHOLDER)}
							className="w-64"
						/>
					)}
				/>
				<newSectionForm.Field
					name="tableCount"
					children={(field) => (
						<NumberStepper
							id="new-section-table-count"
							label={t(RestaurantsKeys.SECTIONS_INITIAL_TABLE_COUNT_LABEL)}
							value={field.state.value}
							min={0}
							max={MAX_INITIAL_TABLE_COUNT}
							onChange={field.handleChange}
						/>
					)}
				/>
				<newSectionForm.Field
					name="seats"
					children={(field) => (
						<TextInput
							id="new-section-seats"
							type="number"
							label={t(RestaurantsKeys.SECTIONS_INITIAL_TABLE_SEATS_LABEL)}
							value={String(field.state.value)}
							onChange={(e) => {
								const parsed = Number.parseInt(e.target.value, 10);
								// The field is always enabled now, so it can also always block
								// submit via `min`. Snap instead of holding an invalid value:
								// clearing the box already snapped back to the default.
								field.handleChange(Number.isNaN(parsed) ? DEFAULT_CAPACITY : Math.max(1, parsed));
							}}
							min={1}
							aria-describedby={SEATS_HINT_ID}
							className="w-24"
						/>
					)}
				/>
				<newSectionForm.Subscribe
					selector={(state) => state.values.tableCount}
					children={(tableCount) => (
						<>
							<button
								type="submit"
								className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold hover-btn-primary"
							>
								<Grid2x2Plus size={18} />
								{tableCount > 0
									? t(RestaurantsKeys.SECTIONS_ADD_WITH_TABLES, { count: tableCount })
									: t(RestaurantsKeys.SECTIONS_ADD)}
							</button>
							<p id={SEATS_HINT_ID} className="w-full text-xs text-faint-foreground max-w-md">
								{tableCount > 0
									? t(RestaurantsKeys.SECTIONS_INITIAL_TABLE_SEATS_HINT)
									: t(RestaurantsKeys.SECTIONS_INITIAL_TABLE_SEATS_IDLE_HINT, {
											field: t(RestaurantsKeys.SECTIONS_INITIAL_TABLE_COUNT_LABEL),
										})}
							</p>
						</>
					)}
				/>
			</form>
		</section>
	);
}
