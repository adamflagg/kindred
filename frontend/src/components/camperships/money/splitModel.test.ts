/** Split… and Place on Another Request… (§8.1; D12): typed parts read and checked as the server does. */
import { describe, expect, it } from 'vitest'

import { initialInputs, readSplit, wholeLineOn } from './splitModel'
import {
  EMMA_REQ,
  GARCIA_WITHHELD,
  JOHNSON_SPLIT,
  LIAM_QUEST_REQ,
  LIAM_REQ,
  SAMUEL_MISMATCH,
  SAMUEL_REQ,
} from './toPlaceFixtures'

describe('initialInputs', () => {
  it("starts from the suggestion's parts, the other candidates blank", () => {
    expect(initialInputs(JOHNSON_SPLIT)).toEqual({ [EMMA_REQ]: '2200', [SAMUEL_REQ]: '1420' })
    expect(initialInputs(GARCIA_WITHHELD)).toEqual({ [LIAM_REQ]: '600', [LIAM_QUEST_REQ]: '' })
  })
})

describe('readSplit', () => {
  it('sends the parts exact to the cent when they add up to the line, and says so', () => {
    expect(readSplit(JOHNSON_SPLIT, { [EMMA_REQ]: '2,000.50', [SAMUEL_REQ]: '1619.50' })).toEqual({
      ok: true,
      body: {
        parts: [
          { request_id: EMMA_REQ, amount: '2000.50' },
          { request_id: SAMUEL_REQ, amount: '1619.50' },
        ],
        note: '',
      },
      // The ✓ is drawn as a symbol beside the words (design-language §16; mock `editor`).
      words: 'Parts add to $3,620 of $3,620',
    })
  })

  it('leaves a blank or $0 part off', () => {
    expect(readSplit(JOHNSON_SPLIT, { [EMMA_REQ]: '3620', [SAMUEL_REQ]: '0' })).toMatchObject({
      ok: true,
      body: { parts: [{ request_id: EMMA_REQ, amount: '3620.00' }] },
    })
  })

  it('says what is wrong in staff words, to the cent', () => {
    expect(readSplit(JOHNSON_SPLIT, { [EMMA_REQ]: '2200', [SAMUEL_REQ]: '1400' })).toEqual({
      ok: false,
      problem: 'Parts add to $3,600: they must make $3,620',
    })
    // A cent short is short: float noise never makes a sum "close enough".
    expect(readSplit(JOHNSON_SPLIT, { [EMMA_REQ]: '2200', [SAMUEL_REQ]: '1419.99' })).toMatchObject(
      { ok: false }
    )
    expect(readSplit(JOHNSON_SPLIT, { [EMMA_REQ]: '22.005' })).toEqual({
      ok: false,
      problem: 'Emma Johnson · Session 2: Cents go to two places',
    })
    expect(readSplit(JOHNSON_SPLIT, {})).toEqual({ ok: false, problem: 'Type at least one part' })
  })

  it('takes at most ten parts, as the server does', () => {
    const [samuel] = SAMUEL_MISMATCH.candidates
    if (samuel === undefined) throw new Error('the fixture lost its candidate')
    const many = Array.from({ length: 11 }, (_, i) => ({
      ...samuel,
      request_id: `reqmany0000${String(i).padStart(4, '0')}`,
    }))
    const line = { ...SAMUEL_MISMATCH, amount: 1100, candidates: many }
    const inputs = Object.fromEntries(many.map((c) => [c.request_id, '100']))
    expect(readSplit(line, inputs)).toEqual({ ok: false, problem: 'At most 10 parts' })
  })
})

describe('wholeLineOn', () => {
  it('places all of the line on one request', () => {
    expect(wholeLineOn(SAMUEL_MISMATCH, SAMUEL_REQ)).toEqual({
      parts: [{ request_id: SAMUEL_REQ, amount: '300.00' }],
      note: '',
    })
  })
})
