/**
 * Triage for the weekend roster.
 *
 * The board places parties; this page says which ones need a decision. That
 * distinction is what keeps the roster from being a list of names.
 *
 * Ranking only works on signals that discriminate. Measured against real 2026
 * data, `needs_resolution` is true for 44 of 62 parties and
 * `has_medical_narrative` was true for 62 of 62 — both are the normal state,
 * so neither escalates a row. The medical flag has since been deleted outright
 * (kindred#1889) for exactly that reason; `needs_resolution` survives because
 * it still discriminates elsewhere.
 *
 * The state worth surfacing is a party whose cabin does not provide what they
 * asked for. Answering that needs the registry to record what each cabin HAS,
 * and an unset `has_power` means "nobody has said", not "there is no power".
 * So the check runs only against CONFIRMED cabins and otherwise reports
 * `unverified`, rather than flagging every constrained family on the strength
 * of unset defaults.
 *
 * That gate is now OPEN, which this comment used to deny: it claimed "today
 * every cabin is `is_confirmed: false`", and production is 118/118 confirmed
 * as of 2026-08-09. The `unverified` branch is a live fallback for a cabin
 * nobody has confirmed yet, not the state of the whole registry — do not read
 * it as evidence that the fit check is inert. (Found during kindred#1912's
 * review, fixed under kindred#2180.)
 */
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { partyHeadcount } from './householdIdentity'
import { needCoverage, needGlyph, needVerdict } from './needGlyphs'
import { coveredCodes, drawnUnits, indexUnitsByCode, representingCodes } from './unitLevel'

/** Ordered most urgent first. The order of this array IS the section order. */
export const ATTENTION_ORDER = ['required', 'unmet', 'unplaced', 'unverified', 'settled'] as const

export type AttentionLevel = (typeof ATTENTION_ORDER)[number]

export interface PartyAttention {
  level: AttentionLevel
  /** Short, specific, and safe beside the party name. No medical narrative. */
  reason: string
}

export const ATTENTION_LABEL: Record<AttentionLevel, string> = {
  // Renamed under kindred#2072. The label is EXPLICITLY NOT LOCKED — it is one
  // of the five marks parked for staff input — so it lives here, in one
  // place, and `HouseholdRosterRow` no longer carries a hardcoded copy of it.
  required: 'Needs Accommodation',
  unmet: "Cabin doesn't fit the request",
  unplaced: 'Needs a cabin',
  unverified: 'Fit not verified',
  settled: 'Settled',
}

/**
 * WHICH needs the roster's own sections grade — and the grading itself is NOT
 * here any more.
 *
 * Every verdict now comes from `needGlyphs.ts`, the one place a need is
 * graded (kindred#2072). This module used to hold a `VERIFIABLE_NEEDS` table
 * with its own `satisfiedBy` implementations, and the copy had drifted: power
 * was read off the RAW `unit.has_power`, so the twelve 2026 family-pool
 * containers that record `has_power = 0` while every leaf beneath them has
 * power reported "No power" on the roster while the board's own hatch, reading
 * the server-resolved `power_coverage`, called the same building fine.
 *
 * ⚠️ `needs_fridge` (kindred#2224) and `needs_step_free` (kindred#2438) are
 * still OUT, and the reason has changed — read this before adding them.
 *
 * It used to be mechanical: they read a raw unit field this module had no
 * resolved value for. That objection is gone, since `needGlyphs` grades all
 * four off the server's resolved coverage. What remains is that these sections
 * are a staff-facing CLASSIFICATION with counts on them, and folding two more
 * needs in moves parties out of `settled` and into `unmet` — a change to what
 * a number staff read means, which needs its own ruling rather than arriving
 * as a side effect of a refactor. The two needs are not unreported meanwhile:
 * both draw a per-family glyph on the card (kindred#2072).
 *
 * `needs_accommodation` is a different kind of absence and is settled: it
 * names no specific amenity, so no cabin field answers it. `has_infant` is
 * absent too — derived from the household's ages rather than asked for, so it
 * informs which cabin suits them without being an unfulfilled request.
 */
const ROSTER_NEEDS = ['bathroom', 'power'] as const

