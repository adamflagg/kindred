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

import type { AccessibilityFlags, LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
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
   * the vocabulary doc for the full correction, and `bathroomCoverage` below
   * for why the RULE has not moved with the word yet.
   */
  readonly label: string
  readonly Icon: LucideIcon
  /**
   * The locked hue, as the Tailwind step — NEVER hand-written hex.
   *
   * The review mock renders `#0ea5e9` / `#a855f7` / `#14b8a6` / `#f97316` and
   * one step lighter in dark. Those values ARE `sky-500` / `purple-500` /
   * `teal-500` / `orange-500` and their `-400` steps: the mock simulates the
   * app's tokens rather than defining them (§6). A complete literal per
   * entry, because Tailwind scans raw source text and a composed string emits
   * no rule at all — the `forest-950` failure (#1894) CLAUDE.md §4 names.
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
  /** Where this need reads its supply. See each implementation for why. */
  readonly coverage: (party: RosterPartyRow, unit: LodgingUnitRow) => Coverage
}

/**
 * The bathroom need's supply, and the one that reads the PARTY.
 *
 * `unit.bathroom` is one room's own field, and a merged slot's `unit_code` is
 * `""` BY DESIGN (kindred#1982) — so there is no single unit to read it off
 * for exactly the placement this need exists to catch: a whole-house merge
 * that IS the accommodation. `RosterParty.effective_bathroom` is the SERVER's
 * answer across every code the placement covers (`lodging_rules`,
 * kindred#2022), container inheritance included.
 *
 * ⚠️ THIS IS THE HALF OF THE RULING THAT HAS NOT LANDED, DELIBERATELY.
 *
 * The unit card draws its bathroom mark as PRESENCE — `bathroom != 'none'`,
 * the axis the form actually asks about. This still grades a SHARED bathroom
 * as not meeting the need, because that is what the product has always said
 * and changing it is kindred#2501 — itself gated on reading the Adult form's
 * wording, which supplies 19 of 66 flagged households and has never been
 * audited.
 *
 * So for one release a room can show "has a bathroom" while the family on it
 * shows a red bathroom glyph. Owner ruling 2026-08-19: accept it and name it.
 * When #2501 lands this becomes `'shared'` joining the `'private'` arm, and
 * `needGlyphs.test.ts` carries the assertion that flips.
 */
function bathroomCoverage(party: RosterPartyRow): Coverage {
  const effective = party.effective_bathroom
  if (effective === 'private') return 'all'
  if (effective === undefined || effective === 'unknown') return 'unknown'
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
    coverage: (party) => bathroomCoverage(party),
  },
  {
    key: 'power',
    flag: 'needs_power',
    label: 'Power',
    Icon: Plug,
    hueClassName: 'text-purple-500 dark:text-purple-400',
    someIs: 'partial',
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

/** Where `key` reads its supply for this party in this cabin. */
export function needCoverage(key: NeedKey, party: RosterPartyRow, unit: LodgingUnitRow): Coverage {
  return needGlyph(key).coverage(party, unit)
}

/**
 * How a coverage grade reads for one need.
 *
 * `unknown` reports `fits`, and that is the whole point of the fourth value:
 * the absence of evidence is not evidence of absence. An unconfirmed cabin's
 * `has_power = false` means "nobody has said", so marking it would assert
 * something about a space nobody has measured.
 */
export function needVerdict(key: NeedKey, coverage: Coverage): NeedsFit {
  if (coverage === 'none') return 'unmet'
  if (coverage === 'some') return needGlyph(key).someIs
  // The fifth grade, reachable only from `ramp_coverage`. It says the space
  // itself is QUALIFIED — a ramp with a lip — which is a softer statement than
  // "nothing here" in every reading of it, and softer than `some`, which is
  // about a building whose rooms disagree.
  if (coverage === 'partial') return 'partial'
  return 'fits'
}

/** One glyph the card will draw: the need, and how this cabin answers it. */
export interface ResolvedNeedGlyph extends NeedGlyphSpec {
  readonly verdict: NeedsFit
  /**
   * Whether the glyph takes the warn treatment.
   *
   * TWO STATES, NOT THREE, and that is ruled (§2): the hue means "asked for",
   * warn means "the placed room has not got it". `partial` — "a ramp with a
   * lip", "some rooms have power" — is a QUALIFICATION rather than a warning,
   * and `PlaceFamilyPicker` already grades it as advisory-muted against
   * `unmet`'s amber. It keeps its hue; degree lives on the card's drag-time
   * hatch, which grades it on the hatch PERIOD.
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
  unit: LodgingUnitRow | undefined
): ResolvedNeedGlyph[] {
  return askedNeedGlyphs(party).map((glyph) => {
    const verdict: NeedsFit =
      unit === undefined ? 'fits' : needVerdict(glyph.key, glyph.coverage(party, unit))
    return { ...glyph, verdict, isUnmet: verdict === 'unmet' }
  })
}
