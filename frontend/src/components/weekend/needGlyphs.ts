/**
 * The four ruled need glyphs, and the ONE place a need is graded — kindred#2072.
 *
 * ## Why this module exists
 *
 * Three mutually disjoint tables were grading these needs, and they disagreed:
 *
 *   - `rosterAttention.VERIFIABLE_NEEDS` — bathroom + power, with power read
 *     off the RAW `unit.has_power`
 *   - `needsFit.NEEDS_DIMENSIONS` — power + fridge + step-free, all read off
 *     the SERVER-RESOLVED `*_coverage`
 *   - `FamilyCardChips` — bathroom + power, as text chips
 *
 * The disagreement was not cosmetic. Twelve of the fourteen 2026 family-pool
 * containers record `has_power = 0` while every leaf beneath them has power,
 * so the roster called twelve entirely-powered buildings unpowered while the
 * board's drag-time hatch called the same building fine. Rulings 3 and 4 need
 * ONE grading for all four needs, so this is it, and the tables above call it
 * rather than a fourth being added beside them.
 *
 * The decision record is `docs/reference/weekend-card-vocabulary.md` — §2 for
 * what each glyph means, §6 for the two policies with no other line of code to
 * sit on (the absence rule, and the closed hue set).
 *
 * ## Pure, and no JSX
 *
 * A `.ts` module holding a truth table, testable without rendering ~82 cards —
 * the same shape `ringPrecedence` and `boardLayout` take. It names the icon
 * COMPONENT rather than drawing it, so the card owns the markup and this owns
 * the vocabulary.
 */
import { Accessibility, Bath, Plug, Refrigerator, type LucideIcon } from 'lucide-react'

import type {
  AccessibilityFlags,
  HouseholdMedical,
  LodgingUnitRow,
  RosterPartyRow,
} from '../../types/lodging'
import type { NeedsFit } from './needsFit'

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

/**
 * The step-free grade, and the one vocabulary that is NOT `AmenityCoverage`.
 *
 * `has_ramp` is a three-value select — `yes` / `no` / `partial`, blank = NOT
 * ASSESSED (migration 1500000131) — so a room can answer "qualified" and the
 * boolean grain has nowhere to put that. `ramp_coverage` therefore carries a
 * fifth grade, `partial`, meaning NO room is fully step-free but at least one
 * has a qualified ramp. Derived from the generated type for the same reason
 * `AmenityCoverage` is.
 */
type RampCoverage = NonNullable<LodgingUnitRow['ramp_coverage']>

/** Every grade any dimension's resolved coverage field can report. */
export type Coverage = AmenityCoverage | RampCoverage

/** The four dimensions, and the set is CLOSED (§6). */
export type NeedKey = 'bathroom' | 'power' | 'fridge' | 'step_free'

/**
 * The three narrative fields a glyph can explain itself from, tied to the
 * GENERATED payload type so an API rename becomes a type error here rather
 * than a silently label-only tooltip.
 *
 * These are `HouseholdMedicalResponse` fields, and that response is served by
 * ONE endpoint gated on `bunking.manage` — the containment
 * `test_lodging_medical_narrative_containment.py` pins. This type maps needs
 * to that endpoint's fields; nothing here puts the text on the roster.
 */
export type NeedExplainSource = keyof Pick<
  HouseholdMedical,
  'bathroom_explain' | 'cpap_info' | 'accommodation_explain'
>

/**
 * WHICH QUESTION IS BEING ASKED. Two, and they are genuinely different.
 *
 *   `placed`      — "does the cabin they are IN meet this need?" The family
 *                   card, the roster, the drag-time hatch.
 *   `prospective` — "would THIS cabin meet it?" The Assign modal's candidate
 *                   rows, where the party has no placement yet.
 *
 * Only the bathroom need reads them differently, and that difference is
 * load-bearing rather than an inconsistency left behind: its placed supply is
 * `party.effective_bathroom`, the SERVER's verdict across every code the
 * placement covers — which is meaningless for a candidate that has no
 * placement, since every unplaced party would then grade identically no
 * matter which cabin was under consideration.
 *
 * `placementCandidates.ts` had reached that conclusion and kept a table of its
 * own because of it — the fourth table, and the one the kindred#2072 survey
 * did not count. It calls this instead now: one grading, parameterised by the
 * question, rather than two implementations that agree until somebody edits
 * one.
 */
