import { DEFAULT_CAPACITY } from "@/features/restaurants/utils/tableLayout";
import { TextInput } from "@/global/components";
import { RestaurantsKeys } from "@/global/i18n";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface NewTableFormProps {
	restaurantId: Id<"restaurants">;
	nextTableNumber: number;
	sections: readonly Doc<"sections">[];
	sectionLabel: (s: Doc<"sections">, idx: number) => string;
	onCreate: (input: {
		restaurantId: Id<"restaurants">;
		tableNumber: number;
		capacity: number;
		sectionId?: Id<"sections">;
	}) => Promise<void>;
}

/**
 * "Add table" form. The table number defaults to the next available integer
 * (max(tableNumber) + 1) and stays in sync as new tables are added, so a
 * single click on the Add button just works without any user typing.
 */
export function NewTableForm({
	restaurantId,
	nextTableNumber,
	sections,
	sectionLabel,
	onCreate,
}: Readonly<NewTableFormProps>) {
	const { t } = useTranslation();
	const [tableNumberRaw, setTableNumberRaw] = useState<string>(String(nextTableNumber));
	const [capacityRaw, setCapacityRaw] = useState<string>("");
	const [sectionId, setSectionId] = useState<string>("");
	// Track whether the user has typed into the number field. While untouched,
	// keep it in sync with `nextTableNumber` so adding tables in a row stays
	// frictionless.
	const userTouchedNumberRef = useRef(false);

	useEffect(() => {
		if (!userTouchedNumberRef.current) {
			setTableNumberRaw(String(nextTableNumber));
		}
	}, [nextTableNumber]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const num = Number.parseInt(tableNumberRaw, 10);
		if (Number.isNaN(num) || num < 1) return;
		const cap = Number.parseInt(capacityRaw, 10);
		try {
			await onCreate({
				restaurantId,
				tableNumber: num,
				capacity: Number.isNaN(cap) ? DEFAULT_CAPACITY : cap,
				sectionId: sectionId.length > 0 ? (sectionId as Id<"sections">) : undefined,
			});
			setCapacityRaw("");
			setSectionId("");
			userTouchedNumberRef.current = false;
		} catch {
			// onCreate already surfaced the error in the parent.
		}
	};

	return (
		<form onSubmit={handleSubmit} className="flex gap-2 items-end flex-wrap">
			<TextInput
				type="number"
				label={t(RestaurantsKeys.TABLES_NUMBER_LABEL)}
				value={tableNumberRaw}
				onChange={(e) => {
					userTouchedNumberRef.current = true;
					setTableNumberRaw(e.target.value);
				}}
				min={1}
				className="w-24"
			/>
			<TextInput
				type="number"
				label={t(RestaurantsKeys.TABLES_SEATS_LABEL)}
				value={capacityRaw}
				onChange={(e) => setCapacityRaw(e.target.value)}
				min={1}
				placeholder={String(DEFAULT_CAPACITY)}
				className="w-24"
			/>
			<div>
				<label
					htmlFor="new-table-section"
					className="block text-xs font-medium mb-1 text-muted-foreground"
				>
					{t(RestaurantsKeys.TABLES_SECTION_LABEL)}
				</label>
				<select
					id="new-table-section"
					value={sectionId}
					onChange={(e) => setSectionId(e.target.value)}
					className="px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
				>
					{sections.length === 0 ? (
						<option value="">{t(RestaurantsKeys.SECTIONS_AUTO_CREATE_PLACEHOLDER)}</option>
					) : (
						sections.map((s, idx) => (
							<option key={s._id} value={s._id}>
								{sectionLabel(s, idx)}
							</option>
						))
					)}
				</select>
			</div>
			<button
				type="submit"
				className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium hover-btn-primary"
			>
				<Plus size={16} />
				{t(RestaurantsKeys.TABLES_ADD)}
			</button>
		</form>
	);
}
