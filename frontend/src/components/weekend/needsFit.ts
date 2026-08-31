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
 * `known` is "there is a free-spot number to stand behind here", and
 * kindred#2543 narrowed it back to that. Between kindred#2503 and that ruling
 * it also required every write-in cover to be SIZED, so a fully-measured cabin
 * with one uncounted occupant withheld both marks — while the stats bar
 * published a free-spot count for the same cabin. The card now publishes what
 * the server does: an unsized cover is charged the whole capacity of the unit
 * it names, so the remainder is a FLOOR and can only understate what is free.
 *
 * What still withholds: a cabin nobody MEASURED, where `writeInDemand`'s
 * `consumed` means nothing at all, and a card whose party straddles beyond it.
 * See `LodgingUnitCard`'s `writeInSpotsUsable` for the caller that builds this
 * value, and `writeInDemand` (`writeIn.ts`) for the underlying rule and the
 * three meanings of its `known`.
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
 * match — the caller withholds `known` for an unmeasured cabin and for a
 * straddling party, and both mean the same thing here: nothing to say.
 *
 * ⚠️ AN UNSIZED WRITE-IN IS NO LONGER ONE OF THOSE CASES (kindred#2543), AND
 * THE REASON IS ASYMMETRIC BETWEEN THE TWO MARKS. A shorter draft of this
 * paragraph gave one reason for both and lost the asymmetry the sentence above
 * had just named. An unsized cover is charged its leaf's WHOLE capacity and a
 * party cannot exceed the leaf it sleeps in, so `free` is a FLOOR — reported
 * free ≤ true free — and a floor is not symmetric across `<` and `>=`.
 * `resolveDragFit`'s match fires on `free >= partySize`, where reported ≥ party
 * implies true ≥ party: the floor cannot manufacture a match, so that half is
 * safe on the arithmetic alone. THIS function fires on `free < partySize`, and
 * reported < party does NOT imply true < party. A container of 10 with one
 * cover sized 2 and one unsized cover on a measured 3-bed room reports `free`
 * 5; if that occupant is one person, 7 really are free, and a family of 6 is
 * reddened off a cabin that fits them.
 *
 * So the red is CONSERVATIVE rather than safe, and it is conservative BY
 * RULING: kindred#2543's divergence section names `hasNoRoom` and directs both
 * marks to stop withholding, accepting the undercount verbatim — *"if that
 * slightly undercounts 'real' availability, staff will know that when looking
 * over the shared cabins."* It costs a MARK, never a placement: `dragPlacement`
 * has refused nothing on a written-into card since kindred#2432, so the drop
 * still lands on the cabin the red is wrong about. Do not re-narrow this to
 * `known`.
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
 *    unconfirmed information must not read as met.
 *
 *    ⚠️ THE BRANCH SURVIVES BUT ITS DOMINANT SOURCE IS GONE. `has_ramp` used
 *    to supply almost all of it: 104 of 118 units held a blank raw `has_ramp`,
 *    of which 102 were still `unknown` once `ramp_coverage` walked the leaves.
 *    kindred#2526 removed one other source ("nobody has reconfirmed this
 *    cabin"); kindred#2327 removed the blank-`has_ramp` source itself, moving
 *    step-free onto the boolean `is_accessible`, which a bool cannot leave
 *    unanswered. What is left is the EMPTY AGGREGATION — a container with no
 *    active leaf to answer at all — plus a bathroom nobody recorded. Still
 *    reachable, and still the right reading; far rarer.
 *
 *    ⚠️ THAT MAKES THE HATCH LOUDER, DELIBERATELY. A cabin that is simply not
 *    accessible now grades `none` where it used to grade `unknown`, so a
 *    step-free household hatches against it instead of passing over it in
 *    silence. That is the ruling, not a side effect: staff asked to know what
 *    is in fact accessible.
 *
 * 3. CAPACITY GATES THE MATCH AND NEVER CAUSES A CONFLICT. A full cabin is not
 *    a bad cabin, it is a cabin with nothing left in it. Measured before it was
 *    settled: letting capacity hatch took a six-person family asking NOTHING
 *    from 0 marked cards to 45 of 73. Capacity already has a per-card carrier
 *    in the N/M figure; the needs have none.
 *
 * 4. ⚠️ STEP-FREE IS EXCLUDED FROM THIS GRADING ENTIRELY (owner ruling
 *    2026-08-31, kindred#2639), REVERSING kindred#2327's "a cabin that is not
 *    accessible DOES hatch". The owner, verbatim: *"we should not hatch on
 *    accessibility since its not an explicit requestion we ask people, its
 *    parsed out of other accomm, and this one is only 'short distances', not
 *    a wheelchair. so, no hatch, and otherwise good to go."*
 *
 *    `needs_step_free` is not a question CampMinder asks families — the Go
 *    sync keyword-matches it out of the free-text `accommodation_explain`
 *    narrative, and the signal behind it is a MOBILITY HINT ("short
 *    distances"), not a wheelchair requirement. Rule 2 above withholds a
 *    claim when the CABIN's own coverage is unresolved; this withholds a
 *    claim about step-free UNCONDITIONALLY, because the ambiguity here is in
 *    what the family actually meant, not in what the cabin's data says — a
 *    confirmed `is_accessible` cannot cure it. So step-free is treated as
 *    though it were never asked for AT ALL: it contributes to neither the
 *    hatch (the bar is evidence of absence, and a parsed hint is not that)
 *    nor the match (a positive mark must not read a parsed hint as a met
 *    requirement) — mirroring rule 1's "asks for nothing" case, not rule 2's
 *    "asked but unresolved" case, which is why it is filtered out of `asked`
 *    below rather than routed through the `unrecorded` branch: a party who
 *    ALSO asks for something real must still get that need's own verdict,
 *    hatch or match, undiminished.
 *
 *    ⚠️ THE UNIT CARD'S OWN `is_accessible` AMENITY MARK IS UNCHANGED. This
 *    rule governs only the drag-time NEED verdict; `is_accessible` stays a
 *    real recorded fact about the cabin, reported wherever the card already
 *    reports it.
 *
 *    ⚠️ THE FAMILY CARD'S STEP-FREE GLYPH IS ALSO UNCHANGED. `needGlyphs.ts`'s
 *    `resolveNeedGlyphs` — a DIFFERENT function, called by `FamilyCard` and
 *    `HousingNeedDetails` — still grades and draws it: staff should still see
 *    that a family mentioned accessibility. What is struck here is only the
 *    automatic drag-time VERDICT this function derives from it, not the
 *    information that the family asked.
 */
export function resolveDragFit(
  party: RosterPartyRow,
  unit: LodgingUnitRow,
  capacity: DragCapacity
): DragFit {
  // Rule 4: step-free is a PARSED HINT, not an explicit ask, so it is
  // filtered out here — treated exactly as rule 1 treats "asked for
  // nothing" — rather than run through the loop below at all. A party whose
  // only recorded flag is `needs_step_free` therefore returns `NEUTRAL` from
  // the `asked.length === 0` check immediately below, same as a party who
  // asked for nothing.
  const asked = askedNeedGlyphs(party).filter((glyph) => glyph.key !== 'step_free')
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