/**
 * The roster's own wording for those two, and it now MATCHES the glyph's
 * label — kindred#2501.
 *
 * These strings are read on the roster row, the details panel and the map peek
 * — surfaces that report the verdict, not the ask — so they have to say what
 * was actually checked. Until #2501 that was exclusivity, and "No private
 * bathroom" was the honest word for it: saying "No bathroom in unit" about a
 * cabin with a shared bathroom inside it would have been false.
 *
 * The rule moved (owner ruling 2026-08-20 — the glyph grades presence, not
 * exclusivity), so the wording moves with it, and now saying "private" would
 * be the false half: a household reported here has NO bathroom in the unit at
 * all, shared or otherwise. Both halves move together, because the ask and the
 * verdict have to name the same axis or the roster reads as two products.
 *
 * The underlying `needs_private_bathroom` field keeps its name; renaming it is
 * a deliberate follow-up. `needGlyphs.bathroomCoverage` carries the ruling and
 * what it costs.
 */
const ROSTER_NEED_WORDING: Record<(typeof ROSTER_NEEDS)[number], { asked: string; unmet: string }> =
  {
    bathroom: { asked: 'Bathroom in unit', unmet: 'No bathroom in unit' },
    power: { asked: 'Power', unmet: 'No power' },
  }

/**
 * How many beds the party consumes. Adult weekends enrol one person.
 *
 * ONE OF TWO COPIES of this read — `boardLayout.partySize` carries the full
 * account of the rule and of the newly-reachable reported 0. Change one,
 * change both. (It was three until #2152; `FamilyDetailsPanel`'s copy wanted
 * the PEOPLE number and now calls `partyHeadcount`.)
 *
 * ⚠️ BEDS, NOT PEOPLE — do not collapse this into `partyHeadcount`. Only the
 * fallback arm is shared: the reported `party_size` already has blank and
 * placeholder adult slots dropped and a child under 18 months discounted
 * (#1925/#2046), so for an infant household it sits one BELOW the headcount
 * on purpose. `rosterAttention.test` asserts both numbers on one such party.
 */
export function partyBeds(party: RosterPartyRow): number {
  const reported = party.party_size ?? 0
  if (reported > 0) return reported
  return partyHeadcount(party)
}

/**
 * The board's rule for which DRAWN card represents a named code: itself if it
 * is drawn, else the nearest drawn ancestor (rolled up), else every drawn node
 * beneath it (fanned down). `[]` when the board draws nothing for it at all.
 *
 * ⚠️ A SECOND COPY of `cardCodesFor`, the closure inside
 * `boardLayout.indexPayload`, and the duplication is knowing rather than
 * accidental: that one is not exported, and two implementations of "which card
 * represents this placement" is the exact drift this function exists to close.
 * So the pair is pinned against the board's OWN model rather than against a
 * restatement of the rule — `rosterAttention.test.ts` builds a board from the
 * same payload and asserts both land on the same card. Lifting the shared rule
 * into `unitLevel.ts`, where `representingCodes` (the fan-down half) already
 * lives, is the follow-up.
 *
 * The roll-up walk is deliberately NOT the "whole building" grain — see
 * `cardCodesFor`'s own note and `unitLevel.buildingKey`. It stops at the
 * nearest DRAWN ancestor, which flips with `is_combined`, and that is right
 * here precisely because the question IS "which card is on screen".
 */
function representingCards(
  named: LodgingUnitRow,
  units: LodgingUnitRow[],
  unitsByCode: ReadonlyMap<string, LodgingUnitRow>,
  drawnByCode: ReadonlyMap<string, LodgingUnitRow>
): LodgingUnitRow[] {
  const own = drawnByCode.get(named.code)
  if (own !== undefined) return [own]

  let cursor = named
  const seen = new Set<string>()
  while ((cursor.parent_code ?? '') !== '' && !seen.has(cursor.code)) {
    seen.add(cursor.code)
    const parent = unitsByCode.get(cursor.parent_code ?? '')
    if (parent === undefined) break
    const drawnParent = drawnByCode.get(parent.code)
    if (drawnParent !== undefined) return [drawnParent]
    cursor = parent
  }

  return representingCodes(named, units, new Set(drawnByCode.keys()))
    .map((code) => drawnByCode.get(code))
    .filter((card): card is LodgingUnitRow => card !== undefined)
}

