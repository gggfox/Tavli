import type { CSSProperties } from "react";

/**
 * Shared-element names for the list row → canvas morph (settings and the
 * tables canvas). The row and the canvas that replaces it carry the same
 * names, so the browser animates one into the other; the route opts in with
 * `navigate({ viewTransition: true })`. Styling lives in
 * `src/global/styles/view-transitions.css`, keyed on the classes below.
 *
 * Each name must be unique on the page, hence the restaurant id.
 */
export function restaurantCardTransition(id: string): CSSProperties {
	return { viewTransitionName: `restaurant-card-${id}`, viewTransitionClass: "restaurant-card" };
}

export function restaurantTitleTransition(id: string): CSSProperties {
	return { viewTransitionName: `restaurant-title-${id}`, viewTransitionClass: "restaurant-title" };
}
