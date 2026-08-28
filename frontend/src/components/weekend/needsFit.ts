/**
 * Does this space meet the dragged family's needs? — kindred#1912.
 *
 * ADVISORY. It is not a blocker, and it must never become one: the board
 * accepts every drop on purpose (see `LodgingUnitCard`'s comment on the party
 * `useDroppable`) — not because a cabin is unconfirmed (measured against the
 * production snapshot of 2026-08-06, cabins were 118/118 confirmed) but
 * because staff routinely place families against the machine's opinion, and
 * are right to. This says "nothing here has power", never "you may not".
 *
 * That distinction is carried by the MECHANISM, not only by the wording, and
 * the board's signal vocabulary (owner ruling, 2026-08-09) is what keeps the
 * two apart:
 *
 *   dim  (`opacity-40` + `pointer-events-none`) = REFUSAL. Owned by the
 *        invalid merge target, and by that alone since kindred#2432 struck
 *        the written-into space's refusal (#2087/#2090). Not this.
 *   hatch (`background-image`, at FULL strength)= ADVISORY MISFIT. This.
 *   forest tint (`background-color`)             = open and available at rest
 *        (#2093) — AND, since 2026-08-21, the drag-time match at double
 *        strength. One channel, three exclusive states.
 *
 * So the marks this feeds are `background-image` for the negative and
 * `background-color` for the positive; the module header used to say
 * `background-image` and nothing else, which stopped being true when the
 * mark grew a positive half. Putting
 * fit on opacity would have made it read as a weaker refusal rather than as a
 * different kind of statement, which is exactly the collapse the vocabulary
 * ruling exists to prevent.
 *
 * Pure, and in its own module rather than inside the card, for the same
 * reason `ringPrecedence` and `boardLayout` are: a rule with a truth table is
 * testable without rendering ~82 cards.
 */
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { partySize } from './boardLayout'
import { askedNeedGlyphs, needVerdict } from './needGlyphs'

/** Worst first. The order of this array IS the precedence. */
const FIT_ORDER = ['unmet', 'partial', 'fits'] as const

export type NeedsFit = (typeof FIT_ORDER)[number]

/**
 * The worse of two verdicts, by `FIT_ORDER`.
 *
 * Exported, and a named function rather than an inline comparison in the loop
 * below. It was written when the dimension table held exactly ONE entry, so the
 * loop could never run twice and no assertion made through the resolver
 * could distinguish "worst wins" from "the last dimension wins" — the
 * combining rule would otherwise have shipped untested, so it was pinned
 * directly. That table is `needGlyphs.NEED_GLYPHS` now and carries four, and
 * `resolveDragFit` below grades all four — the `HATCHED_NEEDS` subset that
 * once narrowed it to three is gone. The direct test stays, because it is the
 * one that still holds if the scope ever shrinks back to one.
 */
export function worseOf<T extends NeedsFit>(a: T, b: T): T {
  return FIT_ORDER.indexOf(a) <= FIT_ORDER.indexOf(b) ? a : b
}

/**
 * The drag-time state of one cabin, for one family in flight.
 *
 * THREE VALUES, NOT TWO, and they are mutually exclusive by TYPE rather than
 * by a rule somebody has to remember to apply. This mirrors
 * `LodgingUnitCard`'s `ringState`, which is the board's established shape for
 * "one winner among competing marks".
 *
 * The previous `resolveNeedsFit` returned a single `NeedsFit`, and the board
 * asked that one verdict to drive two marks pointing in opposite directions:
 * a hatch, which must not fire on absence of evidence, and a positive match,
 * which must not CLAIM on absence of evidence. No single reading of `unknown`
 * can serve both, which is why the state is resolved here instead.
 */
type DragFitState = 'conflict' | 'match' | 'neutral'

