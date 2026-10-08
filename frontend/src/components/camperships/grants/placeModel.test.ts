/** Placing a grant line on a camper (§8.2; D16, D126; P-17): words, body, the fresh check. */
import { describe, expect, it } from 'vitest'

import { GARCIA_HOUSEHOLD, GRANTS } from './grantsFixtures'
import {
  evidenceWords,
  placedGrantWords,
  placementFor,
  stillNeedsCamper,
  suggestedWords,
  suggestionCell,
} from './placeModel'

const [GARCIA] = GRANTS.needs_camper

describe('placeModel', () => {
  it('words the suggestion and its evidence, never in code', () => {
    if (GARCIA?.suggestion == null) throw new Error('fixture')
    expect(suggestedWords(GARCIA, { summer: 'Summer Camp' })).toBe('Liam Garcia (Summer Camp)')
    expect(evidenceWords(GARCIA)).toBe(
      "Liam Garcia: the household's one camper enrolled this season."
    )
    expect(
      evidenceWords({
        ...GARCIA,
        suggestion: { ...GARCIA.suggestion, basis: 'commitment', method: '', amount_matches: true },
      })
    ).toBe('A commitment from Grantor B names Liam Garcia, for this amount.')
    expect(evidenceWords({ ...GARCIA, suggestion: null })).toBe(
      'The dashboard has no suggestion: pick the camper.'
    )
  })

  it("prefers the server's program_label over the rules' names (M5)", () => {
    if (GARCIA?.suggestion == null) throw new Error('fixture')
    const labelled = {
      ...GARCIA,
      suggestion: { ...GARCIA.suggestion, program_label: 'Summer Camp 2' },
    }
    expect(suggestedWords(labelled, {})).toBe('Liam Garcia (Summer Camp 2)')
    expect(suggestedWords(labelled, { summer: 'Other name' })).toBe('Liam Garcia (Summer Camp 2)')
  })

  it('words the To place suggestion cell as camper · session, with no program label', () => {
    if (GARCIA?.suggestion == null) throw new Error('fixture')
    const sessions = new Map([[GARCIA.suggestion.session_cm_id, 'Session 2']])
    expect(suggestionCell(GARCIA, sessions)).toBe('Liam Garcia · Session 2')
    expect(suggestionCell(GARCIA, new Map())).toBe('Liam Garcia')
    expect(suggestionCell(GARCIA, undefined)).toBe('Liam Garcia')
    expect(suggestionCell({ ...GARCIA, suggestion: null }, sessions)).toBe(
      'No suggestion: pick the camper'
    )
  })

  it("sends the suggestion's session with the suggested camper, and none with another (P-17)", () => {
    if (GARCIA === undefined) throw new Error('fixture')
    expect(placementFor(GARCIA, 2000002)).toEqual({
      transaction_cm_id: 4000002,
      person_cm_id: 2000002,
      session_cm_id: 1000102,
    })
    expect(placementFor(GARCIA, 2000009).session_cm_id).toBeNull()
  })

  it('knows whether a read still lists the line', () => {
    expect(stillNeedsCamper(GRANTS, GARCIA_HOUSEHOLD.transaction_cm_id)).toBe(true)
    expect(
      stillNeedsCamper({ ...GRANTS, needs_camper: [] }, GARCIA_HOUSEHOLD.transaction_cm_id)
    ).toBe(false)
  })

  it('says what a placement did', () => {
    expect(placedGrantWords({ year: 2027, placed: 2, unchanged: 1, operation_id: 'op1' })).toBe(
      '2 lines placed on their campers, 1 already placed that way. An unposted round re-prices with the grant; a posted amount stands.'
    )
    expect(placedGrantWords({ year: 2027, placed: 1, unchanged: 0, operation_id: 'op1' })).toBe(
      '1 line placed on its camper. An unposted round re-prices with the grant; a posted amount stands.'
    )
  })
})
