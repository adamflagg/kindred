/** Placing a grant line on a camper (§8.2; D16, D126; P-17): words, body, the fresh check. */
import { describe, expect, it } from 'vitest'

import { GARCIA_HOUSEHOLD, GRANTS } from './grantsFixtures'
import {
  evidenceLines,
  evidenceWords,
  grantEffects,
  placedGrantWords,
  placementFor,
  stillNeedsCamper,
  suggestionCell,
  suggestionShort,
} from './placeModel'

const [GARCIA] = GRANTS.needs_camper

describe('placeModel', () => {
  it('words the suggestion and its evidence, never in code', () => {
    if (GARCIA?.suggestion == null) throw new Error('fixture')
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

  it('draws the evidence one ✓ fact per line, and a ○ when there is no suggestion (§16)', () => {
    if (GARCIA?.suggestion == null) throw new Error('fixture')
    expect(evidenceLines(GARCIA)).toEqual(["✓ the household's one camper enrolled this season"])
    expect(
      evidenceLines({
        ...GARCIA,
        suggestion: { ...GARCIA.suggestion, basis: 'commitment', method: '', amount_matches: true },
      })
    ).toEqual(['✓ a commitment from Grantor B names Liam Garcia, for this amount'])
    expect(evidenceLines({ ...GARCIA, suggestion: null })).toEqual([
      '○ the dashboard has no suggestion: pick the camper',
    ])
  })

  it('words the suggestion cell short, the session in the one-line form (§14)', () => {
    if (GARCIA?.suggestion == null) throw new Error('fixture')
    const sessions = new Map([
      [GARCIA.suggestion.session_cm_id, 'Family Camp 2: Fall Harvest Weekend'],
    ])
    expect(suggestionShort(GARCIA, sessions)).toBe('Liam Garcia · FC2')
    expect(suggestionShort(GARCIA, new Map([[GARCIA.suggestion.session_cm_id, 'Session 2']]))).toBe(
      'Liam Garcia · Session 2'
    )
    expect(suggestionShort({ ...GARCIA, suggestion: null }, sessions)).toBe(
      'No suggestion: pick the camper'
    )
  })

  it('says what Confirm does for a grant line, one effect per line', () => {
    if (GARCIA?.suggestion == null) throw new Error('fixture')
    const sessions = new Map([[GARCIA.suggestion.session_cm_id, 'Session 2']])
    expect(grantEffects(GARCIA, sessions)).toEqual([
      {
        sym: 'info',
        text: "Lowers Liam Garcia · Session 2's share by $1,500 in the round it counts in",
      },
      { sym: 'hand', text: 'A Posted round stands' },
    ])
    expect(grantEffects({ ...GARCIA, suggestion: null }, sessions)).toEqual([
      {
        sym: 'hand',
        lead: 'Nothing to confirm yet',
        text: ': pick the camper',
        then: '→ Another Camper… and choose Liam Garcia',
      },
    ])
  })
})
