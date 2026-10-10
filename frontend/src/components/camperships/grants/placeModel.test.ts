/** Placing a grant line on a camper (§8.2; D16, D126; P-17): words, body, the fresh check. */
import { describe, expect, it } from 'vitest'

import { GARCIA_HOUSEHOLD, GRANTS } from './grantsFixtures'
import {
  evidenceLines,
  evidenceWords,
  grantEffects,
  placedGrantWords,
  candidateSessions,
  needsSessionPick,
  pickedSession,
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

  // Owner 2026-10-10: "one session automatic, and the rest as you said yes, no 'lowest/first' type bad guessing."
  // (Was: else the first session. The ruling replaces that pin.)
  it("offers a candidate's sessions: one is automatic, a suggestion pre-picks, otherwise nothing is guessed", () => {
    if (GARCIA === undefined) throw new Error('fixture')
    const sessions = [
      { session_cm_id: 1000101, name: 'Session 1', session_type: 'main' },
      { session_cm_id: 1000102, name: 'Session 2', session_type: 'main' },
    ]
    const need = {
      ...GARCIA,
      candidates: [
        { person_cm_id: 2000002, name: 'Liam Garcia', sessions },
        { person_cm_id: 2000009, name: 'Mia Garcia', sessions },
        { person_cm_id: 2000010, name: 'Noa Garcia' },
        { person_cm_id: 2000011, name: 'Ava Garcia', sessions: [sessions[1]!] },
      ],
    }
    expect(candidateSessions(need, 2000002).map((s) => s.session_cm_id)).toEqual([1000101, 1000102])
    expect(candidateSessions(need, 2000010)).toEqual([])
    expect(candidateSessions(need, 7)).toEqual([])
    // The suggestion names 1000102 for Liam: pre-picked.
    expect(pickedSession(need, 2000002, '')).toBe(1000102)
    expect(needsSessionPick(need, 2000002, '')).toBe(false)
    // Mia: two sessions and no suggestion for her: none, never the first or lowest; Place waits for a pick.
    expect(pickedSession(need, 2000009, '')).toBeNull()
    expect(needsSessionPick(need, 2000009, '')).toBe(true)
    expect(pickedSession(need, 2000009, '1000102')).toBe(1000102)
    expect(needsSessionPick(need, 2000009, '1000102')).toBe(false)
    // A pick that isn't one of the camper's sessions is ignored.
    expect(pickedSession(need, 2000009, '5')).toBeNull()
    expect(needsSessionPick(need, 2000009, '5')).toBe(true)
    // One session: used automatically.
    expect(pickedSession(need, 2000011, '')).toBe(1000102)
    expect(needsSessionPick(need, 2000011, '')).toBe(false)
    // No sessions known: the suggestion's, else none (the server finds it); nothing to pick.
    expect(pickedSession(need, 2000010, '')).toBeNull()
    expect(needsSessionPick(need, 2000010, '')).toBe(false)
  })

  it('pre-picks a suggestion only when it names one of the camper’s sessions', () => {
    if (GARCIA?.suggestion == null) throw new Error('fixture')
    const sessions = [
      { session_cm_id: 1000101, name: 'Session 1', session_type: 'main' },
      { session_cm_id: 1000102, name: 'Session 2', session_type: 'main' },
    ]
    const need = {
      ...GARCIA,
      suggestion: { ...GARCIA.suggestion, person_cm_id: 2000002, session_cm_id: 1000999 },
      candidates: [{ person_cm_id: 2000002, name: 'Liam Garcia', sessions }],
    }
    expect(pickedSession(need, 2000002, '')).toBeNull()
    expect(needsSessionPick(need, 2000002, '')).toBe(true)
  })

  it('places on the session picked, over the suggestion', () => {
    if (GARCIA === undefined) throw new Error('fixture')
    expect(placementFor(GARCIA, 2000002, 1000101).session_cm_id).toBe(1000101)
    expect(placementFor(GARCIA, 2000009, 1000103).session_cm_id).toBe(1000103)
    expect(placementFor(GARCIA, 2000009, null).session_cm_id).toBeNull()
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

  it('draws the evidence one ✓ fact per line, none when there is no suggestion (§16)', () => {
    if (GARCIA?.suggestion == null) throw new Error('fixture')
    expect(evidenceLines(GARCIA)).toEqual(["✓ the household's one camper enrolled this season"])
    expect(
      evidenceLines({
        ...GARCIA,
        suggestion: { ...GARCIA.suggestion, basis: 'commitment', method: '', amount_matches: true },
      })
    ).toEqual(['✓ a commitment from Grantor B names Liam Garcia, for this amount'])
    // With no suggestion the line above already says "No suggestion: pick the camper"; no fact repeats it.
    expect(evidenceLines({ ...GARCIA, suggestion: null })).toEqual([])
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
