import { describe, expect, it, vi } from 'vitest'

import { invalidateAidMoneyQueries, queryKeys } from './queryKeys'

describe('Camperships query keys', () => {
  it("sit under one 'financial-aid' prefix, so a sync or a write can invalidate by prefix (spec §10)", () => {
    expect(queryKeys.aidRemaining(2027, null, null).slice(0, 2)).toEqual(
      queryKeys.aidRemainingPrefix()
    )
    expect(queryKeys.aidRemainingPrefix()[0]).toBe(queryKeys.aidPrefix()[0])
  })

  it('tell a live read from a past one, and the two axes apart', () => {
    expect(queryKeys.aidRemaining(2027, null, null)).not.toEqual(
      queryKeys.aidRemaining(2027, '2026-04-01', null)
    )
    expect(queryKeys.aidRemaining(2027, '2026-04-01', 'campminder')).not.toEqual(
      queryKeys.aidRemaining(2027, '2026-04-01', 'recorded')
    )
  })
})

describe('invalidateAidMoneyQueries (D48: Remaining moves live)', () => {
  it('invalidates the Remaining line by prefix', () => {
    const invalidateQueries = vi.fn()
    invalidateAidMoneyQueries({ invalidateQueries })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'remaining'] })
  })
})

describe('the Requests grid key', () => {
  it('sits under the grid prefix, apart per season, as-of and axis', () => {
    expect(queryKeys.aidGrid(2027, null, null).slice(0, 2)).toEqual(queryKeys.aidGridPrefix())
    expect(queryKeys.aidGrid(2027, null, null)).not.toEqual(
      queryKeys.aidGrid(2027, '2026-04-01', null)
    )
    expect(queryKeys.aidGrid(2027, '2026-04-01', 'campminder')).not.toEqual(
      queryKeys.aidGrid(2027, '2026-04-01', 'recorded')
    )
  })
})

describe('the approved-rules key (slice 2, read in the Requests grid)', () => {
  it('sits under the rules prefix, one key per version and one for the pricing read', () => {
    expect(queryKeys.aidRulesApproved(2027, 3).slice(0, 2)).toEqual(queryKeys.aidRulesPrefix())
    expect(queryKeys.aidRulesApproved(2027, null)).toEqual([
      'financial-aid',
      'rules',
      2027,
      'approved',
      'pricing',
    ])
    expect(queryKeys.aidRulesApproved(2027, 3)).not.toEqual(queryKeys.aidRulesApproved(2027, 4))
  })
})
