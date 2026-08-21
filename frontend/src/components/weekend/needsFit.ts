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
 *   forest tint                                  = open and available, at rest
 *        only (#2093).
 *
 * So the mark this feeds changes `background-image` and nothing else. Putting
 * fit on opacity would have made it read as a weaker refusal rather than as a
 * different kind of statement, which is exactly the collapse the vocabulary
 * ruling exists to prevent.
 *
 * Pure, and in its own module rather than inside the card, for the same
 * reason `ringPrecedence` and `boardLayout` are: a rule with a truth table is
 * testable without rendering ~82 cards.
 */
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { askedNeedGlyphs, needVerdict, type NeedKey } from './needGlyphs'

/** Worst first. The order of this array IS the precedence. */
const FIT_ORDER = ['unmet', 'partial', 'fits'] as const

export type NeedsFit = (typeof FIT_ORDER)[number]

/**
 * The worse of two verdicts, by `FIT_ORDER`.
 *
 * Exported, and a named function rather than an inline comparison in the loop
 * below. It was written when the dimension table held exactly ONE entry, so the
 * loop could never run twice and no assertion made through `resolveNeedsFit`
 * could distinguish "worst wins" from "the last dimension wins" — the
 * combining rule would otherwise have shipped untested, so it was pinned
 * directly. That table is `needGlyphs.NEED_GLYPHS` now and carries four, of
 * which `HATCHED_NEEDS` below grades three; the direct test stays, because it
 * is the one that still holds if the scope ever shrinks back to one.
 */
export function worseOf(a: NeedsFit, b: NeedsFit): NeedsFit {
  return FIT_ORDER.indexOf(a) <= FIT_ORDER.indexOf(b) ? a : b
}

/**
 * WHICH needs the drag-time hatch grades — deliberately not all four.
 *
 * The GRADING is one rule now, in `needGlyphs.ts`, and that is the
 * consolidation kindred#2072 asked for: for a given (need, party, cabin) every
 * surface must reach the same verdict. WHICH needs a surface reports is a
 * separate question, and each surface scopes it for its own reason — this list
 * is that reason, written down rather than implied.
 *
 * `bathroom` is out, and it is the only one that had to be argued.
 *
 * Only 36 of 118 units answer the bathroom need, so a hatch that graded it
 * would fire on 82 cards the moment any of the 41 bathroom-asking households
 * on 2026's family weekends was picked up — at most 12 of them sit on any one
 * weekend, but every card is on screen for each. Both rescues are already IN
 * that figure and neither is enough: kindred#2501 moved the axis from
 * exclusivity to presence (6 of 118 → 28) and kindred#2502's
 * `_resolve_bathroom` gave 8 of the 15 containers the bathroom their rooms
 * record (28 → 36), taking the hatch from 112 cards to 82.
 *
 * "A mark that is always on is chrome staff learn to read past"
 * (`unitBadges.ts`, on the struck shared-space ring) — a board hatched almost
 * everywhere says nothing at all, which is the same reasoning
 * `resolveNeedsFit` already applies at rest.
 *
 * The bathroom need is NOT unreported. It draws a per-family glyph on the card
 * itself (kindred#2072), where it is one household's fact rather than a
 * board-wide wash, and `rosterAttention` grades it for the roster's own
 * sections.
 */
const HATCHED_NEEDS: readonly NeedKey[] = ['power', 'fridge', 'step_free']

/**
 * How well `unit` meets `party`'s needs.
 *
 * The verdict per need comes from `needGlyphs.needVerdict`, which is the ONE
 * grading — this function's own job is the combining rule (worst wins) and the
 * scope above, nothing else. It used to carry a third copy of the
 * coverage-to-verdict mapping, which is how the roster and the board came to
 * disagree about whether a container had power.
 *
 * ⚠️ `'fits'` FOR AN UNKNOWN COVERAGE, WHICH IS NOT WHAT THE GLYPHS DO, and
 * the difference is deliberate rather than a missed sweep. The owner ruled on
 * 2026-08-20 that unconfirmed information must not read as met **on the
 * glyphs** — a glyph reports what is known, and its full hue is itself a claim.
 * The hatch is a different mark asking a different question: it is an
 * INTERRUPTION over a cabin being dragged onto, so its bar is evidence of
 * ABSENCE rather than absence of evidence.
 *
 * The number decides it. 102 of 118 cabins carry `ramp_coverage: 'unknown'`,
 * because nobody has assessed them — which is what the three-value select
 * exists to record. Measured across 2026's twelve weekends: reading `unknown`
 * as unmet here takes a step-free household's hatched cabins from **32 of 944
 * pairs to 848**, from 3.4% to 90%. A hatch that fires on nine cabins in ten
 * has stopped saying anything. The same rule costs the glyphs three marks.
 *
 * See `needGlyphs.UnknownReading`, which carries the full argument. This is the
 * only call site that passes anything but the default.
 */
export function resolveNeedsFit(party: RosterPartyRow, unit: LodgingUnitRow): NeedsFit {
  let worst: NeedsFit = 'fits'
  for (const glyph of askedNeedGlyphs(party)) {
    if (!HATCHED_NEEDS.includes(glyph.key)) continue
    worst = worseOf(needVerdict(glyph.key, glyph.coverage(party, unit, 'placed'), 'fits'), worst)
  }
  return worst
}
