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

/**
 * "Add section" form — the heavier of the two floor-plan add actions: it can
 * create a section and up to `MAX_INITIAL_TABLE_COUNT` tables in one submit.
 * It is deliberately styled as a filled card with a primary, grid-icon button
 * whose label counts the tables it is about to create, so it can never be
 * mistaken for the single-table form below it (see `NewTableForm`).
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
				<newSectionForm.Subscribe
					selector={(state) => state.values.tableCount}
					children={(tableCount) => (
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
										field.handleChange(Number.isNaN(parsed) ? DEFAULT_CAPACITY : parsed);
									}}
									min={1}
									disabled={tableCount === 0}
									className="w-24"
								/>
							)}
						/>
					)}
				/>
				<newSectionForm.Subscribe
					selector={(state) => state.values.tableCount}
					children={(tableCount) => (
						<button
							type="submit"
							className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold hover-btn-primary"
						>
							<Grid2x2Plus size={18} />
							{tableCount > 0
								? t(RestaurantsKeys.SECTIONS_ADD_WITH_TABLES, { count: tableCount })
								: t(RestaurantsKeys.SECTIONS_ADD)}
						</button>
					)}
				/>
			</form>
		</section>
	);
}
