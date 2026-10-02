/** The fixtures mirror the server's shape: a test on them must see what the server sends. */
import { describe, expect, it } from 'vitest'

import { toCents } from '../kit/money'
import { BUDGET, pastBudget } from './budgetFixtures'

const ALL = [...BUDGET.pools, BUDGET.total]

describe('BUDGET mirrors the server', () => {
  it("each pool's in-budget type lines add up to its Posted + Needs an offer + Pending approval", () => {
    for (const pool of ALL) {
      const inBudget = (pool.decision_types ?? []).filter((t) => t.counts_toward_budget)
      const sum = inBudget.reduce((acc, t) => acc + toCents(t.amount ?? 0), 0)
      const t = pool.total
      const want =
        toCents(t.posted ?? 0) + toCents(t.needs_offer ?? 0) + toCents(t.pending_approval ?? 0)
      expect(sum, pool.label).toBe(want)
    }
  })

  it("the Total's type lines merge the pools' by key", () => {
    const totalTypes = BUDGET.total.decision_types ?? []
    expect(totalTypes.length).toBeGreaterThan(0)
    for (const line of totalTypes) {
      const across = BUDGET.pools
        .flatMap((p) => p.decision_types ?? [])
        .filter((t) => t.key === line.key && t.counts_toward_budget === line.counts_toward_budget)
        .reduce((acc, t) => acc + toCents(t.amount ?? 0), 0)
      expect(toCents(line.amount ?? 0), String(line.key)).toBe(across)
    }
  })

  it('every live cell and pool carries the counts the server always sends', () => {
    for (const pool of ALL) {
      for (const c of [...pool.rounds, pool.total]) {
        expect(c.needs_offer_count, pool.label).toBeDefined()
        expect(c.pending_approval_count, pool.label).toBeDefined()
      }
      expect(pool.below.outside_grants_requests, pool.label).toBeDefined()
      expect(pool.demand.round1_unmet_requests, pool.label).toBeDefined()
      expect(pool.demand.round1_held, pool.label).toBeDefined()
      expect(pool.demand.round2_held, pool.label).toBeDefined()
    }
  })
})

describe('pastBudget masks type lines as the server does', () => {
  it('empties amount, own and requests on every line, pool and total', () => {
    const past = pastBudget()
    for (const pool of [...past.pools, past.total]) {
      for (const t of pool.decision_types ?? []) {
        expect([t.amount, t.own, t.requests]).toEqual([null, null, null])
      }
    }
    expect((past.total.decision_types ?? []).length).toBeGreaterThan(0)
  })
})