export type NeedReading = 'placed' | 'prospective'

export interface NeedGlyphSpec {
  readonly key: NeedKey
  /** The household's asked-for need. */
  readonly flag: keyof AccessibilityFlags
  /**
   * What the glyph is called when a staff member asks it.
   *
   * ⚠️ `bathroom`'s label is NOT the column's word. `needs_private_bathroom`
   * says "private"; the CampMinder question behind it never asks about
   * exclusivity — *"a bathroom that doesn't require you to leave your
   * cabin"* — so the label says the axis that was actually asked. See §4 of
   * the vocabulary doc for the full correction. The RULE has now moved with
   * the word (kindred#2501): `bathroomCoverage` grades presence, and only the
   * column's name still lags, which is a named follow-up.
   */
  readonly label: string
  readonly Icon: LucideIcon
  /**
   * The locked hue, as the Tailwind step — NEVER hand-written hex.
   *
   * The review mock renders `#0ea5e9` / `#a855f7` / `#14b8a6` / `#f97316` and
   * one step lighter in dark. Those values STAND IN FOR `sky-500` /
   * `purple-500` / `teal-500` / `orange-500` and their `-400` steps — they do
   * not equal them. They are Tailwind **v3**'s hex; this project ships v4,
   * which retuned the default ramps to OKLCH, so what actually renders is
   * `#00a6f4` / `#ad46ff` / `#00bba7` / `#ff6900`. The tokens below are still
   * exactly right and nothing about them should change: §6 makes the app's own
   * scale the definition and the mock the approximation. This comment used to
   * say the two were the same value, which sent a reader looking for a bug
   * that is not there.
   *
   * A complete literal per entry, because Tailwind scans raw source text and a
   * composed string emits no rule at all — the `forest-950` failure (#1894)
   * CLAUDE.md §4 names.
   */
  readonly hueClassName: string
  /**
   * What a partially-covered space reads as for THIS need.
   *
   * The grain deliberately does not carry this, because the three grains do
   * not mean the same thing for every need. For power and fridge, a building
   * where some rooms have it is a real improvement on one where none do, so
   * SOME is softer. For step-free, SOME is WORSE than NONE: a building
   * advertising two step-free rooms out of ten invites precisely the
   * placement that lands in one of the other eight.
   */
  readonly someIs: Exclude<NeedsFit, 'fits'>
  /**
   * The medical field(s) this need's flag was DERIVED from — the Go sync's
   * own sources, not a guess by name: `needs_power` exists because a family
   * wrote something in `cpap_info`, `needs_private_bathroom` because they
   * wrote `bathroom_explain`, and `needs_fridge` and `needs_step_free` both
   * keyword-match `accommodation_explain` alone -- step-free matched
   * `bathroom_explain` too until the 2026-08-23 owner ruling removed it from
   * the Go derivation, and this list followed. The glyph tooltip appends
   * these texts for a
   * `bunking.manage` holder, fetched through the gated medical endpoint —
   * see `needExplainTexts`.
   */
  readonly explainSources: readonly NeedExplainSource[]
  /** Where this need reads its supply. See each implementation for why. */
  readonly coverage: (party: RosterPartyRow, unit: LodgingUnitRow, reading: NeedReading) => Coverage
}

