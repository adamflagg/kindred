import { describe, expect, it, vi } from 'vitest'

import { invalidateAidMoneyQueries, queryKeys } from './queryKeys'

describe('Camperships query keys', () => {
  it("sit under one 'financial-aid' prefix, so a sync or a write can invalidate by prefix (spec §10)", () => {
    expect(queryKeys.aidRemaining(2027, null, null).slice(0, 2)).toEqual(
      queryKeys.aidRemainingPrefix()
    )
    expect(queryKeys.aidRemainingPrefix()[0]).toBe(queryKeys.aidPrefix()[0])
  })

  it('puts a household page under the prefix invalidateAidMoneyQueries refreshes (review M4)', () => {
    expect(queryKeys.aidHouseholdPage(2027, 1000001).slice(0, 2)).toEqual(
      queryKeys.aidHouseholdPagePrefix()
    )
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

describe("invalidateAidMoneyQueries (spec §10; #2924's invalidation table)", () => {
  const keysOf = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls.map(([args]) => (args as { queryKey: unknown[] }).queryKey)

  it('returns a promise that settles only once every refresh it starts has (build ruling 1)', async () => {
    let finish: (() => void) | undefined
    const gridRefetch = new Promise<void>((resolve) => {
      finish = resolve
    })
    const invalidateQueries = vi.fn((args: { queryKey: readonly unknown[] }) =>
      args.queryKey[1] === 'grid' ? gridRefetch : Promise.resolve()
    )
    let settled = false
    const done = invalidateAidMoneyQueries({ invalidateQueries }).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    finish?.()
    await done
    expect(settled).toBe(true)
  })

  it('keeps the application key under the prefix every write refreshes', () => {
    expect(queryKeys.aidApplication(2027, 1000001).slice(0, 2)).toEqual(
      queryKeys.aidApplicationPrefix()
    )
  })

  it('refreshes every read a write can move, and leaves the definitions and the jump index', () => {
    const invalidateQueries = vi.fn()
    void invalidateAidMoneyQueries({ invalidateQueries })
    expect(keysOf(invalidateQueries)).toEqual([
      ['financial-aid', 'remaining'],
      ['financial-aid', 'budget'],
      ['financial-aid', 'grid'],
      ['financial-aid', 'today'],
      ['financial-aid', 'household-page'],
      ['financial-aid', 'application'],
    ])
  })

  it('refreshes the jump index too when a write changes who has aid activity (payer shares)', () => {
    const invalidateQueries = vi.fn()
    void invalidateAidMoneyQueries({ invalidateQueries }, { jumpIndex: true })
    expect(keysOf(invalidateQueries)).toEqual([
      ['financial-aid', 'remaining'],
      ['financial-aid', 'budget'],
      ['financial-aid', 'grid'],
      ['financial-aid', 'today'],
      ['financial-aid', 'household-page'],
      ['financial-aid', 'application'],
      ['financial-aid', 'jump-index'],
    ])
    expect(queryKeys.aidJumpIndex(2027).slice(0, 2)).toEqual(queryKeys.aidJumpIndexPrefix())
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

describe('the Rounds & budget key (slice 2)', () => {
  it('sits under the budget prefix, apart per season, as-of and axis', () => {
    expect(queryKeys.aidBudget(2027, null, null).slice(0, 2)).toEqual(queryKeys.aidBudgetPrefix())
    expect(queryKeys.aidBudget(2027, null, null)).not.toEqual(
      queryKeys.aidBudget(2027, '2026-04-01', null)
    )
    expect(queryKeys.aidBudget(2027, '2026-04-01', 'campminder')).not.toEqual(
      queryKeys.aidBudget(2027, '2026-04-01', 'recorded')
    )
  })
})
