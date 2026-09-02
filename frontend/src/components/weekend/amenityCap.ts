/**
 * Capping the unit card's amenity row at 3 icons — kindred#2327 follow-up.
 *
 * Ruled by the owner across two measured mockup rounds
 * (`docs/plans/2026-08-31-mockup-icon-crowding.html`, LOCAL ONLY — "Option
 * C"): the row shows at most 3 marks, always, in priority order, with no
 * "+N" chip (measured to eat back exactly the space the cap saved and
 * re-break `LodgingUnitCard.tsx`'s own T2 failure — two lettered cabins,
 * `Willow Downstairs A` / `Willow Downstairs B`, truncating to the identical
 * illegible prefix at the board's 280–292px column band).
 *
 * A `.ts` module holding a truth table, testable without rendering a card —
 * the same shape `needGlyphs.ts` and `ringPrecedence` take.
 */

/** Every mark this row can draw, keyed the way the card's own `data-testid`s are. */
export type AmenityMarkKey =
  'bathroom' | 'power' | 'ac' | 'fridge' | 'heat' | 'not-weatherized' | 'step-free'

/**
 * Highest priority first; AC is still first to give way — the owner's
 * corrected order (mockup's `correction-box`), which replaced this file's
 * own first pass verbatim. Two deliberate departures from that first pass:
 * NOT-WEATHERIZED drops from 2nd to 6th, and FRIDGE and HEAT rise. Staff's
 * stated focus is bathroom, power, fridge — the head of this order, and it
 * matches the post-ruling misfit-hatch set (kindred#2432/#2093) exactly:
 * those are the only three needs the board's own hatch still grades.
 */
export const AMENITY_PRIORITY: readonly AmenityMarkKey[] = [
  'bathroom',
  'power',
  'fridge',
  'heat',
  'step-free',
  'not-weatherized',
  'ac',
]

/** The ruled cap. Never a chip, never an overflow count — see the module doc. */
export const AMENITY_CAP = 3

/** One mark, carrying whatever the caller needs alongside its priority key. */
export interface AmenityMark<T> {
  readonly key: AmenityMarkKey
  readonly node: T
}

export interface AmenityCapResult<T> {
  /** At most `AMENITY_CAP` marks, in the SAME order `marks` arrived in — never priority order. */
  readonly visible: ReadonlyArray<AmenityMark<T>>
  /** The marks the cap dropped, in their original order. Empty whenever `marks.length <= AMENITY_CAP`. */
  readonly overflow: ReadonlyArray<AmenityMark<T>>
}

/**
 * Keeps the top `AMENITY_CAP` marks by `AMENITY_PRIORITY`, returned in
 * RENDER order (the order `marks` was given in) — never priority order — so
 * a capped card's icons sit exactly where they would among the full set.
 *
 * A no-op below the cap: `marks.length <= AMENITY_CAP` returns every mark as
 * `visible` and an empty `overflow`, so a card with 3 or fewer marks renders
 * identically to before this module existed.
 */
export function capAmenityMarks<T>(marks: ReadonlyArray<AmenityMark<T>>): AmenityCapResult<T> {
  if (marks.length <= AMENITY_CAP) {
    return { visible: marks, overflow: [] }
  }
  const rank = new Map(AMENITY_PRIORITY.map((key, index) => [key, index]))
  const keep = new Set(
    [...marks]
      .sort(
        (a, b) =>
          (rank.get(a.key) ?? Number.POSITIVE_INFINITY) -
          (rank.get(b.key) ?? Number.POSITIVE_INFINITY)
      )
      .slice(0, AMENITY_CAP)
      .map((mark) => mark.key)
  )
  return {
    visible: marks.filter((mark) => keep.has(mark.key)),
    overflow: marks.filter((mark) => !keep.has(mark.key)),
  }
}