/**
 * The bathroom need's supply, and the one that reads the PARTY when placed.
 *
 * `unit.bathroom` is one room's own field, and a merged slot's `unit_code` is
 * `""` BY DESIGN (kindred#1982) — so there is no single unit to read it off
 * for exactly the placement this need exists to catch: a whole-house merge
 * that IS the accommodation. `RosterParty.effective_bathroom` is the SERVER's
 * answer across every code the placement covers (`lodging_rules`,
 * kindred#2022), container inheritance included.
 *
 * ⚠️ THIS GRADES PRESENCE, NOT EXCLUSIVITY — kindred#2501, owner ruling
 * 2026-08-20: *"the glyph should not grade exclusivity, just 'do they have a
 * bathroom (shared or private)'"* and, on the shared case itself, *"sharing a
 * bathroom for whatever reason still provides people a bathroom."*
 *
 * So `'shared'` joins `'private'` in the met arm. It is worth being precise
 * about what `'shared'` MEANS, because the word invites the wrong reading: it
 * is a bathroom INSIDE the cabin that two parties split. Walking to a
 * bathhouse is not `'shared'` — it records as `'none'`, and still reads as
 * unmet. The CampMinder question behind the flag asks for *"a bathroom that
 * doesn't require you to leave your cabin"*, so the axis was never
 * exclusivity, and the column's name (`needs_private_bathroom`) is the thing
 * that is wrong here. Renaming it is a deliberate follow-up, not this change.
 *
 * WHAT IT COSTS, ACCEPTED ON THE RECORD: the ~3–5 households a year who need a
 * bathroom nobody else uses lose an automatic red mark and are found by
 * reading the request instead.
 *
 * This ENDS a one-release contradiction rather than creating one. The unit
 * card draws its own bathroom mark for `private` and `shared` alike — its
 * predicate is presence, neither `none` nor `unknown` — so until now a room
 * could show "has a bathroom" while the family placed on it showed a red
 * bathroom glyph, off the same field. One axis now, on both marks.
 */
function bathroomCoverage(
  party: RosterPartyRow,
  unit: LodgingUnitRow,
  reading: NeedReading
): Coverage {
  // The PROSPECTIVE half: the candidate cabin's own field, which is also what
  // the unit card's amenity mark prints.
  //
  // ⚠️ BOTH READINGS TAKE THE SAME PREDICATE BELOW, AND THAT IS LOAD-BEARING.
  // This comment used to claim an Assign-modal row "can never contradict the
  // card it was opened from" — it could and it did, because the card graded
  // presence and this graded exclusivity. #2501's body was written against the
  // placed lane alone for the same reason; flipping only that one would have
  // moved the contradiction into the modal rather than closing it.
  const value = reading === 'prospective' ? (unit.bathroom ?? 'unknown') : party.effective_bathroom
  if (value === 'private' || value === 'shared') return 'all'
  if (value === undefined || value === 'unknown') return 'unknown'
  return 'none'
}

/**
 * The closed set, in the order the card draws it.
 *
 * Order is part of the vocabulary, not an implementation detail: staff scan
 * left to right, and a glyph row whose order changed per card would be
 * unreadable. `needGlyphs.test.ts` pins both the order and the count.
 */