/**
 * A DISCRIMINATED UNION, so a conflict cannot carry `'fits'` and a match
 * cannot carry a severity that would draw a hatch. The exclusivity the design
 * asks for is enforced by the type rather than by a rule a caller has to
 * remember — which is the whole reason the three states were collapsed into
 * one value.
 *
 * `severity` is present on BOTH members deliberately, so `NEUTRAL` and the
 * card's at-rest value can be plain literals; it is the VALUE that is
 * constrained per member, not the key's presence.
 *
 * Severity is the hatch PERIOD and only the period (kindred#1912); grading
 * NONE from SOME on a second channel is the collapse that ruling struck.
 */
export type DragFit =
  | {
      readonly state: Extract<DragFitState, 'conflict'>
      readonly severity: Exclude<NeedsFit, 'fits'>
    }
  | { readonly state: Exclude<DragFitState, 'conflict'>; readonly severity: 'fits' }

/**
 * What the card already knows about its own beds, passed in rather than
 * re-derived.
 *
 * `known` is NOT simply `effectiveSleeps(...) !== null` any more
 * (kindred#2503). An unmeasured cabin is still one way to get `known:
 * false`, but a fully-measured cabin covered by a write-in withholds too,
 * unless EVERY cover on it is a fact — a recorded size, or an ancestor's
 * whole-card claim (the house was let whole, so a room inside it has no room
 * of its own to offer). A wholesale guess and a partly-sized card (some
 * covers recorded, one not) both withhold, the same as before this task.
 * See `LodgingUnitCard`'s `writeInKnown` for the caller that builds this
 * value, and `writeInDemand` (`writeIn.ts`) for the underlying rule.
 *
 * `free` is capacity minus placed occupants minus write-in consumption
 * (`capacity − occupants − writeInConsumed`, plus the dragged party's own
 * beds added back when it already occupies this card) and MAY BE NEGATIVE on
 * a card that is already over. The caller withholds this when `spanWidth > 0`,
 * where the occupant count is an upper bound rather than a fact — see
 * `slotOccupancy`.
 */
export interface DragCapacity {
  readonly known: boolean
  readonly free: number
}

/**
 * Exported for the ONE caller with a legitimate at-rest value —
 * `LodgingUnitCard` with no family in flight. Hand-rolling the literal there
 * would be the one place the three-state shape is still written by hand, in a
 * module that exists to stop that; and a shared constant is also a stable
 * identity, where a fresh object per card per render defeats memo equality.
 */
export const NEUTRAL: DragFit = { state: 'neutral', severity: 'fits' }

/**
 * Does this space have no room for this party?
 *
 * EXPORTED, and the single definition of the rule, because the board asks it
 * twice for two different marks: `resolveDragFit` below gates the match on it,
 * and `LodgingUnitCard` reddens the N/M figure with it. Those two used to be
 * separate inline expressions in separate modules with nothing tying them
 * together — they were edited in lockstep by hand once already (the write-in
 * rule), and a silent divergence was one forgotten edit away. Neither the type
 * checker nor any test would have caught it, because "the match wash and the
 * red figure agree about the same cabin" was nobody's assertion.
 *
 * `known: false` yields FALSE, not true. A count that is not a fact cannot
 * support the claim "you will not fit here" any more than it can support a
 * match — the caller withholds `known` for an unmeasured cabin, a straddling
 * party, and a write-in card where any cover is unsized — wholesale or only
 * partly sized (kindred#2503) — and all three mean the same thing here:
 * nothing to say.
 *
 * The boundary is `<`, so a party that exactly fills a cabin FITS.
 */
export function hasNoRoom(party: RosterPartyRow, capacity: DragCapacity): boolean {
  return capacity.known && capacity.free < partySize(party)
}

