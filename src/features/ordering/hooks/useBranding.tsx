/**
 * The restaurant's branding, as resolved by the `/r/$slug` loader (TAVLI-97).
 *
 * ## Why a context and not a router hook
 *
 * The obvious implementation reads the route match directly
 * (`useMatch({ from: "/r/$slug" })`). It works on the customer tree and breaks
 * everywhere else: `StripePaymentSection` is shared, and a router hook makes
 * every component that mounts it require a router in scope — including the
 * ones that legitimately render without one. `shouldThrow: false` does not
 * help, because the absent thing is the *router*, not the match.
 *
 * A context has the shape the problem actually has: inside the customer tree
 * there is branding, outside it there is not, and "outside" is an ordinary
 * `null` rather than an exception.
 *
 * ## Why not a live query
 *
 * The value is **stable for the life of the page**, and that is load-bearing:
 * it goes into an `<Elements key>`, and Elements reads its appearance once at
 * mount. A subscription would let a manager saving a new colour remount
 * Elements under a diner who is mid-payment — discarding the card details they
 * had already typed.
 */
import type { PublicBranding } from "convex/brandingHelpers";
import { createContext, useContext, type ReactNode } from "react";

const BrandingContext = createContext<PublicBranding | null>(null);

export function BrandingProvider({
	branding,
	children,
}: Readonly<{ branding: PublicBranding | null; children: ReactNode }>) {
	return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

/** The branding for the current restaurant, or `null` outside the `/r/` tree. */
export function useBranding(): PublicBranding | null {
	return useContext(BrandingContext);
}

/** The restaurant's brand colour, or `null` for the platform palette. */
export function useBrandColor(): string | null {
	return useBranding()?.color ?? null;
}
