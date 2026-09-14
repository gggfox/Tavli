/**
 * Height reserved for the diner menu's sticky search + pills bar, in px.
 *
 * Two places must agree on this number or the pills lie. The section headings
 * use it as `scroll-margin-top`, so a jump parks a heading *under* the bar
 * rather than behind it; the pills use it to decide which section is current,
 * measuring from the edge just below the bar rather than from the scroll
 * container's own top — otherwise a heading a jump has just parked flush under
 * the bar reads as "not reached yet" and the previous pill stays lit.
 */
export const STICKY_BAR_HEIGHT_PX = 104;