/*
 * THE RESOLVED GRADES, ORDERED WORST FIRST, and the order is the whole content
 * of the roll-up below — so it is worth saying why it is this one.
 *
 * It is a ladder of how much of the space provides the thing: nothing, nobody
 * has looked, some rooms, a qualified answer, all of it. Ordered that way the
 * fold is exactly `needVerdict`'s worst case over the cards — checked pair by
 * pair, the fold's verdict is never softer than the loudest card's, including
 * the two pairs that are not obvious: `unknown` beats `some` because an
 * unmeasured room grades `unmet` while `some` may grade `partial`, and
 * `unknown` beats `partial` for the same reason.
 *
 * ⚠️ THAT HOLDS FOR THE GLYPH READING, WHICH IS THE ONLY ONE `needVerdict`
 * HAS since 2026-08-21. The drag-time state no longer reads `unknown` at all
 * — `resolveDragFit` intercepts it before grading (unrecorded coverage makes
 * neither claim), so the old hatch-side `unknown → fits` reading, under which
 * a fold of `{unknown, some}` would have been softer than `some` alone, is
 * gone along with its `UnknownReading` parameter. If a drag-time reading of
 * `unknown` ever returns, this ladder needs a second one beside it.
 *
 * `partial` is ramp-only and `shared`/`private` are bathroom-only, so the
 * three vocabularies get three constants rather than one union that would
 * type-check against fields it can never hold.
 */
const AMENITY_WORST_FIRST = ['none', 'unknown', 'some', 'all'] as const
const RAMP_WORST_FIRST = ['none', 'unknown', 'some', 'partial', 'all'] as const
const BATHROOM_WORST_FIRST = ['none', 'unknown', 'shared', 'private'] as const

/** The worst grade present, treating an absent field as `absent`. */
function worstGrade<T extends string>(
  order: readonly T[],
  absent: T,
  values: ReadonlyArray<T | undefined>
): T {
  let rank = order.length - 1
  for (const value of values) {
    const index = order.indexOf(value ?? absent)
    if (index >= 0 && index < rank) rank = index
  }
  return order[rank] ?? absent
}

/**
 * One row standing for several cards, graded at the WORST of them.
 *
 * ⚠️ A GRADING VIEW, NOT A UNIT. Only the five resolved amenity fields are
 * rolled up; `code`, `name`, `area_name`, `sleeps` and the raw `has_*` twins
 * are the FIRST card's and describe that card alone. Nothing reads them off a
 * resolved party unit today — `FamilyDetailsPanel` prints `area_name`, and
 * every card of a multi-card placement is in one area often enough for that to
 * be unremarkable — but a future caller wanting the placement's own identity
 * must not take it from here.
 *
 * The alternative was to return the single worst card, and it is wrong for the
 * case that motivates the whole thing: two rooms where one has power and no
 * fridge and the other has a fridge and no power have no worse card between
 * them, and picking either one hides a need the family will actually be short
 * of.
 */
function worstCard(cards: readonly LodgingUnitRow[]): LodgingUnitRow | undefined {
  const first = cards[0]
  if (first === undefined || cards.length === 1) return first
  return {
    ...first,
    bathroom: worstGrade(
      BATHROOM_WORST_FIRST,
      'unknown',
      cards.map((card) => card.bathroom)
    ),
    power_coverage: worstGrade(
      AMENITY_WORST_FIRST,
      'unknown',
      cards.map((card) => card.power_coverage)
    ),
    fridge_coverage: worstGrade(
      AMENITY_WORST_FIRST,
      'unknown',
      cards.map((card) => card.fridge_coverage)
    ),
    ac_coverage: worstGrade(
      AMENITY_WORST_FIRST,
      'unknown',
      cards.map((card) => card.ac_coverage)
    ),
    ramp_coverage: worstGrade(
      RAMP_WORST_FIRST,
      'unknown',
      cards.map((card) => card.ramp_coverage)
    ),
  }
}

