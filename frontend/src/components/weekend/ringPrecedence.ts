/**
 * The "consent supersedes shared" precedence rule, shared between
 * `LodgingUnitCard.tsx`'s `ringState` and `LodgingMap.tsx`'s `halo`
 * (kindred#2136) — both sites independently encoded the identical ordering,
 * and nothing kept them in sync.
 *
 * DELIBERATELY its own leaf module — not exported from
 * `frontend/src/components/weekend/index.ts`. That barrel is claimed by
 * #2080, #2078 and PR #2169; adding an export there would serialise this
 * refactor behind all three for no benefit. Nor does it live in
 * `boardLayout.ts`: `LodgingMap.tsx` does not import that module today, and
 * routing this helper through it would add a new static import edge. See
 * `mapColors.ts`'s header for the same shape of constraint — a module the
 * map imports has to stay light enough that `WeekendLegendButton`'s eager
 * mount (kindred#2057) never drags the map's lazy chunk into the eager
 * bundle. `WeekendRosterPage.chunkGraph.test.ts` is the real `vite build`
 * that catches a regression here.
 *
 * ONLY the precedence is shared. The two callers' inputs are deliberately
 * different — the card's `consent` is one slot's `ConsentFlag | null` and
 * its `shared` is `parties.length > 1`; the map's `flagged` is a COUNT of
 * cluster members with `consent !== null` and its `shared` is
 * `!many && first.parties.length > 1`, so a multi-room cluster is never
 * "shared". Each caller keeps deriving its own booleans and keeps rendering
 * its own way (Tailwind classes vs. an inline `boxShadow`) — this function
 * knows nothing about either.
 */

export interface RingPrecedenceInputs {
  /**
   * OPTIONAL, because a caller can have no placement affordance to speak of.
   *
   * `LodgingMap` is that caller (kindred#2183): the owner ruled the weekend
   * map a reference surface — "staff have informed me they will only be
   * looking at the map as a data point and not bunking on it" — so it omits
   * this rather than passing a hard-coded `false` under a comment explaining
   * that it can only ever be false. An omission is the same verdict with none
   * of the reading-as-unfinished-wiring.
   */
  dropTarget?: boolean
  consentFlagged: boolean
  shared: boolean
}

export type RingState = 'dropTarget' | 'consentFlagged' | 'shared' | 'plain'

/**
 * Highest wins, and every check assumes every state above it false:
 *   1. an active drop target — the placement affordance has to read clearly
 *      even over a flagged or shared room. Absent on the map, which is a
 *      reference surface with no placement at all (kindred#2183).
 *   2. the consent flag (#1926) — a household sharing without having agreed
 *      to.
 *   3. two or more families sharing without a flag.
 *   4. plain — none of the above.
 */
export function resolveRingPrecedence({
  dropTarget,
  consentFlagged,
  shared,
}: RingPrecedenceInputs): RingState {
  if (dropTarget) return 'dropTarget'
  if (consentFlagged) return 'consentFlagged'
  if (shared) return 'shared'
  return 'plain'
}