export const NEED_GLYPHS: readonly NeedGlyphSpec[] = [
  {
    key: 'bathroom',
    flag: 'needs_private_bathroom',
    label: 'Bathroom in unit',
    Icon: Bath,
    hueClassName: 'text-sky-500 dark:text-sky-400',
    // Unreachable today: `bathroomCoverage` maps a four-value enum onto
    // all/none/unknown and never reports `some`. Present so every entry has
    // the same shape, and set to the safe direction — if a future
    // per-room bathroom resolution ever does report `some`, a partially
    // covered placement should be the mark staff look at, not the one they
    // do not.
    someIs: 'unmet',
    explainSources: ['bathroom_explain'],
    coverage: bathroomCoverage,
  },
  {
    key: 'power',
    flag: 'needs_power',
    label: 'Power',
    Icon: Plug,
    hueClassName: 'text-purple-500 dark:text-purple-400',
    someIs: 'partial',
    // `cpap_info`, and that is not a mismatch: the power need IS the CPAP
    // disclosure. The Go sync derives `needs_power` from a family having
    // written this field, so it is where their own words live.
    explainSources: ['cpap_info'],
    // `power_coverage`, never the raw `has_power`. Twelve of the fourteen 2026
    // family-pool containers record `has_power = 0` while every leaf beneath
    // them has power, so the raw flag marks twelve entirely-powered buildings
    // unpowered — which is precisely the bug `rosterAttention` carried until
    // it started calling this module. `?? 'unknown'` is the Pydantic-default
    // gotcha, not a guess: a field with a default renders optional here.
    coverage: (_party, unit) => unit.power_coverage ?? 'unknown',
  },
  {
    key: 'fridge',
    flag: 'needs_fridge',
    label: 'Fridge',
    Icon: Refrigerator,
    hueClassName: 'text-teal-500 dark:text-teal-400',
    // Advisory-softer, the same reading power takes: a building where some
    // rooms have a fridge is a real improvement on one where none do. NOT the
    // step-free shape — the shared-fridge ruling is what rules that out, since
    // a fridge one room over is still a fridge a family can use.
    someIs: 'partial',
    explainSources: ['accommodation_explain'],
    // `fridge_coverage`, never `has_fridge` — the same container trap the
    // power entry spells out, AND the place the owner's 2026-08-15 ruling
    // lives: a SHARED fridge IS a fridge, so `_resolve_fridge_coverage` ORs
    // `has_shared_fridge` into the answer. Re-deriving that here would put a
    // second implementation of one ruling on the client.
    coverage: (_party, unit) => unit.fridge_coverage ?? 'unknown',
  },
  {
    key: 'step_free',
    flag: 'needs_step_free',
    label: 'Step-free',
    Icon: Accessibility,
    hueClassName: 'text-orange-500 dark:text-orange-400',
    // ⚠️ NOT the fridge reading — see `someIs`'s own doc above for why SOME is
    // worse than NONE here. What settles it against fridge is the
    // shared-fridge ruling's logic in reverse: a fridge one room over is still
    // a fridge a family can use, and a ramp one room over is not.
    someIs: 'unmet',
    // The accommodation narrative ALONE, matching the Go derivation exactly.
    // Both used to include the bathroom narrative; the 2026-08-23 owner ruling
    // removed it from the pair together, because a household whose only
    // narrative is a bathroom explanation was drawing two glyphs that quoted
    // the same paragraph. The bathroom narrative belongs to the bathroom glyph.
    explainSources: ['accommodation_explain'],
    // `ramp_coverage`, never the raw `has_ramp` — and here that is not only the
    // container trap. `has_ramp` is a STRING, so `'no'` is TRUTHY: any consumer
    // testing it for truthiness renders "step-free" on the four cabins staff
    // assessed as explicitly having no ramp, the exact inversion the select
    // exists to prevent.
    coverage: (_party, unit) => unit.ramp_coverage ?? 'unknown',
  },
]

const BY_KEY = new Map<NeedKey, NeedGlyphSpec>(NEED_GLYPHS.map((glyph) => [glyph.key, glyph]))

/** One need's spec, by key. Throws on an unknown key — the set is closed. */
export function needGlyph(key: NeedKey): NeedGlyphSpec {
  const spec = BY_KEY.get(key)
  if (spec === undefined) throw new Error(`Unknown need glyph: ${key}`)
  return spec
}

/**
 * Where `key` reads its supply for this party in this cabin.
 *
 * `reading` defaults to `placed`, so an unqualified call is the card's
 * question — the one every existing caller was asking.
 */
export function needCoverage(
  key: NeedKey,
  party: RosterPartyRow,
  unit: LodgingUnitRow,
  reading: NeedReading = 'placed'
): Coverage {
  return needGlyph(key).coverage(party, unit, reading)
}

/**
 * The explain paragraph(s) one glyph appends for a `bunking.manage` holder,
 * in `explainSources` order, empty and whitespace-only fields skipped.
 *
 * `undefined` covers loading, a 403 and a person-grain party alike — the
 * tooltip then shows exactly what it shows today, the label being its own
 * placeholder (staff ruling: no spinner in a bubble).
 */