/**
 * The unit whose confirmed data backs this party's fit check, or undefined
 * when there is no confirmed evidence to read.
 *
 * ⚠️ THE CARD THE BOARD DRAWS, which is what this used to get wrong. An
 * ordinary placement resolves off `unit_code`, same as always. A merged slot's
 * `unit_code` is "" BY DESIGN (kindred#1982) — `unitsByCode.get('')` finds
 * nothing, which is how the roster row, family card, and detail panel each
 * lost every genuine multi-leaf merge to `unverified` even after
 * `party.effective_bathroom` started reporting `private` for them. `unit_codes`
 * (kindred#1940) carries every leaf the placement covers, and this used to take
 * `members[0]` off it: the first id in the `units` relation, i.e. whatever
 * order the rows were stored in.
 *
 * That made the grade a coin flip AND put it at odds with the other two
 * surfaces that grade the same family. `LodgingUnitCard` grades its occupants
 * against the card it drew, and `MapUnitPopover` calls `partyAttention` with
 * the map's drawn unit — for a combined house, the container. Seven 2026
 * placements resolved to a different unit here than on those two. No verdict
 * differed on that data, but only by luck: every container and every leaf
 * resolves `power_coverage: 'all'`, while two containers have leaves that
 * disagree on `has_fridge`, so the container resolves `fridge_coverage: 'some'`
 * where one leaf says `all` and the other `none`. Flipping two ids in the
 * relation flipped the answer.
 *
 * So the named codes are mapped onto the DRAWN cards representing them, by the
 * board's own rule (`representingCards`). A merge under a combined house
 * resolves to the house — one card, the server's roll-up over its leaves, the
 * same row `LodgingUnitCard` and `MapUnitPopover` grade against. A named code
 * the board draws no card for at all — a childless container — stands in for
 * itself rather than reporting no evidence: the registry row is real, and
 * `undefined` would make every need glyph on that party's off-board card read
 * as MET.
 *
 * Where a placement spans SEVERAL cards, the answer is the worst of them
 * (`worstCard`), not a member. A family whose need fails in one of its rooms
 * has a problem, and surfacing the best room hides it.
 *
 * Trusting a multi-card placement as evidence still requires EVERY card to
 * resolve AND be confirmed — one unconfirmed room is an absence of data, the
 * same principle the single-unit gate enforces, not a looser one for having
 * more rooms. A code with no row in the payload fails that outright. The
 * single-card path returns the row as it always has and lets `partyAttention`
 * apply its own `is_confirmed` gate.
 *
 * The bathroom need never looks at the unit in the placed reading — it reads
 * `party.effective_bathroom` — so which card is picked never changes THAT
 * verdict. The other three do read the unit, and now read the same one the
 * board does.
 */
export function resolvePartyUnit(
  party: RosterPartyRow,
  unitsByCode: Map<string, LodgingUnitRow>
): LodgingUnitRow | undefined {
  const singleCode = party.unit_code ?? ''
  const named = singleCode.length > 0 ? [singleCode] : (party.unit_codes ?? [])
  if (named.length === 0) return undefined

  const units = [...unitsByCode.values()]
  const drawnByCode = new Map(drawnUnits(units).map((unit) => [unit.code, unit]))

  const cards: LodgingUnitRow[] = []
  const seen = new Set<string>()
  for (const code of named) {
    const unit = unitsByCode.get(code)
    if (unit === undefined) return undefined
    const represented = representingCards(unit, units, unitsByCode, drawnByCode)
    for (const card of represented.length > 0 ? represented : [unit]) {
      if (seen.has(card.code)) continue
      seen.add(card.code)
      cards.push(card)
    }
  }

  if (cards.length === 1) return cards[0]
  return cards.every((card) => card.is_confirmed === true) ? worstCard(cards) : undefined
}

/**
 * @param unit The cabin the party is assigned to, when it can be resolved —
 *   ordinarily via `unit_code`, or via `resolvePartyUnit` for a merge.
 *   Undefined means no confirmed evidence, and the fit reports as
 *   unverified regardless of what `party.effective_bathroom` says
 *   (kindred#1982's `is_confirmed` gate: an unconfirmed cabin is an absence
 *   of data, not evidence).
 */
