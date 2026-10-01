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
