/**
 * **Branding** — the restaurant's diner-visible visual identity (TAVLI-88).
 *
 * The concept is *Branding*. "Theme" keeps its existing meaning of light/dark
 * and nothing else; there is no such thing as a restaurant theme.
 *
 * Two things save differently, and the hint says so out loud. The colour and
 * the font go through `restaurants.update` on Save. The images do not — they
 * upload the moment they are picked, through an action that validates the
 * bytes server-side. Blurring that line would mean either a file input that
 * Save silently ignores, or an `Id<"_storage">` argument on a patch mutation,
 * which is the cross-tenant blob-delete primitive TAVLI-68 documents.
 */
import { BrandingImageUploader } from "@/features/restaurants/components/settings/BrandingImageUploader";
import { BrandingPreviewPane } from "@/features/restaurants/components/settings/BrandingPreviewPane";
import { SettingsSection } from "@/features/restaurants/components/settings/SettingsSection";
import { SettingsSectionFooter } from "@/features/restaurants/components/settings/SettingsSectionFooter";
import type { RestaurantSettingsSectionProps } from "@/features/restaurants/components/settings/types";
import { RestaurantsKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { normalizeBrandColor } from "convex/_shared/brandColor";
import {
	BRAND_FONTS,
	BRAND_FONT_IDS,
	SYSTEM_FONT_STACK,
	brandFontStack,
	resolveBrandFontId,
	type BrandFontId,
} from "convex/_shared/brandFonts";
import { useForm } from "@tanstack/react-form";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** `null` means "no font chosen" — the system stack. */
type FontChoice = BrandFontId | null;

export function BrandingSection({
	restaurant,
	onSave,
	isSaving,
	isSaved,
	error,
	errorCode,
	onDismissError,
}: Readonly<RestaurantSettingsSectionProps>) {
	const { t } = useTranslation();

	// Settings is fed a raw `Doc`, which carries storage *ids*. An id renders
	// nothing in an <img>, so the URLs come from their own manager-gated query.
	const { data: images, refetch: refetchImages } = useQuery(
		convexQuery(api.branding.getBrandingImages, { restaurantId: restaurant._id })
	);

	const form = useForm({
		defaultValues: {
			brandingColor: restaurant.brandingColor ?? "",
			brandingFontId: (resolveBrandFontId(restaurant.brandingFontId) ?? null) as FontChoice,
		},
		onSubmit: async ({ value }) => {
			const saved = await onSave({
				// Empty means "clear", and `null` is how the mutation is told so —
				// unlike the public-profile fields, empty string is NOT the clear
				// signal there, because a colour input mid-edit legitimately reads
				// "" and must not wipe a stored brand.
				brandingColor: value.brandingColor.trim() === "" ? null : value.brandingColor.trim(),
				brandingFontId: value.brandingFontId,
			});
			if (saved) form.reset(value);
		},
	});

	const colorError = errorCode === "ERROR_BRANDING_COLOR_INVALID" ? error : null;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit();
			}}
		>
			<SettingsSection
				testId="settings-section-branding"
				title={t(RestaurantsKeys.SETTINGS_BRANDING_TITLE)}
				hint={t(RestaurantsKeys.SETTINGS_BRANDING_HINT)}
				footer={
					<form.Subscribe
						selector={(state) => state.isDefaultValue}
						children={(isDefaultValue) => (
							<SettingsSectionFooter
								testId="settings-save-branding"
								canSave={!isDefaultValue}
								isSaving={isSaving}
								isSaved={isSaved}
								error={colorError ? null : error}
								onDismissError={onDismissError}
							/>
						)}
					/>
				}
			>
				<form.Field
					name="brandingColor"
					children={(field) => (
						<BrandColorField
							value={field.state.value}
							onChange={field.handleChange}
							error={colorError}
						/>
					)}
				/>

				<form.Field
					name="brandingFontId"
					children={(field) => (
						<FontPicker value={field.state.value} onChange={field.handleChange} />
					)}
				/>

				{/* Live preview. A form of hex values says nothing about whether the
				    menu looks good, and the per-mode adjustment is invisible until
				    you see both panes side by side. */}
				<form.Subscribe
					selector={(state) => [state.values.brandingColor, state.values.brandingFontId] as const}
					children={([colorValue, fontValue]) => {
						const normalized = normalizeBrandColor(colorValue);
						const fontStack = fontValue ? brandFontStack(fontValue) : SYSTEM_FONT_STACK;
						return (
							<div className="space-y-2">
								<p className="text-sm font-medium text-foreground">
									{t(RestaurantsKeys.SETTINGS_BRANDING_PREVIEW_HEADING)}
								</p>
								<div className="flex flex-wrap gap-4">
									<BrandingPreviewPane
										brandColor={normalized}
										mode="light"
										fontStack={fontStack}
										restaurantName={restaurant.name}
									/>
									<BrandingPreviewPane
										brandColor={normalized}
										mode="dark"
										fontStack={fontStack}
										restaurantName={restaurant.name}
									/>
								</div>
							</div>
						);
					}}
				/>

				<div className="space-y-4 border-t border-border pt-4">
					<BrandingImageUploader
						restaurantId={restaurant._id}
						slot="logo"
						label={t(RestaurantsKeys.SETTINGS_BRANDING_LOGO_LABEL)}
						hint={t(RestaurantsKeys.SETTINGS_BRANDING_LOGO_HINT)}
						image={images?.logo}
						onChanged={() => void refetchImages()}
					/>

					<div className="space-y-3">
						<p className="text-sm font-medium text-foreground">
							{t(RestaurantsKeys.SETTINGS_BRANDING_HEADER_LABEL)}
						</p>
						<p className="text-xs text-faint-foreground">
							{t(RestaurantsKeys.SETTINGS_BRANDING_HEADER_HINT)}
						</p>
						{/* One upload fans out to all three breakpoints. Asking for
						    three files gets you the same JPEG three times — the chore
						    without the benefit. The tablet and phone slots stay
						    individually replaceable for real art direction. */}
						<BrandingImageUploader
							restaurantId={restaurant._id}
							slot="headerDesktop"
							label={t(RestaurantsKeys.SETTINGS_BRANDING_SLOT_DESKTOP)}
							image={images?.headerDesktop}
							alsoFill={["headerTablet", "headerPhone"]}
							onChanged={() => void refetchImages()}
						/>
						<BrandingImageUploader
							restaurantId={restaurant._id}
							slot="headerTablet"
							label={t(RestaurantsKeys.SETTINGS_BRANDING_SLOT_TABLET)}
							hint={t(RestaurantsKeys.SETTINGS_BRANDING_SLOT_DERIVED)}
							image={images?.headerTablet}
							onChanged={() => void refetchImages()}
						/>
						<BrandingImageUploader
							restaurantId={restaurant._id}
							slot="headerPhone"
							label={t(RestaurantsKeys.SETTINGS_BRANDING_SLOT_PHONE)}
							hint={t(RestaurantsKeys.SETTINGS_BRANDING_SLOT_DERIVED)}
							image={images?.headerPhone}
							onChanged={() => void refetchImages()}
						/>
					</div>
				</div>
			</SettingsSection>
		</form>
	);
}