export function needExplainTexts(
  key: NeedKey,
  medical: Partial<Pick<HouseholdMedical, NeedExplainSource>> | undefined
): string[] {
  if (medical === undefined) return []
  return needGlyph(key)
    .explainSources.map((field) => (medical[field] ?? '').trim())
    .filter((text) => text.length > 0)
}

/**
 * How a coverage grade reads for one need.
 *
 * ⚠️ `unknown` REPORTS `unmet`, AND THAT REVERSES WHAT THIS FUNCTION SHIPPED
 * WITH (owner ruling 2026-08-20). The old rule was `unknown → fits`, argued as
 * "the absence of evidence is not evidence of absence": an unconfirmed cabin's
 * `has_power = false` means *nobody has said*, so marking it would assert
 * something about a space nobody has measured.
 *
 * ⚠️ THAT WORKED EXAMPLE IS HISTORICAL AND CAN NO LONGER OCCUR. kindred#2526
 * removed the `is_confirmed` gate, so an unconfirmed `has_power = false` is now
 * read at face value as "there is no power" and never reaches `unknown` at all.
 * The example is left as written because it is what the 2026-08-20 argument
 * actually said; today `unknown` arises from a blank field, a container with no
 * active room left, or an unresolved `bathroom`. The RULING below is unaffected
 * — it turns on what `fits` asserts, not on where `unknown` came from.
 *
 * The argument is kept because it is half right, and because seeing it is what
 * stops it being re-adopted. What it missed: `fits` IS NOT SILENCE. It is the
 * glyph in its full hue, and that asserts the cabin MEETS the need — a claim
 * about an unmeasured space just as much as the warn treatment is. There is no
 * neutral verdict to fall back on, because two glyph states are ruled and not
 * three (§2). So the only real question is which claim is safer to make about a
 * space nobody has measured, and the owner ruled, verbatim:
 *
 *   "unknown values should not equal fits, across all surfaces on the glyphs,
 *    its unconfirmed information."
 *
 * It agrees with the same owner on 2026-08-19 — *"if something's unconfirmed,
 * I'm always going to want to know"*.
 *
 * ⚠️ THE ASYMMETRY IT WAS PARTLY ARGUED FROM IS GONE, AT THE SOURCE. Bathroom
 * used to be the only one of the four able to go red on an unconfirmed cabin,
 * because its supply was resolved server-side without the `is_confirmed` gate
 * the other three passed through. kindred#2526 deleted that gate rather than
 * extending it — the four coverage resolvers now agree with `_resolve_bathroom`
 * — so `unknown` no longer means "nobody has reconfirmed this cabin" on any of
 * them. The ruling below is unaffected: what reaches it is an EMPTY
 * aggregation or a blank `has_ramp`, and `fits` would still be a claim.
 *
 * ⚠️ AN UNPLACED PARTY IS A DIFFERENT CASE AND IS NOT GRADED HERE. No unit
 * means nothing to be unconfirmed ABOUT; `resolveNeedGlyphs` short-circuits to
 * `fits` before this function is reached, because a queue drawn red all the
 * time says nothing at all. Do not "make that consistent" with this.
 *
 * Measured before the change, across all twelve of 2026's weekends and 575
 * parties: exactly THREE glyphs move, all of them `step_free` against a cabin
 * whose `ramp_coverage` the server could not resolve. The roster's section
 * counts do not move at all — `ROSTER_NEEDS` grades bathroom and power, and
 * every placed party's coverage for those two is already `all` or `none`.
 *
 * ONE READING OF `unknown` NOW, where there used to be a parameter.
 * `UnknownReading` let the drag-time hatch read `unknown` as `'fits'`
 * instead, because the hatch is an interruption whose bar is evidence of
 * absence — and the number behind that was not close: 102 of 118 cabins carry
 * `ramp_coverage: 'unknown'`, so reading it as unmet took a step-free
 * household's hatched cabins from 32 of 944 pairs to 848. That escape moved
 * into the resolver itself on 2026-08-21: `resolveDragFit` intercepts
 * `unknown` BEFORE grading (its rule 2 — unrecorded coverage makes neither
 * claim), so no caller asks this table about `unknown` with hatch semantics
 * any more, and the parameter came out rather than sitting
 * reachable-but-never-passed. The reasoning is kept because it answers "why
 * doesn't the hatch just grade unknown like the glyphs do" — it still
 * doesn't, one layer up.
 */