/**
 * Is this cabin a conflict, a match, or neither, for the family in flight?
 *
 * FOUR NEEDS, not three. The mark grades what the glyphs draw — the narrowed
 * `HATCHED_NEEDS` that left `bathroom` out is gone, and with it the argument
 * that a board hatched almost everywhere says nothing: that argument was about
 * a mark that could only ever be negative, and half of this one is positive.
 *
 * REAFFIRMED by the owner, 2026-08-21, with the production number on the
 * table: bathroom has no blank values in the registry (90 of 118 spaces are
 * `none`), so a bathroom-asking family hatches most of the board at once —
 * and that is the point: "all four booleans must match — the hatch fires on a
 * family that requests anything." An asymmetric reading (bathroom gates the
 * match but never hatches) was put to the owner in the same review and
 * REJECTED; do not reintroduce it as a tidy-up.
 *
 * THE PROSPECTIVE AXIS. Every need is graded as "would THIS cabin meet it?".
 * Only `bathroom` reads the argument at all, and on the old `'placed'` reading
 * it took `party.effective_bathroom` and ignored the target unit entirely —
 * a board-wide constant, every card or none, which cannot mean anything
 * per-card.
 *
 * THREE RULES, IN ORDER, and each is a decision with a number behind it:
 *
 * 1. A party that asks for NOTHING earns no match. Every cabin with room fits
 *    it, so a mark saying so carries nothing, and the board does not leave its
 *    resting state at all. 368 of 479 2026 registrations ask no housing need.
 *
 * 2. UNRECORDED COVERAGE MAKES NEITHER CLAIM. Not a conflict, because the
 *    hatch is an interruption and its bar is evidence of absence; not a match,
 *    because a positive mark is a claim and the 2026-08-20 ruling says
 *    unconfirmed information must not read as met. `has_ramp` is the only
 *    registry field that carries one: 104 of 118 units hold a blank raw
 *    `has_ramp`, of which 102 are still `unknown` once `ramp_coverage` has
 *    walked the leaves — a few blank containers have rooms that answer for
 *    them. Quote 102 wherever the figure feeds the hatched-pairs arithmetic
 *    (`weekend-card-vocabulary.md`), 104 for the raw assessment gap. This
 *    reads the RESOLVED value, so 102 is the number that reaches here.
 *
 *    ⚠️ kindred#2526 DID NOT REMOVE THIS BRANCH, which this paragraph used to
 *    forecast it might. It removed one SOURCE of `unknown` — "nobody has
 *    reconfirmed this cabin" — and left two live: a blank `has_ramp`, which
 *    is the 102 above and is `has_ramp`'s own question (kindred#2327), and an
 *    empty aggregation, where a container has no active leaf to answer at
 *    all. The branch is as reachable as it ever was.
 *
 * 3. CAPACITY GATES THE MATCH AND NEVER CAUSES A CONFLICT. A full cabin is not
 *    a bad cabin, it is a cabin with nothing left in it. Measured before it was
 *    settled: letting capacity hatch took a six-person family asking NOTHING
 *    from 0 marked cards to 45 of 73. Capacity already has a per-card carrier
 *    in the N/M figure; the needs have none.
 */
export function resolveDragFit(
  party: RosterPartyRow,
  unit: LodgingUnitRow,
  capacity: DragCapacity
): DragFit {
  const asked = askedNeedGlyphs(party)
  if (asked.length === 0) return NEUTRAL

  // `'partial'` is the softest non-`fits` grade, so it is the identity
  // element for `worseOf` and the accumulator needs no first-pass special case.
  let worst: Exclude<NeedsFit, 'fits'> = 'partial'
  let conflict = false
  let unrecorded = false

  for (const glyph of asked) {
    const coverage = glyph.coverage(party, unit, 'prospective')
    if (coverage === 'unknown') {
      unrecorded = true
      continue
    }
    const verdict = needVerdict(glyph.key, coverage)
    if (verdict !== 'fits') {
      worst = worseOf(verdict, worst)
      conflict = true
    }
  }

  if (conflict) return { state: 'conflict', severity: worst }
  if (unrecorded) return NEUTRAL
  if (!capacity.known || hasNoRoom(party, capacity)) return NEUTRAL
  return { state: 'match', severity: 'fits' }
}
