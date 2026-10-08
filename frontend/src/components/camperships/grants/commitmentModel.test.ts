/** A hand-entered commitment's choices and body (§8.2; D55; P-16, review item 21). */
import { describe, expect, it } from 'vitest'

import { GRID_ROWS, gridRow } from '../requests/gridFixtures'
import { RILEY_COMMITMENT } from './grantsFixtures'
import { camperChoices, choiceOf, draftOf, emptyDraft, readCommitment } from './commitmentModel'

describe('camperChoices', () => {
  it("offers each request's camper once, by camper and session, never a household's own request", () => {
    const choices = camperChoices([
      ...GRID_ROWS,
      gridRow({ request_id: 'reqfamily000009', person_cm_id: 0 }),
    ])
    expect(choices.map((c) => c.label)).toContain('Emma Johnson · Session 2 · The Johnson Family')
    expect(choices.every((c) => c.personCmId > 0)).toBe(true)
    expect(new Set(choices.map((c) => c.key)).size).toBe(choices.length)
  })

  it('picks the one camper there is (the household page’s Add a Commitment…)', () => {
    const [emma] = GRID_ROWS
    const choices = camperChoices(emma === undefined ? [] : [emma])
    expect(emptyDraft('2027-04-20', choices).camperKey).toBe(choices[0]?.key)
    expect(emptyDraft('2027-04-20', camperChoices(GRID_ROWS)).camperKey).toBe('')
  })
})

describe('draftOf', () => {
  it('keeps the stored note and the date it was committed (review item 21)', () => {
    expect(draftOf(RILEY_COMMITMENT)).toEqual({
      grantorKey: 'grantor_c',
      camperKey: '2000004:1000103',
      amount: '6200',
      committedOn: '2027-04-02',
      note: 'Letter of Apr 2',
    })
  })
})

describe('readCommitment', () => {
  const choices = [choiceOf(RILEY_COMMITMENT)]

  it("sends the whole commitment, the amount exact to the cent, and the camper's session", () => {
    expect(readCommitment({ ...draftOf(RILEY_COMMITMENT), amount: '6,200.5' }, choices)).toEqual({
      ok: true,
      body: {
        grantor_key: 'grantor_c',
        household_cm_id: 1000004,
        person_cm_id: 2000004,
        session_cm_id: 1000103,
        amount: '6200.50',
        committed_on: '2027-04-02',
        note: 'Letter of Apr 2',
      },
    })
  })

  it('says what is missing first', () => {
    expect(readCommitment(emptyDraft('2027-04-20'), choices)).toEqual({
      ok: false,
      problem: 'Pick the grantor',
    })
    expect(readCommitment({ ...draftOf(RILEY_COMMITMENT), amount: '0' }, choices)).toEqual({
      ok: false,
      problem: 'More than $0',
    })
  })
})
