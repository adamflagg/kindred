/**
 * The Requests grid's Session and Camper cells in the final language: Session reads the owner's ruled
 * TINY form everywhere (§14, "Requests uses tiny everywhere") with the full name as its title; a
 * household-level request names its household, never "Household request" (§15). Fictional rows.
 */
import { describe, expect, it } from 'vitest'

import { gridRow } from './gridFixtures'
import {
  camperLabel,
  camperTitle,
  householdLabelOf,
  isHouseholdRequest,
  SESSION_UNCLEAR_TITLE,
  sessionCell,
} from './cells'

describe('sessionCell (§14: tiny everywhere, the full name in the title)', () => {
  it('reads the ruled tiny words and titles the full name', () => {
    const fc = gridRow({
      session_name: 'Family Camp 4: Labor Day Weekend (w/ kids 10 and under)',
      session_type: 'family',
    })
    expect(sessionCell(fc)).toEqual({
      text: 'FC4',
      title: 'Family Camp 4: Labor Day Weekend (w/ kids 10 and under)',
    })
    expect(sessionCell(gridRow({ session_name: 'Session 2', session_type: 'main' })).text).toBe(
      'S2'
    )
    expect(
      sessionCell(
        gridRow({
          session_name: 'All-Gender Cabin-Session 2 (7th & 8th grades)',
          session_type: 'ag',
        })
      ).text
    ).toBe('AG 2')
  })

  it('falls back when the row carries no session_type (an older read)', () => {
    const cell = sessionCell(gridRow({ session_name: 'Session 3' }))
    expect(cell?.title).toBe('Session 3')
    expect(cell?.text).not.toBe('')
  })

  it('is the dash with the unclear words when no session matched', () => {
    expect(sessionCell(gridRow({ session_name: '' }))).toEqual({
      text: '—',
      title: SESSION_UNCLEAR_TITLE,
    })
    expect(SESSION_UNCLEAR_TITLE).toBe(
      'Session unclear: no one enrolled session matches the request yet.'
    )
  })
})

describe('the Camper cell (§15)', () => {
  const household = gridRow({
    camper_name: '',
    person_cm_id: 0,
    family_name: 'The Johnson Family',
    household_label: 'Mia & Noah Johnson',
    household_label_tiebreak: 'Riverside',
  })

  it('names a camper as ever', () => {
    const row = gridRow()
    expect(isHouseholdRequest(row)).toBe(false)
    expect(camperLabel(row)).toBe('Emma Johnson')
    expect(householdLabelOf(row)).toBeNull()
    expect(camperTitle(row)).toBe('Emma Johnson')
  })

  it('names a household-level request by its label, with the tiebreak apart', () => {
    expect(isHouseholdRequest(household)).toBe(true)
    expect(camperLabel(household)).toBe('Mia & Noah Johnson')
    expect(householdLabelOf(household)).toEqual({
      text: 'Mia & Noah Johnson',
      tiebreak: 'Riverside',
    })
    // The tiebreak rides in the title too, so a cut one reads whole (the mock's CF.hh).
    expect(camperTitle(household)).toBe(
      'Household request (Family Camp): Mia & Noah Johnson · Riverside'
    )
    expect(camperTitle({ ...household, household_label_tiebreak: '' })).toBe(
      'Household request (Family Camp): Mia & Noah Johnson'
    )
  })

  it('falls back to the family name when the label is empty, and never says "Household request" as the name', () => {
    const bare = gridRow({ camper_name: '', family_name: 'The Chen Family', household_label: '' })
    expect(camperLabel(bare)).toBe('The Chen Family')
    expect(householdLabelOf(bare)).toEqual({ text: 'The Chen Family', tiebreak: '' })
    const none = gridRow({ camper_name: '', family_name: '', household_label: '' })
    expect(camperLabel(none)).toBe('—')
  })
})
