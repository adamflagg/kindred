/**
 * Triage logic for the weekend roster.
 *
 * The roster's job is not to list parties — the board places them. Its job is
 * to say which ones need a decision and why. That only works if the signals it
 * ranks on are actually discriminating: measured against real 2026 data,
 * `needs_resolution` is true for 44 of 62 parties and `has_medical_narrative`
 * for 62 of 62, so neither can drive triage. Placement and hard housing
 * constraints do.
 */
import { describe, expect, it } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import { attentionSections, partyAttention, partyBeds } from './rosterAttention'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 2000001,
    person_cm_id: 0,
    display_name: 'The Johnson Family',
    adults: [{ adult_number: 1, display_name: 'Olivia Johnson', relationship: 'Parent' }],
    children: [{ person_cm_id: 1000001, display_name: 'Emma Johnson', age: 9, grade: 4 }],
    party_size: 2,
    unit_name: 'Ridge A',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    share: {
      preference: 'unknown',
      preference_raw: '',
      proximity: [],
      request_text: '',
      needs_resolution: false,
    },
    flags: {
      needs_private_bathroom: false,
      needs_power: false,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      has_infant: false,
      has_medical_narrative: false,
    },
    ...overrides,
  }
}

describe('partyAttention', () => {
  it('ranks a mandatory accommodation above everything else', () => {
    // Mandatory means a member cannot attend without it. It outranks placement
    // because a placed party can still be in the wrong cabin for it.
    const a = partyAttention(
      party({
        unit_name: 'Ridge A',
        flags: { needs_accommodation: true, accommodation_is_mandatory: true },
      })
    )
    expect(a.level).toBe('required')
  })

  it('still reports a mandatory accommodation when the party is also unplaced', () => {
    const a = partyAttention(party({ unit_name: '', flags: { accommodation_is_mandatory: true } }))
    expect(a.level).toBe('required')
  })

  it('flags an unplaced party', () => {
    const a = partyAttention(party({ unit_name: '' }))
    expect(a.level).toBe('unplaced')
    expect(a.reason).toBe('No cabin yet')
  })

  it('names the specific constraint on a placed party', () => {
    const a = partyAttention(party({ flags: { needs_private_bathroom: true, needs_power: true } }))
    expect(a.level).toBe('constrained')
    expect(a.reason).toBe('Private bathroom · Power')
  })

  it('treats an infant as a housing constraint', () => {
    const a = partyAttention(party({ flags: { has_infant: true } }))
    expect(a.level).toBe('constrained')
    expect(a.reason).toBe('Infant')
  })

  it('settles a placed party with no constraints', () => {
    expect(partyAttention(party()).level).toBe('settled')
  })

  it('does NOT escalate on needs_resolution alone', () => {
    // True for 44 of 62 real parties — it means "nobody has parsed the free
    // text yet", which is the normal state, not an exception.
    const a = partyAttention(
      party({ share: { needs_resolution: true, request_text: 'near the Garcia family' } })
    )
    expect(a.level).toBe('settled')
  })

  it('does NOT escalate on a medical narrative alone', () => {
    // True for 62 of 62 real parties.
    const a = partyAttention(party({ flags: { has_medical_narrative: true } }))
    expect(a.level).toBe('settled')
  })
})

describe('partyBeds', () => {
  it('uses the reported party size', () => {
    expect(partyBeds(party({ party_size: 4 }))).toBe(4)
  })

  it('falls back to counting people when party_size is absent', () => {
    const withoutSize = party({
      adults: [
        { adult_number: 1, display_name: 'Olivia Chen' },
        { adult_number: 2, display_name: 'Noah Chen' },
      ],
      children: [{ person_cm_id: 1, display_name: 'Emma Chen' }],
    })
    delete withoutSize.party_size
    expect(partyBeds(withoutSize)).toBe(3)
  })
})

describe('attentionSections', () => {
  it('orders sections by urgency and drops the empty ones', () => {
    const sections = attentionSections([
      party({ display_name: 'Settled Family' }),
      party({ display_name: 'Unplaced Family', unit_name: '' }),
    ])
    expect(sections.map((s) => s.level)).toEqual(['unplaced', 'settled'])
    expect(sections[0]?.parties.map((p) => p.display_name)).toEqual(['Unplaced Family'])
  })

  it('preserves the order the API sent within a section', () => {
    const sections = attentionSections([
      party({ display_name: 'Adams', unit_name: '' }),
      party({ display_name: 'Baker', unit_name: '' }),
      party({ display_name: 'Chen', unit_name: '' }),
    ])
    expect(sections[0]?.parties.map((p) => p.display_name)).toEqual(['Adams', 'Baker', 'Chen'])
  })

  it('reports a single section when every party shares one state', () => {
    // An untouched adult weekend: 123 parties, all unplaced, no constraints.
    // Labelling that "Needs a cabin (123)" above the entire roster is noise,
    // so callers can tell it is not worth sectioning.
    const sections = attentionSections([
      party({ unit_name: '' }),
      party({ unit_name: '', display_name: 'Second' }),
    ])
    expect(sections).toHaveLength(1)
    expect(sections[0]?.level).toBe('unplaced')
  })

  it('returns nothing for an empty roster', () => {
    expect(attentionSections([])).toEqual([])
  })
})
