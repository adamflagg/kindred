/**
 * Triage for the weekend roster.
 *
 * The board places parties; this page says which ones need a decision. That
 * distinction is what keeps the roster from being a list of names.
 *
 * Ranking only works on signals that discriminate. Measured against real 2026
 * data, `needs_resolution` is true for 44 of 62 parties and
 * `has_medical_narrative` for 62 of 62 — both are the normal state, so neither
 * escalates a row.
 *
 * The state worth surfacing is a party whose cabin does not provide what they
 * asked for. Answering that needs the registry to record what each cabin HAS,
 * and today every cabin is `is_confirmed: false` — an unset `has_power` means
 * "nobody has said", not "there is no power". So the check runs only against
 * CONFIRMED cabins and otherwise reports `unverified`. It costs nothing now
 * and starts working the moment staff confirm amenities, rather than flagging
 * every constrained family on the strength of unset defaults.
 */
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'

/** Ordered most urgent first. The order of this array IS the section order. */
export const ATTENTION_ORDER = ['required', 'unmet', 'unplaced', 'unverified', 'settled'] as const

export type AttentionLevel = (typeof ATTENTION_ORDER)[number]

export interface PartyAttention {
  level: AttentionLevel
  /** Short, specific, and safe to show beside the party name. Never PHI. */
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
    satisfiedBy: (unit: LodgingUnitRow) => unit.bathroom === 'private',
  },
  {
    flag: 'needs_power',
    label: 'Power',
    unmet: 'No power',
    satisfiedBy: (unit: LodgingUnitRow) => unit.has_power === true,
  },
] as const

/** How many beds the party consumes. Adult weekends enrol one person. */
export function partyBeds(party: RosterPartyRow): number {
  const reported = party.party_size ?? 0
  if (reported > 0) return reported
  return (party.adults?.length ?? 0) + (party.children?.length ?? 0)
}

/**
 * @param unit The cabin the party is assigned to, when it can be resolved.
 *   A merged slot is named for the merge rather than a unit code, so this is
 *   undefined for merges and the fit reports as unverified.
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
    const unmet = asked.filter((need) => !need.satisfiedBy(unit))
    if (unmet.length > 0) {
      return { level: 'unmet', reason: unmet.map((need) => need.unmet).join(' · ') }
    }
    if (!genericAccommodation) {
      return { level: 'settled', reason: '' }
    }
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
    const { level } = partyAttention(party, unitsByCode.get(party.unit_code ?? ''))
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
 * Deliberately not `counts.units_capacity_unknown`, which spans every
 * unmeasured cabin including staff holds and building rows — on real 2026 data
 * that reports 5 where only 2 of the 79 placeable spaces are unmeasured.
 */
export function countUnmeasuredSpaces(units: LodgingUnitRow[]): number {
  return units.filter(
    (unit) =>
      unit.is_container !== true &&
      unit.is_family_available === true &&
      (unit.sleeps === null || unit.sleeps === undefined)
  ).length
}