/**
 * Swatch and hex field, two-way bound.
 *
 * The text input is the primary control, not the colour picker: nobody
 * eyedroppers their own brand colour, they paste it from a brand guide. The
 * native swatch is there for the case where somebody genuinely wants to browse.
 */
function BrandColorField({
	value,
	onChange,
	error,
}: Readonly<{ value: string; onChange: (next: string) => void; error: string | null }>) {
	const { t } = useTranslation();
	const inputId = useId();
	const normalized = normalizeBrandColor(value);
	// `<input type="color">` accepts only `#rrggbb` and silently shows black
	// for anything else, including a valid three-digit shorthand.
	const swatchValue = normalized ?? "#2383e2";

	return (
		<div>
			<label htmlFor={inputId} className="block text-sm font-medium mb-1 text-foreground">
				{t(RestaurantsKeys.SETTINGS_BRANDING_COLOR_LABEL)}
			</label>
			<div className="flex items-center gap-2">
				<input
					type="color"
					value={swatchValue}
					onChange={(e) => onChange(e.target.value)}
					aria-label={t(RestaurantsKeys.SETTINGS_BRANDING_COLOR_LABEL)}
					className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-input p-1"
				/>
				<input
					id={inputId}
					type="text"
					inputMode="text"
					autoComplete="off"
					spellCheck={false}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder="#2383e2"
					className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
				/>
				{value ? (
					<button
						type="button"
						onClick={() => onChange("")}
						className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-(--bg-hover)"
					>
						{t(RestaurantsKeys.SETTINGS_BRANDING_COLOR_CLEAR)}
					</button>
				) : null}
			</div>
			<p className="mt-1 text-xs text-faint-foreground">
				{t(RestaurantsKeys.SETTINGS_BRANDING_COLOR_HINT)}
			</p>
			{error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
			{/* A value that is not a colour yet is not an error — someone is
			    mid-paste. Say so quietly, and only once they have typed enough
			    that it cannot become valid. */}
			{!error && value.trim().length >= 7 && normalized === null ? (
				<p className="mt-1 text-xs text-destructive">
					{t(RestaurantsKeys.SETTINGS_BRANDING_COLOR_INVALID)}
				</p>
			) : null}
		</div>
	);
}

/**
 * Font picker as a `role="listbox"` popover.
 *
 * **Not a `<select>`.** Setting `font-family` on an `<option>` is ignored on
 * iOS and Android, which renders the whole list in one system face — so the
 * one thing a font picker exists to show, what the font looks like, is exactly
 * what a native select cannot show on the devices most managers use.
 */
function FontPicker({
	value,
	onChange,
}: Readonly<{ value: FontChoice; onChange: (next: FontChoice) => void }>) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const labelId = useId();

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const options: readonly { id: FontChoice; label: string; stack: string }[] = [
		{ id: null, label: t(RestaurantsKeys.SETTINGS_BRANDING_FONT_SYSTEM), stack: SYSTEM_FONT_STACK },
		...BRAND_FONT_IDS.map((id) => ({
			id: id as FontChoice,
			label: BRAND_FONTS[id].label,
			stack: BRAND_FONTS[id].stack,
		})),
	];
	const selected = options.find((option) => option.id === value) ?? options[0];

	return (
		<div ref={containerRef} className="relative">
			<span id={labelId} className="block text-sm font-medium mb-1 text-foreground">
				{t(RestaurantsKeys.SETTINGS_BRANDING_FONT_LABEL)}
			</span>
			<button
				type="button"
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-labelledby={labelId}
				onClick={() => setOpen((previous) => !previous)}
				className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-input px-3 py-2 text-left"
			>
				<span className="min-w-0">
					<span className="block text-sm text-foreground">{selected.label}</span>
					{/* The sample carries an accented character and a price on
					    purpose: those are what differ between these faces on a real
					    menu, and "The quick brown fox" shows neither. */}
					<span
						className="block truncate text-xs text-muted-foreground"
						style={{ fontFamily: selected.stack }}
					>
						{t(RestaurantsKeys.SETTINGS_BRANDING_FONT_SAMPLE)}
					</span>
				</span>
				<ChevronDown size={16} className="shrink-0 text-faint-foreground" aria-hidden />
			</button>

			{open ? (
				<ul
					role="listbox"
					aria-labelledby={labelId}
					className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg"
				>
					{options.map((option) => (
						<li key={option.id ?? "system"}>
							<button
								type="button"
								role="option"
								aria-selected={option.id === value}
								onClick={() => {
									onChange(option.id);
									setOpen(false);
								}}
								className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-(--bg-hover)"
							>
								<span className="min-w-0">
									<span className="block text-sm text-foreground">{option.label}</span>
									<span
										className="block truncate text-xs text-muted-foreground"
										style={{ fontFamily: option.stack }}
									>
										{t(RestaurantsKeys.SETTINGS_BRANDING_FONT_SAMPLE)}
									</span>
								</span>
								{option.id === value ? (
									<Check size={15} className="shrink-0 text-foreground" aria-hidden />
								) : null}
							</button>
						</li>
					))}
				</ul>
			) : null}
			<p className="mt-1 text-xs text-faint-foreground">
				{t(RestaurantsKeys.SETTINGS_BRANDING_FONT_HINT)}
			</p>
		</div>
	);
}
