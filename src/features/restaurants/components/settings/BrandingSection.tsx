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
import {
	SettingsRow,
	settingsInputClass,
} from "@/features/restaurants/components/settings/SettingsRow";
import { SettingsSection } from "@/features/restaurants/components/settings/SettingsSection";
import { SettingsSectionFooter } from "@/features/restaurants/components/settings/SettingsSectionFooter";
import type { RestaurantSettingsSectionProps } from "@/features/restaurants/components/settings/types";
import { Drawer } from "@/global/components";
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
import { Check, ChevronDown, Eye, X } from "lucide-react";
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
	/** Narrow-container preview only; the wide layout shows the panes inline. */
	const [previewOpen, setPreviewOpen] = useState(false);

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
				{/*
				 * Live preview. A form of hex values says nothing about whether the
				 * menu looks good, and the per-mode adjustment is invisible until you
				 * see both panes. Where the section is wide it rides beside the rows;
				 * where it is not, the panes (fixed at a phone's 360px on purpose)
				 * cannot fit next to anything, so they open in a drawer instead.
				 */}
				<div className="mb-4 @3xl:hidden">
					<button
						type="button"
						data-testid="branding-preview-open"
						aria-haspopup="dialog"
						aria-expanded={previewOpen}
						onClick={() => setPreviewOpen(true)}
						className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-(--bg-hover)"
					>
						<Eye size={14} aria-hidden />
						{t(RestaurantsKeys.SETTINGS_BRANDING_PREVIEW_HEADING)}
					</button>
				</div>

				<div className="@3xl:grid @3xl:grid-cols-[minmax(0,1fr)_22.5rem] @3xl:items-start @3xl:gap-8">
					{/* Its own container: beside the preview the rows get well under
					    the section's width, and should stack by *their* width. */}
					<div className="@container min-w-0">
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

						<SettingsRow label={t(RestaurantsKeys.SETTINGS_BRANDING_LOGO_LABEL)}>
							<BrandingImageUploader
								restaurantId={restaurant._id}
								slot="logo"
								label={t(RestaurantsKeys.SETTINGS_BRANDING_LOGO_LABEL)}
								labelHidden
								hint={t(RestaurantsKeys.SETTINGS_BRANDING_LOGO_HINT)}
								image={images?.logo}
								onChanged={() => void refetchImages()}
							/>
						</SettingsRow>

						<SettingsRow label={t(RestaurantsKeys.SETTINGS_BRANDING_HEADER_LABEL)}>
							<div className="space-y-4">
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
						</SettingsRow>
					</div>

					{/* The column is 22.5rem because each pane is a real 360px phone
					    column — see `BrandingPreviewPane` for why it is never scaled. */}
					<aside className="hidden @3xl:sticky @3xl:top-4 @3xl:block space-y-2">
						<p className="text-sm font-medium text-foreground">
							{t(RestaurantsKeys.SETTINGS_BRANDING_PREVIEW_HEADING)}
						</p>
						<form.Subscribe
							selector={(state) =>
								[state.values.brandingColor, state.values.brandingFontId] as const
							}
							children={([colorValue, fontValue]) => (
								<BrandingPreviewPanes
									colorValue={colorValue}
									fontValue={fontValue}
									restaurantName={restaurant.name}
								/>
							)}
						/>
					</aside>
				</div>

				{/* Full width on a phone — the panes are phone-sized, so anything
				    narrower would clip the very layout being previewed. */}
				<Drawer
					isOpen={previewOpen}
					onClose={() => setPreviewOpen(false)}
					side="right"
					size="min(25rem, 100vw)"
					ariaLabel={t(RestaurantsKeys.SETTINGS_BRANDING_PREVIEW_HEADING)}
				>
					<div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
						<p className="text-sm font-semibold text-foreground">
							{t(RestaurantsKeys.SETTINGS_BRANDING_PREVIEW_HEADING)}
						</p>
						<button
							type="button"
							onClick={() => setPreviewOpen(false)}
							aria-label={t(RestaurantsKeys.SETTINGS_BRANDING_PREVIEW_CLOSE)}
							className="rounded-lg p-1.5 text-faint-foreground hover:bg-(--bg-hover) hover:text-foreground"
						>
							<X size={16} aria-hidden />
						</button>
					</div>
					<div className="min-h-0 flex-1 overflow-auto p-4">
						<form.Subscribe
							selector={(state) =>
								[state.values.brandingColor, state.values.brandingFontId] as const
							}
							children={([colorValue, fontValue]) => (
								<BrandingPreviewPanes
									colorValue={colorValue}
									fontValue={fontValue}
									restaurantName={restaurant.name}
								/>
							)}
						/>
					</div>
				</Drawer>
			</SettingsSection>
		</form>
	);
}

/** Both modes, stacked — the column and the drawer are each one pane wide. */
function BrandingPreviewPanes({
	colorValue,
	fontValue,
	restaurantName,
}: Readonly<{ colorValue: string; fontValue: FontChoice; restaurantName: string }>) {
	const normalized = normalizeBrandColor(colorValue);
	const fontStack = fontValue ? brandFontStack(fontValue) : SYSTEM_FONT_STACK;
	return (
		<div className="space-y-4">
			<BrandingPreviewPane
				brandColor={normalized}
				mode="light"
				fontStack={fontStack}
				restaurantName={restaurantName}
			/>
			<BrandingPreviewPane
				brandColor={normalized}
				mode="dark"
				fontStack={fontStack}
				restaurantName={restaurantName}
			/>
		</div>
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
		<SettingsRow label={t(RestaurantsKeys.SETTINGS_BRANDING_COLOR_LABEL)} htmlFor={inputId}>
			<div className="flex max-w-md items-center gap-2">
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
					className={settingsInputClass("w-full min-w-0", Boolean(error))}
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
			{/* How to fill it, and long — guidance stays under the control. */}
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
		</SettingsRow>
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
		// The row's label is a plain paragraph here, not a <label>: the control is
		// a button + listbox, which take their name from `aria-labelledby`.
		<SettingsRow
			label={<span id={labelId}>{t(RestaurantsKeys.SETTINGS_BRANDING_FONT_LABEL)}</span>}
			hint={t(RestaurantsKeys.SETTINGS_BRANDING_FONT_HINT)}
		>
			<div ref={containerRef} className="relative max-w-md">
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
			</div>
		</SettingsRow>
	);
}
