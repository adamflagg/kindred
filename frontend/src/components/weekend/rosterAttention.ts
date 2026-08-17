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
import { coveredCodes, drawnUnits } from './unitLevel'

/** Ordered most urgent first. The order of this array IS the section order. */
export const ATTENTION_ORDER = ['required', 'unmet', 'unplaced', 'unverified', 'settled'] as const

export type AttentionLevel = (typeof ATTENTION_ORDER)[number]

export interface PartyAttention {
  level: AttentionLevel
  /** Short, specific, and safe beside the party name. No medical narrative. */
  reason: string
}

export const ATTENTION_LABEL: Record<AttentionLevel, string> = {
  required: 'Accommodation required',
  unmet: "Cabin doesn't fit the request",
  unplaced: 'Needs a cabin',
  unverified: 'Fit not verified',
  settled: 'Settled',
}

/**
 * The needs a cabin field can actually answer.
 *
 * `needs_accommodation` is deliberately absent: it names no specific amenity,
 * so no cabin field settles it. `has_infant` is absent too — it is derived
 * from the household's ages rather than asked for, so it informs which cabin
 * suits them without being an unfulfilled request.
 */
const VERIFIABLE_NEEDS = [
  {
    flag: 'needs_private_bathroom',
    label: 'Private bathroom',
    unmet: 'No private bathroom',
    // NOT `unit.bathroom` — that is one room's own field, and a merged
    // slot's `unit_code` is "" BY DESIGN (kindred#1982), so there is no
    // single unit to read it off for exactly the placement this need exists
    // to catch: a whole-house merge that IS the private-bathroom
    // accommodation. `RosterParty.effective_bathroom` is the SERVER's
    // answer across every code the placement covers
    // (`lodging_rules.effective_bathroom`, kindred#2022) — it already
    // credits "private" once the party's placement covers every member of a
    // bathroom_group, container inheritance included. Reading it here means
    // no caller changes: every `party` this function receives already
    // carries it.
    satisfiedBy: (_unit: LodgingUnitRow, party: RosterPartyRow) =>
      party.effective_bathroom === 'private',
  },
  {
    flag: 'needs_power',
    label: 'Power',
    unmet: 'No power',
    satisfiedBy: (unit: LodgingUnitRow, _party: RosterPartyRow) => unit.has_power === true,
  },
] as const

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
 * The unit whose confirmed data backs this party's fit check, or undefined
 * when there is no confirmed evidence to read.
 *
 * An ordinary placement resolves off `unit_code`, same as always. A merged
 * slot's `unit_code` is "" BY DESIGN (kindred#1982) — `unitsByCode.get('')`
 * finds nothing, which is exactly how the roster row, family card, and
 * detail panel each lost every genuine multi-leaf merge to `unverified`
 * even after `party.effective_bathroom` started reporting `private` for
 * them. `unit_codes` (kindred#1940) carries every leaf the placement
 * covers, and each leaf's OWN `is_confirmed` is real staff signal. Trusting
 * the merge as evidence requires EVERY member to resolve AND be confirmed —
 * one unconfirmed room is still an absence of data, the same principle the
 * single-unit gate already enforces, not a looser one for having more
 * rooms.
 *
 * The first resolved member stands in as the representative for a
 * `VERIFIABLE_NEEDS` check that reads a raw unit field (`needs_power`).
 * `needs_private_bathroom` never looks at it — it reads
 * `party.effective_bathroom` — so which member gets picked never changes
 * that verdict; `is_confirmed` is what has to hold for every one of them.
 *
 * The map surface (`MapUnitPopover`) does not call this: it already resolves
 * a real, defined per-leaf unit for a merged party (drawing it once per
 * room it occupies), so it never hit this gap.
 */
export function resolvePartyUnit(
  party: RosterPartyRow,
  unitsByCode: Map<string, LodgingUnitRow>
): LodgingUnitRow | undefined {
  const singleCode = party.unit_code ?? ''
  if (singleCode.length > 0) return unitsByCode.get(singleCode)

  const codes = party.unit_codes ?? []
  if (codes.length === 0) return undefined
  const members = codes.map((code) => unitsByCode.get(code))
  const allConfirmed = members.every((member) => member?.is_confirmed === true)
  return allConfirmed ? members[0] : undefined
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

  const asked = VERIFIABLE_NEEDS.filter((need) => flags[need.flag] === true)
  const genericAccommodation = flags.needs_accommodation === true

  if (asked.length === 0 && !genericAccommodation) {
    return { level: 'settled', reason: '' }
  }

  // Only a confirmed cabin is evidence. Anything else is an absence of data.
  if (unit?.is_confirmed === true) {
    const unmet = asked.filter((need) => !need.satisfiedBy(unit, party))
    if (unmet.length > 0) {
      return { level: 'unmet', reason: unmet.map((need) => need.unmet).join(' · ') }
    }
    // Every specific need is answered. A generic accommodation can still be
    // outstanding — no cabin field settles it — but the answered needs must
    // not be dragged back into the reason, or a cabin the registry confirms
    // has power reads as "we don't know whether this cabin has power".
    return genericAccommodation
      ? { level: 'unverified', reason: 'Accommodation' }
      : { level: 'settled', reason: '' }
  }

  const outstanding: string[] = asked.map((need) => need.label)
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

/** Index the roster's units by code so each row can find its own cabin. */
export function indexUnitsByCode(units: LodgingUnitRow[]): Map<string, LodgingUnitRow> {
  return new Map(units.map((unit) => [unit.code, unit]))
}

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
 * anything is written into — and things are: `lodging_availability` DOES hold
 * rows in production, which the old claim here ("has never held a row") got
 * wrong. It was measured against a development database and never re-checked.
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

  const byCode = new Map(units.map((row) => [row.code, row]))
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
