import { describe, expect, it } from 'vitest'

import type { AidView } from '../kit/asOf'
import { BUDGET, pastBudget, pastBudgetUnmasked } from './budgetFixtures'
import { demandGroups } from './demandModel'

const LIVE: AidView = { year: 2027, asOf: { kind: 'live' } }
const PAST: AidView = { year: 2027, asOf: { kind: 'past', date: '2027-03-15', axis: 'campminder' } }

describe('forward demand (§5.9, §7.2; D82)', () => {
  it("lists each pool with demand, then the total; the empty No pool line isn't shown", () => {
    expect(demandGroups(BUDGET, null, LIVE).map((g) => g.label)).toEqual([
      'Pool A',
      'Pool B',
      'Total',
    ])
  })

  it("shows Round 2 asks so far as the server counts them, opening the pool's live appeals", () => {
    const [poolA] = demandGroups(BUDGET, null, LIVE)
    expect(poolA?.lines[0]).toEqual({
      key: 'round2_asks',
      label: 'Round 2 asks so far',
      requests: { families: 30, requests: 31 },
      asked: 33000,
      computed: 20500,
      unmet: null,
      held: { families: 2, requests: 2 },
      heldAsked: 2600,
      href: '/aid/requests?view=appeals&pool=pool_a&live=1&year=2027',
    })
  })

  it("shows Round 1's unmet ask, not yet appealed, with the server's count and its held asks", () => {
    const [poolA] = demandGroups(BUDGET, null, LIVE)
    expect(poolA?.lines[1]).toEqual({
      key: 'round1_unmet',
      label: 'Round 1 unmet ask, not yet appealed',
      requests: { families: 40, requests: 44 },
      asked: null,
      computed: null,
      unmet: 50920,
      held: { families: 4, requests: 7 },
      heldAsked: 16300,
      // No grid filter expresses "no Round 2 ask keyed yet", so it opens nothing.
      href: null,
    })
  })

  it("opens the total's appeals without a pool, and one pool alone when the page is on it", () => {
    const total = demandGroups(BUDGET, null, LIVE).at(-1)
    expect(total?.lines[0]?.href).toBe('/aid/requests?view=appeals&live=1&year=2027')
    expect(demandGroups(BUDGET, 'pool_b', LIVE).map((g) => g.label)).toEqual(['Pool B'])
    expect(demandGroups(BUDGET, 'pool_zz', LIVE)).toEqual([])
  })

  it('keeps "—" where a past date leaves the read empty, and opens nothing', () => {
    const [poolA] = demandGroups(pastBudget(), null, PAST)
    expect(poolA?.lines[0]?.computed).toBeNull()
    expect(poolA?.lines[0]?.held).toBeNull()
    expect(poolA?.lines[1]?.unmet).toBeNull()
    expect(poolA?.lines[1]?.requests).toBeNull()
    // Appeals is a today view; the Requests page refuses it on a past date.
    expect(poolA?.lines[0]?.href).toBeNull()
    expect(demandGroups(pastBudget(), null, PAST).every((g) => g.lines[0]?.href === null)).toBe(
      true
    )
  })

  it('opens no appeals on a past date even where the read is unmasked', () => {
    const [poolA] = demandGroups(pastBudgetUnmasked(), null, PAST)
    expect(poolA?.lines[0]?.requests).toEqual({ families: 30, requests: 31 })
    expect(poolA?.lines[0]?.href).toBeNull()
  })

  it('keeps the No pool group on a past date, where its masked figures read "—" not zero (m2)', () => {
    const budget = pastBudget()
    const noPool = budget.pools.find((p) => p.pool === '')
    if (noPool === undefined) throw new Error('no No pool')
    // A gap request in No pool: the read masks its unmet ask and keeps nothing else.
    const masked = {
      ...budget,
      pools: budget.pools.map((p) =>
        p.pool === ''
          ? {
              ...p,
              demand: {
                ...p.demand,
                round2_asks: null,
                round2_asked: null,
                round2_computed: null,
                round1_unmet: null,
              },
            }
          : p
      ),
    }
    expect(demandGroups(masked, null, PAST).map((g) => g.label)).toEqual([
      'Pool A',
      'Pool B',
      'No pool',
      'Total',
    ])
    // A real zero still hides it.
    expect(demandGroups(BUDGET, null, LIVE).map((g) => g.label)).not.toContain('No pool')
  })
})
