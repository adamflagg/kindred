import { describe, expect, it } from 'vitest'

import { gridRow, roundOut, ROW_EMMA, ROW_OLIVIA } from '../requests/gridFixtures'
import { cardEdits } from './cardEdits'

describe('cardEdits (§4.6; Decisions 13, 23)', () => {
  it('offers nothing before Round 1 is posted', () => {
    expect(cardEdits(ROW_EMMA)).toEqual([])
  })

  it('offers the appeal and the Round 3 ask once Round 1 is posted, and the amount once asked', () => {
    expect(cardEdits(ROW_OLIVIA)).toEqual(['appeal', 'round3_ask'])
    // The read names no appeal refusal once Round 1 is posted (#2997: the server owns the refusal).
    const asked = gridRow({
      rounds: [roundOut(1, 'posted'), roundOut(3, 'not_decided', { ask: 450 })],
      appeal_refusal: null,
    })
    expect(cardEdits(asked)).toEqual(['appeal', 'round3_ask', 'round3_amount'])
  })

  it('offers no Round 3 edit once Round 3 is posted, and nothing on a Kindred cancellation', () => {
    const r3Posted = gridRow({
      rounds: [roundOut(1, 'posted'), roundOut(3, 'posted', { ask: 450 })],
    })
    expect(cardEdits(r3Posted)).not.toContain('round3_ask')
    expect(cardEdits(r3Posted)).not.toContain('round3_amount')
    expect(
      cardEdits({
        ...ROW_OLIVIA,
        cancellation: { by: 'kindred', on: null, reason: 'medical', note: '' },
      })
    ).toEqual([])
  })

  it('offers nothing on a CampMinder cancellation either (B35)', () => {
    const asked = gridRow({
      rounds: [roundOut(1, 'posted'), roundOut(3, 'not_decided', { ask: 450 })],
      appeal_refusal: null,
      cancellation: { by: 'campminder', on: '2027-06-02', reason: null, note: '' },
    })
    expect(cardEdits(asked)).toEqual([])
  })

  it('offers no appeal once Round 2 is posted', () => {
    const r2Posted = gridRow({
      rounds: [roundOut(1, 'posted'), roundOut(2, 'posted', { ask: 900 })],
      appeal_refusal: "Round 2 is posted; its ask can't change",
    })
    expect(cardEdits(r2Posted)).toEqual(['round3_ask'])
  })

  it('offers nothing on a withdrawn or duplicate request, even with Round 1 posted', () => {
    for (const request_status of ['withdrawn', 'duplicate']) {
      const dead = gridRow({ request_status, rounds: [roundOut(1, 'posted')] })
      expect(cardEdits(dead)).toEqual([])
    }
  })
})
