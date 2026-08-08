/**
 * Colour tokens shared between the lodging map's own marks and the
 * weekend's Visual Guide (kindred#1997 code review).
 *
 * DELIBERATELY its own leaf module — not exported from `LodgingMap.tsx` or
 * `MapUnitPopover.tsx` — because `BunkingLegend.tsx`'s `WeekendLegendButton`
 * mounts unconditionally in the weekend header, and importing either of
 * those would drag `LodgingMap`'s lazy chunk into the eager bundle, exactly
 * what `WeekendRosterPage.chunkGraph.test.ts` exists to catch (kindred#2057).
 * A module holding nothing but string constants carries no such risk, and
 * gives the map, the popover and the Guide one source of truth instead of
 * three copies that only happen to agree today.
 */

/** The bathhouse dot. Blue, and not one of the eight area hues. */
export const BATHHOUSE_BLUE = '#2563eb'

/**
 * #1926's consent-flag ring — amber, superseding the shared-room ring
 * wherever a placement's sharing was never consented to.
 */
export const CONSENT_AMBER = '#fbbf24'
