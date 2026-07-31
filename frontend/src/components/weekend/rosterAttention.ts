/**
 * Triage for the weekend roster.
 *
 * The board places parties; this page says which ones need a decision. That
 * distinction is what keeps the roster from being a list of names.
 *
 * Ranking only works on signals that discriminate. Measured against real 2026
 * data, `needs_resolution` is true for 44 of 62 parties and
 * `has_medical_narrative` for 62 of 62 — both are the normal state, so neither
 * escalates a row. Placement and hard housing constraints do.
 */
import type { RosterPartyRow } from '../../types/lodging'

/** Ordered most urgent first. The order of this array IS the section order. */
export const ATTENTION_ORDER = ['required', 'unplaced', 'constrained', 'settled'] as const

export type AttentionLevel = (typeof ATTENTION_ORDER)[number]

export interface PartyAttention {
  level: AttentionLevel
  /** Short, specific, and safe to show beside the party name. Never PHI. */
  reason: string
}

export const ATTENTION_LABEL: Record<AttentionLevel, string> = {
  required: 'Accommodation required',
  unplaced: 'Needs a cabin',
  constrained: 'Placed with constraints',
  settled: 'Settled',
}

/** How many beds the party consumes. Adult weekends enrol one person. */
export function partyBeds(party: RosterPartyRow): number {
  const reported = party.party_size ?? 0
  if (reported > 0) return reported
  return (party.adults?.length ?? 0) + (party.children?.length ?? 0)
}

export function partyAttention(party: RosterPartyRow): PartyAttention {
  const flags = party.flags ?? {}
  const isPlaced = (party.unit_name ?? '').length > 0

  // A mandatory accommodation means a member cannot attend without it. It
  // outranks placement, because a placed party can still be in a cabin that
  // does not provide it — which only the board can confirm.
  if (flags.accommodation_is_mandatory === true) {
    return { level: 'required', reason: 'Cannot attend without it' }
  }

  if (!isPlaced) {
    return { level: 'unplaced', reason: 'No cabin yet' }
  }

  const constraints: string[] = []
  if (flags.needs_private_bathroom === true) constraints.push('Private bathroom')
  if (flags.needs_power === true) constraints.push('Power')
  if (flags.has_infant === true) constraints.push('Infant')
  if (flags.needs_accommodation === true) constraints.push('Accommodation')

  if (constraints.length > 0) {
    return { level: 'constrained', reason: constraints.join(' · ') }
  }

  return { level: 'settled', reason: '' }
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
export function attentionSections(parties: RosterPartyRow[]): AttentionSection[] {
  const buckets = new Map<AttentionLevel, RosterPartyRow[]>()
  for (const party of parties) {
    const { level } = partyAttention(party)
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
