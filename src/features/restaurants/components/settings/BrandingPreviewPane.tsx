/**
 * One mode's live preview pane for the branding settings section (TAVLI-88).
 *
 * ## This is the exact inverse of the SSR injector, and that is the trap
 *
 * On a `/r/` page the brand tokens are injected at `:root`, because `@theme`
 * compiles to `:root { --color-primary: var(--btn-primary-bg) }` and custom
 * properties substitute on the element carrying the declaration — an override
 * on a wrapper `<div>` retints `hover-btn-primary` and inline `var()` styles
 * but leaves every `bg-primary` utility on platform blue.
 *
 * This pane lives *inside the dashboard*, so it cannot touch `:root`. It has
 * to be scoped. Which means it hits precisely the failure the injector avoids:
 * a scoped wrapper that sets only `--btn-primary-bg` produces a preview that
 * **lies** — the manager sees a half-branded card and ships a colour they
 * never really looked at.
 *
 * The fix is to set *both* token layers as concrete hexes on the wrapper:
 * `--btn-primary-*` for the raw `var()` consumers, and `--color-primary*` for
 * the Tailwind utilities. Concrete hexes rather than `var()` chains, because a
 * `--color-primary: var(--btn-primary-bg)` inside the wrapper would resolve
 * against the wrapper and work, while the equivalent at `:root` would not —
 * two different resolution paths for the same design is how the preview and
 * the real page drift apart.
 *
 * The pane also carries `.light` / `.dark` so every *other* token (surfaces,
 * text, borders) comes from the right palette regardless of the dashboard's
 * own mode. `theme.css` grew `:root, .light` for this.
 */
import { RestaurantsKeys } from "@/global/i18n";
import { deriveBrandTokens, type BrandMode } from "convex/_shared/brandColor";
import { useTranslation } from "react-i18next";

interface BrandingPreviewPaneProps {
	/** Canonical `#rrggbb`, or null to preview the platform default. */
	readonly brandColor: string | null;
	readonly mode: BrandMode;
	/** Resolved `--font-body` stack for the chosen face. */
	readonly fontStack: string;
	readonly restaurantName: string;
}

/** Platform defaults, so a cleared brand colour previews as what diners get. */
const PLATFORM = {
	light: { bg: "#2383e2", hover: "#0b6bcb", text: "#ffffff", ring: "#2383e2" },
	dark: { bg: "#2383e2", hover: "#4b9fe8", text: "#ffffff", ring: "#2383e2" },
} as const;

export function BrandingPreviewPane({
	brandColor,
	mode,
	fontStack,
	restaurantName,
}: Readonly<BrandingPreviewPaneProps>) {
	const { t } = useTranslation();
	const derived = brandColor ? deriveBrandTokens(brandColor, mode) : null;
	const tokens = derived ?? PLATFORM[mode];
	const adjusted = derived?.adjusted ?? false;

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium text-muted-foreground">
					{t(
						mode === "light"
							? RestaurantsKeys.SETTINGS_BRANDING_PREVIEW_LIGHT
							: RestaurantsKeys.SETTINGS_BRANDING_PREVIEW_DARK
					)}
				</span>
				{derived ? (
					<span className="text-[11px] tabular-nums text-faint-foreground">
						{t(RestaurantsKeys.SETTINGS_BRANDING_RATIO_LABEL, {
							ratio: derived.labelRatio.toFixed(1),
						})}
					</span>
				) : null}
			</div>

			{/*
			 * A real 360px column, not `transform: scale()` on a wider one.
			 * Scaling shrinks the *rendered* result, so text that would wrap on a
			 * phone does not wrap here and the manager approves a layout that
			 * does not exist. At this width the preview breaks where the phone
			 * breaks.
			 */}
			<div
				className={mode === "light" ? "light" : "dark"}
				data-testid={`branding-preview-${mode}`}
				style={
					{
						// Layer 1: the raw tokens that `hover-btn-primary` and inline
						// `var(--btn-primary-bg)` styles read.
						"--btn-primary-bg": tokens.bg,
						"--btn-primary-hover": tokens.hover,
						"--btn-primary-text": tokens.text,
						"--focus-ring": tokens.ring,
						"--input-border-focus": tokens.bg,
						// Layer 2: the Tailwind aliases. Without these, every
						// `bg-primary` / `text-primary-foreground` utility inside this
						// pane keeps resolving against `:root` and paints platform
						// blue — a preview that is ~70% branded and 100% misleading.
						"--color-primary": tokens.bg,
						"--color-primary-hover": tokens.hover,
						"--color-primary-foreground": tokens.text,
						"--font-body": fontStack,
						width: "360px",
						fontFamily: fontStack,
					} as React.CSSProperties
				}
			>
				<div className="rounded-xl border border-border bg-background overflow-hidden">
					<div className="px-4 py-3 border-b border-border">
						<p className="text-sm font-semibold text-foreground truncate">{restaurantName}</p>
					</div>
					<div className="p-4 space-y-3 bg-tertiary">
						{/*
						 * Deliberately a `bg-primary` utility and not an inline style:
						 * this element is the canary. If the Tailwind alias layer above
						 * were dropped, everything else in this pane would still look
						 * branded and this one badge would quietly stay platform blue —
						 * which is exactly the bug shape on the real page.
						 */}
						<div className="flex items-center gap-2">
							<span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-bold">
								2
							</span>
							<span className="text-xs text-muted-foreground">
								{t(RestaurantsKeys.SETTINGS_BRANDING_FONT_SAMPLE)}
							</span>
						</div>
						<button
							type="button"
							tabIndex={-1}
							className="w-full py-2.5 rounded-xl text-sm font-semibold"
							style={{ backgroundColor: tokens.bg, color: tokens.text }}
						>
							{t(RestaurantsKeys.SETTINGS_BRANDING_PREVIEW_CTA)}
						</button>
						<button
							type="button"
							tabIndex={-1}
							className="w-full py-2 rounded-xl text-sm font-medium border border-border text-foreground"
						>
							{t(RestaurantsKeys.SETTINGS_BRANDING_PREVIEW_SECONDARY)}
						</button>
					</div>
				</div>
			</div>

			{/*
			 * Shown only when the derivation moved the colour. A manager who
			 * pastes a navy and sees a lighter navy on the dark preview needs to
			 * know it was deliberate — otherwise the obvious conclusion is that
			 * we got their brand colour wrong.
			 */}
			{adjusted && brandColor ? (
				<div className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2">
					<span
						className="mt-0.5 h-4 w-4 shrink-0 rounded border border-border"
						style={{ backgroundColor: brandColor }}
						aria-hidden
					/>
					<span
						className="mt-0.5 h-4 w-4 shrink-0 rounded border border-border"
						style={{ backgroundColor: tokens.bg }}
						aria-hidden
					/>
					<p className="text-[11px] leading-snug text-muted-foreground">
						<span className="font-medium text-foreground">
							{t(RestaurantsKeys.SETTINGS_BRANDING_ADJUSTED_TITLE)}
						</span>{" "}
						{t(
							mode === "light"
								? RestaurantsKeys.SETTINGS_BRANDING_ADJUSTED_LIGHT
								: RestaurantsKeys.SETTINGS_BRANDING_ADJUSTED_DARK
						)}
					</p>
				</div>
			) : null}
		</div>
	);
}