export function partyAttention(
  party: RosterPartyRow,
  unit?: LodgingUnitRow | undefined
): PartyAttention {
  const flags = party.flags ?? {}
  const isPlaced = (party.unit_name ?? '').length > 0

  // A mandatory accommodation means a member cannot attend without it. It
  // outranks placement, because a placed party can still be in a cabin that
  // does not provide it.
  if (flags.accommodation_is_mandatory === true) {
    return { level: 'required', reason: 'Cannot attend without it' }
  }

  if (!isPlaced) {
    return { level: 'unplaced', reason: 'No cabin yet' }
  }

  const asked = ROSTER_NEEDS.filter((key) => flags[needGlyph(key).flag] === true)
  const genericAccommodation = flags.needs_accommodation === true

  if (asked.length === 0 && !genericAccommodation) {
    return { level: 'settled', reason: '' }
  }

  // Only a confirmed cabin is evidence. Anything else is an absence of data.
  if (unit?.is_confirmed === true) {
    /*
     * ANYTHING SHORT OF `fits` COUNTS AS UNMET HERE, and the roster is binary
     * on purpose: it has no third band to put a qualification in.
     *
     * ⚠️ ONE VERDICT MOVED WITH kindred#2072 AND STAYED MOVED; a second moved
     * and was then MOVED BACK. Both are recorded because each was argued for
     * on the record and a reader meeting only the outcome would re-argue them.
     *
     *   POWER, and this is the fix that stands: a container whose leaves all
     *   have power reported "No power" off its own `has_power = 0` row —
     *   twelve of the fourteen 2026 family-pool containers. That case stops
     *   flagging, and should. It is about reading the SERVER-RESOLVED
     *   coverage instead of the raw row, and nothing since has touched it.
     *
     *   UNKNOWN, and this one went out and came back. #2072 made `unknown`
     *   and an absent `effective_bathroom` grade `fits` and settle, where the
     *   old `=== 'private'` rule failed them. The owner reversed it on
     *   2026-08-20: *"unknown values should not equal fits, across all
     *   surfaces on the glyphs, its unconfirmed information."* The argument
     *   that lost — the absence of evidence is not evidence of absence — is
     *   true and insufficient, because `settled` is a claim about an
     *   unmeasured cabin exactly as `unmet` is, and this band has no third
     *   option to retreat to.
     *
     * ⚠️ THE `is_confirmed` GATE ABOVE IS UNTOUCHED BY THAT REVERSAL and does
     * most of the work: an unconfirmed cabin never reaches this branch at all.
     * What changed is the narrower case the gate does not cover — a cabin
     * somebody HAS confirmed whose coverage the server still could not
     * resolve. Measured across 2026's twelve weekends and 575 parties: no
     * placed party's bathroom or power coverage is anything but `all` or
     * `none`, so no section count moves today. kindred#2502 narrows the ways
     * `unknown` can arise further still, on the unit side.
     *
     * Both directions are pinned in `rosterAttention.test.ts`, so a future
     * reader meets the decisions rather than inferring them from behaviour.
     */
    const unmet = asked.filter((key) => needVerdict(key, needCoverage(key, party, unit)) !== 'fits')
    if (unmet.length > 0) {
      return {
        level: 'unmet',
        reason: unmet.map((key) => ROSTER_NEED_WORDING[key].unmet).join(' · '),
      }
    }
    // Every specific need is answered. A generic accommodation can still be
    // outstanding — no cabin field settles it — but the answered needs must
    // not be dragged back into the reason, or a cabin the registry confirms
    // has power reads as "we don't know whether this cabin has power".
    return genericAccommodation
      ? { level: 'unverified', reason: 'Accommodation' }
      : { level: 'settled', reason: '' }
  }

  const outstanding: string[] = asked.map((key) => ROSTER_NEED_WORDING[key].asked)
  if (genericAccommodation) outstanding.push('Accommodation')
  return { level: 'unverified', reason: outstanding.join(' · ') }
}

export interface AttentionSection {
  level: AttentionLevel
  label: string
  parties: RosterPartyRow[]
}

/**
 * Group parties by attention level, most urgent first, dropping empty levels.
 *
 * Returns a single section when the whole roster shares one state — an
 * untouched adult weekend is 123 unplaced parties, and heading that with
 * "Needs a cabin (123)" tells the reader nothing they cannot already see.
 * Callers use `length > 1` to decide whether to draw section headers.
 */
export function attentionSections(
  parties: RosterPartyRow[],
  unitsByCode: Map<string, LodgingUnitRow>
): AttentionSection[] {
  const buckets = new Map<AttentionLevel, RosterPartyRow[]>()
  for (const party of parties) {
    const { level } = partyAttention(party, resolvePartyUnit(party, unitsByCode))
    const bucket = buckets.get(level)
    if (bucket) bucket.push(party)
    else buckets.set(level, [party])
  }

  return ATTENTION_ORDER.filter((level) => buckets.has(level)).map((level) => ({
    level,
    label: ATTENTION_LABEL[level],
    parties: buckets.get(level) ?? [],
  }))
}

/**
 * Index the roster's units by code so each row can find its own cabin.
 * The implementation moved to `unitLevel` when it grew a WeakMap cache; this
 * re-export keeps the import surface its callers already use.
 */
export { indexUnitsByCode } from './unitLevel'

