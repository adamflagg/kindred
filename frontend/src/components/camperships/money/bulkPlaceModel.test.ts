/** The bulk confirm (§4.10's one exception; owner ruling Group 3a Q4; P-6). */
import { describe, expect, it } from 'vitest'

import {
  bulkBody,
  bulkEligible,
  bulkPlan,
  estimateLocked,
  exactButtonWords,
  MAX_BULK_LINES,
} from './bulkPlaceModel'
import {
  CHEN_EXACT,
  GARCIA_WITHHELD,
  JOHNSON_SPLIT,
  RILEY_EXACT,
  SAM_NO_REQUEST,
  SAMUEL_MISMATCH,
} from './toPlaceFixtures'

const OPEN = [
  JOHNSON_SPLIT,
  GARCIA_WITHHELD,
  CHEN_EXACT,
  SAM_NO_REQUEST,
  SAMUEL_MISMATCH,
  RILEY_EXACT,
]
const keys = (...ids: number[]) => new Set(ids.map(String))

describe('bulkEligible: several requests, one candidate, one part, an exact amount', () => {
  it('takes exact single matches only', () => {
    expect(OPEN.filter(bulkEligible).map((l) => l.transaction_cm_id)).toEqual([3000003, 3000008])
    expect(bulkEligible({ ...CHEN_EXACT, left_note: 'Left' })).toBe(false)
    expect(bulkEligible({ ...CHEN_EXACT, reclassified_to: 'Grantor A grant' })).toBe(false)
  })

  it('never takes a program mismatch, even with one candidate and an exact amount (plan review I3)', () => {
    // A judgement call: Reclassify may be the right answer (money-v2.html: bulk on "several" only).
    expect(SAMUEL_MISMATCH.candidates).toHaveLength(1)
    expect(bulkEligible(SAMUEL_MISMATCH)).toBe(false)
    expect(bulkEligible({ ...SAMUEL_MISMATCH, reason: 'several' })).toBe(true)
  })

  it('wants the exact amount as evidence, not only one request', () => {
    const noAmount = {
      ...CHEN_EXACT,
      suggestion: CHEN_EXACT.suggestion && {
        ...CHEN_EXACT.suggestion,
        evidence: [{ kind: 'only_request' as const, text: 'The family’s one live request.' }],
      },
    }
    expect(bulkEligible(noAmount)).toBe(false)
  })
})

describe('bulkPlan', () => {
  it('takes the exact matches checked, marks those the search hides, and names what it leaves out', () => {
    const plan = bulkPlan(OPEN, keys(3000003, 3000008, 3000005, 3000001), keys(3000008))
    expect(plan.lines.map((b) => [b.line.transaction_cm_id, b.hidden])).toEqual([
      [3000003, false],
      [3000008, true],
    ])
    expect(plan.leftOut.map((l) => [l.line.transaction_cm_id, l.why])).toEqual([
      [3000001, 'a split'],
      [3000005, 'a program mismatch: confirm it beside its evidence'],
    ])
    expect(plan.households).toBe(2)
    expect(plan.gone).toBe(0)
  })

  it('counts the checked lines the current read no longer holds open (plan review I4)', () => {
    const plan = bulkPlan(
      OPEN.filter((l) => l !== RILEY_EXACT),
      keys(3000003, 3000008),
      new Set()
    )
    expect(plan.lines.map((b) => b.line.transaction_cm_id)).toEqual([3000003])
    expect(plan.gone).toBe(1)
  })

  it("adds each line's own preview, in whole cents, into a total the dialog labels an estimate", () => {
    expect(estimateLocked(bulkPlan(OPEN, keys(3000003, 3000008), new Set()))).toBe(1800)
    const cents = {
      ...RILEY_EXACT,
      suggestion: RILEY_EXACT.suggestion && { ...RILEY_EXACT.suggestion, would_lock: 0.1 },
    }
    const chen = {
      ...CHEN_EXACT,
      suggestion: CHEN_EXACT.suggestion && { ...CHEN_EXACT.suggestion, would_lock: 0.2 },
    }
    expect(estimateLocked(bulkPlan([chen, cents], keys(3000003, 3000008), new Set()))).toBe(0.3)
  })

  it("sends each line's suggested part, exact to the cent, and no expected_locked for several lines", () => {
    expect(bulkBody(bulkPlan(OPEN, keys(3000003, 3000008), new Set()))).toEqual({
      lines: [
        {
          transaction_cm_id: 3000003,
          parts: [{ request_id: 'reqolivia000003', amount: '1500.00' }],
        },
        {
          transaction_cm_id: 3000008,
          parts: [{ request_id: 'reqriley0000006', amount: '300.00' }],
        },
      ],
      note: '',
    })
  })

  it('sends expected_locked for one line, which the route takes (plan review m6)', () => {
    expect(bulkBody(bulkPlan(OPEN, keys(3000003), new Set()))).toEqual({
      lines: [
        {
          transaction_cm_id: 3000003,
          parts: [{ request_id: 'reqolivia000003', amount: '1500.00' }],
        },
      ],
      note: '',
      expected_locked: '1500.00',
    })
  })

  it('leaves out a line whose own Confirm is still out, by name (R1-13: the batch is all or nothing)', () => {
    const plan = bulkPlan(OPEN, keys(3000003, 3000008), new Set(), (txn) => txn === 3000008)
    expect(plan.lines.map((b) => b.line.transaction_cm_id)).toEqual([3000003])
    expect(plan.leftOut.map((o) => [o.line.transaction_cm_id, o.why])).toEqual([
      [3000008, 'still saving: confirm it when it finishes'],
    ])
  })
})

describe('exactButtonWords (R1-13: one click takes at most what the route takes)', () => {
  it('names the count, and the first 200 when there are more', () => {
    expect(MAX_BULK_LINES).toBe(200)
    expect(exactButtonWords(1)).toBe('Confirm the 1 Exact Single Match…')
    expect(exactButtonWords(2)).toBe('Confirm the 2 Exact Single Matches…')
    expect(exactButtonWords(200)).toBe('Confirm the 200 Exact Single Matches…')
    expect(exactButtonWords(250)).toBe('Confirm the First 200 of 250 Exact Single Matches…')
  })
})
