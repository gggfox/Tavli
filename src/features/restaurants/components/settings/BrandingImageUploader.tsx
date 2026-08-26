/**
 * One branding image slot (TAVLI-96).
 *
 * **Not a form field.** It uploads the moment a file is picked, on its own
 * button, and the section's Save governs only the colour and the font. That
 * split is deliberate: the bytes go through an action, not through
 * `restaurants.update`, so there is nothing for Save to submit — and a
 * file-input that *looked* like part of the form would leave a manager
 * believing their unsaved logo was pending when it had already shipped, or
 * that Save would send it when Save has no idea it exists.
 */
import { RestaurantsKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { useConvexAction } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { BRANDING_SLOT_SPECS, type BrandingImageSlot } from "convex/brandingImageHelpers";
import { ImageOff, Loader2, Trash2, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { encodeBrandingImage } from "@/features/restaurants/utils/brandingImageEncode";

interface BrandingImageUploaderProps {
	readonly restaurantId: Id<"restaurants">;
	readonly slot: BrandingImageSlot;
	readonly label: string;
	readonly hint?: string;
	readonly image: { url: string; width: number; height: number } | undefined;
	/** Slots this upload should also populate, encoded from the same source. */
	readonly alsoFill?: readonly BrandingImageSlot[];
	readonly onChanged: () => void;
}

export function BrandingImageUploader({
	restaurantId,
	slot,
	label,
	hint,
	image,
	alsoFill,
	onChanged,
}: Readonly<BrandingImageUploaderProps>) {
	const { t } = useTranslation();
	const inputId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const setBrandingImage = useConvexAction(api.branding.setBrandingImage);
	const clearBrandingImage = useConvexAction(api.branding.clearBrandingImage);

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const spec = BRANDING_SLOT_SPECS[slot];

	const handleFile = async (file: File) => {
		setBusy(true);
		setError(null);
		try {
			// One picked file fans out to every slot it feeds. Encoding happens
			// per slot rather than resizing one output, so each breakpoint is
			// drawn from the full-resolution source and none of them inherits
			// another's compression artefacts.
			for (const target of [slot, ...(alsoFill ?? [])]) {
				const encoded = await encodeBrandingImage(file, target);
				if (!encoded.ok) {
					setError(
						t(
							encoded.failure.reason === "tooLargeAtLowestQuality"
								? RestaurantsKeys.SETTINGS_BRANDING_TOO_LARGE
								: RestaurantsKeys.SETTINGS_BRANDING_ENCODE_FAILED
						)
					);
					return;
				}
				await setBrandingImage({ restaurantId, slot: target, bytes: encoded.bytes });
			}
			onChanged();
		} catch (err) {
			setError(getErrorMessage(err, t, RestaurantsKeys.SETTINGS_BRANDING_ENCODE_FAILED));
		} finally {
			setBusy(false);
			// Clear the input so picking the *same* file again still fires
			// `change` — otherwise a manager who fixes their crop and re-picks
			// the identical filename gets no response at all.
			if (inputRef.current) inputRef.current.value = "";
		}
	};

	const handleRemove = async () => {
		setBusy(true);
		setError(null);
		try {
			for (const target of [slot, ...(alsoFill ?? [])]) {
				await clearBrandingImage({ restaurantId, slot: target });
			}
			onChanged();
		} catch (err) {
			setError(getErrorMessage(err, t, RestaurantsKeys.SETTINGS_BRANDING_ENCODE_FAILED));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="space-y-2">
			<div className="flex items-baseline justify-between gap-2">
				<label htmlFor={inputId} className="text-sm font-medium text-foreground">
					{label}
				</label>
				<span className="text-[11px] tabular-nums text-faint-foreground">
					{spec.width}×{spec.height}
				</span>
			</div>
			{hint ? <p className="text-xs text-faint-foreground">{hint}</p> : null}

			<div className="flex items-center gap-3">
				<div className="h-16 w-28 shrink-0 rounded-lg border border-border bg-muted overflow-hidden flex items-center justify-center">
					{image ? (
						// Explicit width/height even at thumbnail size: preflight's
						// `img { height: auto }` means an image with no intrinsic size
						// collapses then jumps when it decodes.
						<img
							src={image.url}
							alt=""
							width={image.width}
							height={image.height}
							className={
								slot === "logo"
									? "max-h-full max-w-full object-contain"
									: "h-full w-full object-cover"
							}
						/>
					) : (
						<ImageOff size={16} className="text-faint-foreground" aria-hidden />
					)}
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<input
						ref={inputRef}
						id={inputId}
						type="file"
						accept="image/*"
						className="sr-only"
						disabled={busy}
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) void handleFile(file);
						}}
					/>
					<button
						type="button"
						disabled={busy}
						onClick={() => inputRef.current?.click()}
						className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium hover-btn-primary disabled:opacity-50"
					>
						{busy ? (
							<>
								<Loader2 size={13} className="animate-spin" />
								{t(RestaurantsKeys.SETTINGS_BRANDING_UPLOADING)}
							</>
						) : (
							<>
								<Upload size={13} />
								{t(
									image
										? RestaurantsKeys.SETTINGS_BRANDING_REPLACE
										: RestaurantsKeys.SETTINGS_BRANDING_UPLOAD
								)}
							</>
						)}
					</button>
					{image ? (
						<button
							type="button"
							disabled={busy}
							onClick={() => void handleRemove()}
							className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-(--bg-hover) disabled:opacity-50"
						>
							<Trash2 size={13} />
							{t(RestaurantsKeys.SETTINGS_BRANDING_REMOVE)}
						</button>
					) : (
						<span className="text-xs text-faint-foreground">
							{t(RestaurantsKeys.SETTINGS_BRANDING_NO_IMAGE)}
						</span>
					)}
				</div>
			</div>

			{error ? <p className="text-xs text-destructive">{error}</p> : null}
		</div>
	);
}