/**
 * Family spaces whose capacity nobody has recorded.
 *
 * Deliberately not `counts.units_capacity_unknown`. That count used to span
 * staff holds too — reporting 5 on real 2026 data where only 2 of the 79
 * placeable spaces were unmeasured — but no longer does: `_build_counts` now
 * excludes staff housing from the planning inventory, so on that same data the
 * two agree.
 *
 * They are still not the same question, which is why this survives. This one
 * asks about spaces a family could be put in RIGHT NOW, so it filters on
 * `is_family_available` and drops a cabin somebody has been written into this
 * weekend. `units_capacity_unknown` asks about the planning inventory, which
 * includes that cabin because it returns next weekend. They diverge the moment
 * anything is written into — and things are: the write-in table DOES hold rows
 * in production (all 21, moved out of `lodging_availability` by 1500000162),
 * which the old claim here ("has never held a row") got wrong. It was measured
 * against a development database and never re-checked.
 *
 * It sits beside the BED count on the stats bar, and beds there are
 * `beds_family_available`, so the available-only reading is the one that
 * matches its neighbour.
 */
export function countUnmeasuredSpaces(units: LodgingUnitRow[]): number {
  // Over the DRAWN units, not "every non-container row". A combined house
  // draws one card, at its own registry row; its rooms draw no card.
  // `drawnUnits` resolves the draw level top-down and is the one definition of
  // which units get a card — deriving it here a second way is how this starts
  // disagreeing with the board it sits above.
  //
  // What "measured" MEANS is `effectiveSleeps` below, and it has to stay the
  // mirror of the backend's (kindred#1945's PR). This used to read only the
  // drawn row's own `sleeps`, which got both container cases wrong in opposite
  // directions: a house whose rooms all carry numbers read as unmeasured
  // because the house row was blank, and a house with a recorded delta read as
  // measured even though no room beneath it had ever been counted. The backend
  // made the second mistake too, and the two were fixed together — they cannot
  // be allowed to disagree, because `WeekendStatsBar` prints this number on
  // the same line as the backend's `beds_family_available`.
  return drawnUnits(units).filter(
    (unit) => unit.is_family_available === true && effectiveSleeps(unit, units) === null
  ).length
}

/**
 * A drawn unit's capacity, or `null` when nobody has measured it.
 *
 * THE MIRROR of `_effective_sleeps` in `api/services/lodging_roster_service.py`.
 * Keep the two in step. `derivedCapacity.ts` holds a third copy, by necessity
 * rather than by choice: it is written against `LodgingUnitRecord`, a
 * different shape, and says so at its own definition.
 *
 * EXPORTED for `mapModel.ts` (kindred#2183 review), which needs the number
 * itself rather than only its presence — the map draws a combined house as a
 * single mark, so its peek is the one place the whole-house figure has to be
 * printed. That file takes `LodgingUnitRow[]` too, so a fourth copy of the
 * arithmetic would have been a copy with no shape difference to justify it.
 *
 * Under the kindred#2041 delta ruling a container's own `sleeps` is the beds in
 * space belonging to no single room, so a combined house's capacity is that
 * delta PLUS its rooms, and one unmeasured ACTIVE room leaves the whole total
 * unknown. Inactive leaves are skipped in both directions: a retired room adds
 * no beds and must not park its house in the unmeasured list forever.
 *
 * Leaves are NOT additionally filtered by inventory class, deliberately. Six
 * active `staff_default` leaves sit under active containers in production and
 * the backend's sum has counted their beds since kindred#2041 — a family
 * holding the whole house holds that room too, which is what "combined" means.
 * Gating the unknown on a narrower set than the sum reads from would let a
 * room's beds count while its missing measurement did not.
 */
export function effectiveSleeps(unit: LodgingUnitRow, units: LodgingUnitRow[]): number | null {
  const own = unit.sleeps ?? null
  if (unit.is_container !== true) return own

  const byCode = indexUnitsByCode(units)
  const leaves = coveredCodes(unit, units)
    .map((code) => byCode.get(code))
    .filter((leaf): leaf is LodgingUnitRow => leaf !== undefined && leaf.is_active !== false)

  if (leaves.some((leaf) => (leaf.sleeps ?? null) === null)) return null
  // The degenerate case, and the one an obvious implementation gets wrong:
  // summing an absent delta over an empty room list yields 0, i.e. the
  // confident claim "this house sleeps nobody". "Unset container reads as a
  // delta of zero" holds only because its rooms supply the rest of the answer.
  if (own === null && leaves.length === 0) return null
  return (own ?? 0) + leaves.reduce((total, leaf) => total + (leaf.sleeps ?? 0), 0)
}
