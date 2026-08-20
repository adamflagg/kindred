/**
 * The "a drop target supersedes a consent flag" precedence rule, shared
 * between `LodgingUnitCard.tsx`'s `ringState` and `LodgingMap.tsx`'s `halo`
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
 * different — the card's `consentFlagged` is one slot's `ConsentFlag | null`
 * tested for presence, the map's is a COUNT of cluster members with
 * `consent !== null`. Each caller keeps deriving its own booleans and keeps
 * rendering its own way (Tailwind classes vs. an inline `boxShadow`) — this
 * function knows nothing about either.
 *
 * ⚠️ THERE WAS A THIRD TIER AND IT IS STRUCK (kindred#2179, owner ruling
 * 2026-08-09). "Two or more families in this space" drew a ring in the area
 * hue below the consent flag. It fired on the units DESIGNED to hold several
 * families — the dormitory- and village-style accommodations that hold
 * several parties every weekend by construction — so it was on almost all the
 * time, and a constant is not a signal. Nothing replaced it: not a subtler
 * ring, not a fixed hue, not a smaller dot.
 *
 * Striking it lost nothing, because `consentFlagged` already outranked it:
 * every share worth an alarm was already being caught one tier up.
 *
 * ⚠️ THE ONE NARROW SURVIVOR OF THAT CUT IS NOW STRUCK TOO. A second party in
 * a unit classified `single_party` was a CHIP in the card's badge row
 * (`unitBadges.ts`'s `sharingConflictBadge`), on a channel of its own —
 * kindred#2072 removed it, because it never fired: all 23 room-sharing cards
 * in the registry are classified `shareable`.
 *
 * So the board now marks a shared space in NO way at all, deliberately, and
 * this table is the place a future session would most naturally put one back.
 * Do not — not as a ring, not as a tint, not as a dot. It takes a ruling.
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
}

export type RingState = 'dropTarget' | 'consentFlagged' | 'plain'

/**
 * Highest wins, and every check assumes every state above it false:
 *   1. an active drop target — the placement affordance has to read clearly
 *      even over a flagged room. Absent on the map, which is a reference
 *      surface with no placement at all (kindred#2183).
 *   2. the consent flag (#1926) — a household sharing without having agreed
 *      to.
 *   3. plain — neither of the above.
 */
export function resolveRingPrecedence({
  dropTarget,
  consentFlagged,
}: RingPrecedenceInputs): RingState {
  if (dropTarget) return 'dropTarget'
  if (consentFlagged) return 'consentFlagged'
  return 'plain'
}
