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
 * Only 6 of 118 units carry a private bathroom, so a hatch that graded it
 * would fire on 112 cards the moment any of the 45 bathroom-asking parties was
 * picked up. kindred#2501 does not rescue it either: the loosened rule counts
 * 28 of 118, which still hatches 90. "A mark that is always on is chrome staff
 * learn to read past" (`unitBadges.ts`, on the struck shared-space ring) — a
 * board hatched almost everywhere says nothing at all, which is the same
 * reasoning `resolveNeedsFit` already applies at rest.
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
 */
export function resolveNeedsFit(party: RosterPartyRow, unit: LodgingUnitRow): NeedsFit {
  let worst: NeedsFit = 'fits'
  for (const glyph of askedNeedGlyphs(party)) {
    if (!HATCHED_NEEDS.includes(glyph.key)) continue
    worst = worseOf(needVerdict(glyph.key, glyph.coverage(party, unit, 'placed')), worst)
  }
  return worst
}