export function needVerdict(key: NeedKey, coverage: Coverage): NeedsFit {
  if (coverage === 'none') return 'unmet'
  if (coverage === 'some') return needGlyph(key).someIs
  // The fifth grade, reachable only from `ramp_coverage`. It says the space
  // itself is QUALIFIED — a ramp with a lip — which is a softer statement than
  // "nothing here" in every reading of it, and softer than `some`, which is
  // about a building whose rooms disagree.
  if (coverage === 'partial') return 'partial'
  if (coverage === 'unknown') return 'unmet'
  return 'fits'
}

/** One glyph the card will draw: the need, and how this cabin answers it. */
export interface ResolvedNeedGlyph extends NeedGlyphSpec {
  readonly verdict: NeedsFit
  /**
   * Whether the glyph takes the warn treatment.
   *
   * TWO STATES, NOT THREE, and that is ruled (§2): the hue means "asked for",
   * warn means "the room has not got it". `partial` — "a ramp with a lip",
   * "some rooms have power" — is a QUALIFICATION rather than a warning, so it
   * keeps its hue. Degree lives on the drag-time hatch, which grades it over
   * the hatch period.
   *
   * ⚠️ THE OLD REASON FOR THAT WAS WRONG AND IS CORRECTED HERE. This comment
   * used to say `partial` may keep its hue because "the Assign modal's
   * candidate rows already grade it as advisory-muted against `unmet`'s
   * amber". That was true of the deleted `PlaceFamilyPicker`; the sentence was
   * redirected at the Assign modal without being re-checked, and there the
   * modal's amber was keyed on capacity, not on degree. Since the owner's
   * 2026-08-20 verdict ruling the modal draws exactly two inks — green for
   * `fits`, the warn red for everything else, `partial` included. So the modal
   * distinguishes degree in WORDS (`partial fit` against `does not fit`) and
   * never in colour, and it is not a reason to keep three states here.
   *
   * The real reason is unchanged and stands on its own: a qualification is not
   * a warning, and the glyph has two states to spend.
   */
  readonly isUnmet: boolean
}

/**
 * The needs this household ASKED FOR, ungraded — the absence rule's own half.
 *
 * Split from `resolveNeedGlyphs` because two callers want the question and not
 * the answer: `needsFit` grades a subset of them against a cabin, and a card
 * deciding whether to draw a row at all needs to know whether the row would be
 * empty.
 */
export function askedNeedGlyphs(party: RosterPartyRow): NeedGlyphSpec[] {
  const flags = party.flags ?? {}
  return NEED_GLYPHS.filter((glyph) => flags[glyph.flag] === true)
}

/**
 * Every glyph this party's card draws against this cabin.
 *
 * THE ABSENCE RULE (§6) is here and nowhere else: a need the household did not
 * ask for is OMITTED, never dimmed. This governs marks that do not exist yet,
 * which is why it is pinned on the resolver rather than on any one card.
 *
 * `unit === undefined` is an unplaced party — in the queue, or under the drag
 * overlay. Every asked need reports `fits` there, for the same reason
 * `needsFit` reports `fits` at rest: there is nothing to be a misfit FOR, and
 * a queue drawn red all the time says nothing at all.
 */
export function resolveNeedGlyphs(
  party: RosterPartyRow,
  unit: LodgingUnitRow | undefined,
  reading: NeedReading = 'placed'
): ResolvedNeedGlyph[] {
  return askedNeedGlyphs(party).map((glyph) => {
    const verdict: NeedsFit =
      unit === undefined ? 'fits' : needVerdict(glyph.key, glyph.coverage(party, unit, reading))
    return { ...glyph, verdict, isUnmet: verdict === 'unmet' }
  })
}
