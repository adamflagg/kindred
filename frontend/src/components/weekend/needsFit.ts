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
import type { AccessibilityFlags, LodgingUnitRow, RosterPartyRow } from '../../types/lodging'

/**
 * The resolved amenity coverage the SERVER publishes, over a slot's leaf
 * descendants rather than its own row (`amenity_coverage` in
 * `api/services/lodging_rules.py`).
 *
 * Derived from the generated type, never hand-written: a change to the
 * Pydantic Literal must become a type error here rather than a silently
 * unreachable branch.
 */
type AmenityCoverage = NonNullable<LodgingUnitRow['power_coverage']>

/** Worst first. The order of this array IS the precedence. */
const FIT_ORDER = ['unmet', 'partial', 'fits'] as const

export type NeedsFit = (typeof FIT_ORDER)[number]

/**
 * The worse of two verdicts, by `FIT_ORDER`.
 *
 * Exported, and a named function rather than an inline comparison in the loop
 * below. It was written when `NEEDS_DIMENSIONS` held exactly ONE entry, so the
 * loop could never run twice and no assertion made through `resolveNeedsFit`
 * could distinguish "worst wins" from "the last dimension wins" — the
 * combining rule would otherwise have shipped untested, so it was pinned
 * directly. kindred#2224 added the second entry and `resolveNeedsFit` can now
 * exercise the rule too; the direct test stays, because it is the one that
 * still holds if the table ever shrinks back.
 */
export function worseOf(a: NeedsFit, b: NeedsFit): NeedsFit {
  return FIT_ORDER.indexOf(a) <= FIT_ORDER.indexOf(b) ? a : b
}

/**
 * One needs-vs-amenity pairing.
 *
 * SEEDED WITH EXACTLY ONE — `needs_power` vs the server's resolved power
 * coverage — to prove the case. A second dimension is a further entry in this
 * array and nothing else; if adding one needs design work, dimension one was
 * built wrong. `needs_fridge` (kindred#2224) is that second entry, and it cost
 * exactly one object literal: no new glyph, no new colour, no new chip, and
 * no change to this function.
 *
 * `someIs` is the per-criterion nuance the grain deliberately does NOT carry,
 * because the three grains do not mean the same thing for every criterion.
 * For power, a building where some rooms have it is a real improvement on one
 * where none do, so SOME is a softer mark. For `is_accessible`, SOME will be
 * WORSE than NONE and must map to `unmet`: a building advertising two
 * step-free rooms out of ten invites precisely the placement that lands in
 * one of the other eight, where a building advertising nothing does not.
 *
 * There is deliberately no OR/AND policy map. Both policies fall out of the
 * grain for free (`OR === coverage !== 'none'`, `AND === coverage === 'all'`),
 * so a policy map would be a strict subset of this that costs more to build.
 */
interface NeedsDimension {
  /** The household's asked-for need. */
  readonly flag: keyof AccessibilityFlags
  /** The unit's answer, resolved server-side over its leaf descendants. */
  readonly coverage: (unit: LodgingUnitRow) => AmenityCoverage
  /** What a partially-covered space reads as for THIS criterion. */
  readonly someIs: Exclude<NeedsFit, 'fits'>
}

const NEEDS_DIMENSIONS: readonly NeedsDimension[] = [
  {
    flag: 'needs_power',
    // `power_coverage`, never the raw `has_power`. Twelve of the fourteen
    // 2026 family-pool containers record `has_power = 0` while every leaf
    // beneath them has power, so the raw flag marks twelve entirely-powered
    // buildings unpowered. `?? 'unknown'` is the Pydantic-default gotcha, not
    // a guess: a field with a default renders optional in TypeScript.
    coverage: (unit) => unit.power_coverage ?? 'unknown',
    someIs: 'partial',
  },
  {
    // kindred#2224. `needs_accommodation` is a GATE question, not a need:
    // CampMinder asks a plain Yes/No and the substance of the ask lands in a
    // free-text field the product never read. This is the first need resolved
    // out of that narrative, in the SYNC layer — the sentences name diagnoses,
    // medications and feeding disorders, so only the boolean ever reaches this
    // module. Six of the 42 accommodation-gated 2026 households ask for cold
    // storage against 12 of 118 units carrying a fridge, and until now nothing
    // connected them. 2026 is only 16% placed, so 6 is the SHAPE of the
    // demand, not a rate.
    flag: 'needs_fridge',
    // `fridge_coverage`, never `has_fridge` — the same container trap the
    // power entry above spells out, AND the place the owner's 2026-08-15
    // ruling lives: a SHARED fridge IS a fridge, so `_resolve_fridge_coverage`
    // ORs `has_shared_fridge` into the answer. Re-deriving that here would put
    // a second implementation of one ruling on the client.
    coverage: (unit) => unit.fridge_coverage ?? 'unknown',
    // Advisory-softer, the same reading power takes: a building where some
    // rooms have a fridge is a real improvement on one where none do. NOT the
    // `is_accessible` shape, where SOME is worse than NONE — the shared-fridge
    // ruling is what rules that out, since a fridge one room over is still a
    // fridge a family can use.
    someIs: 'partial',
  },
]

/**
 * How well `unit` meets `party`'s needs.
 *
 * `unknown` coverage reports `fits`, and that is the whole point of the
 * fourth value: the absence of evidence is not evidence of absence. An
 * unconfirmed cabin's `has_power = false` means "nobody has said", so marking
 * it would assert something about a space nobody has measured — the same bar
 * `rosterAttention`'s `is_confirmed` gate already applies to the roster's own
 * fit check, and the reason the server resolves `unknown` rather than `none`.
 */
export function resolveNeedsFit(party: RosterPartyRow, unit: LodgingUnitRow): NeedsFit {
  let worst: NeedsFit = 'fits'
  for (const dimension of NEEDS_DIMENSIONS) {
    if (party.flags?.[dimension.flag] !== true) continue
    const coverage = dimension.coverage(unit)
    const verdict: NeedsFit =
      coverage === 'none' ? 'unmet' : coverage === 'some' ? dimension.someIs : 'fits'
    worst = worseOf(verdict, worst)
  }
  return worst
}
