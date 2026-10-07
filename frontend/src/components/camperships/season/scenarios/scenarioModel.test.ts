import { describe, expect, it } from 'vitest'

import { RULES_DOCUMENT } from '../rules/rulesFixtures'
import { results } from './scenarioFixtures'
import { fitWords } from './scenarioModel'

describe('Fit to budget in words (fit.py; D119)', () => {
  const fit = (outcome: 'fits' | 'over_at_lowest' | 'under_at_highest', shift: number) => ({
    tier_shift: shift,
    outcome,
    tightest_pool: 'pool_a',
    tried: 11,
    document: RULES_DOCUMENT,
    results: results(800000),
    report: { issues: [] },
  })

  it("says the shift that uses Round 1's allocation, and the tightest pool as information", () => {
    expect(fitWords(fit('fits', -4.5))).toEqual({
      headline: 'Shifting every tier −4.5 pts uses the budget: Round 1 $800,000, $0 left.',
      pool: 'Tightest pool: Pool A, Round 1 remaining −$30,000. Pools are guidance; only the total budget is hard.',
    })
  })

  it("says so when even the range's ends don't fit", () => {
    expect(fitWords(fit('over_at_lowest', -100)).headline).toBe(
      'Even the lowest shift (−100 pts) leaves Round 1 over the budget.'
    )
    expect(fitWords(fit('under_at_highest', 100)).headline).toBe(
      'Even the highest shift (+100 pts) leaves part of the budget unused.'
    )
  })

  it('words every figure in whole dollars, rounding a fractional one (coordinator ruling 2026-10-07)', () => {
    const base = fit('fits', 1)
    const answer = {
      ...base,
      results: {
        ...base.results,
        round1: 800000.5,
        round1_remaining: 41495.66,
        pools: base.results.pools.map((p) => ({ ...p, round1_remaining: -30000.4 })),
      },
    }
    expect(fitWords(answer)).toEqual({
      headline: 'Shifting every tier +1 pts uses the budget: Round 1 $800,001, $41,496 left.',
      pool: 'Tightest pool: Pool A, Round 1 remaining −$30,000. Pools are guidance; only the total budget is hard.',
    })
  })

  it('names no pool whose Round 1 has no allocation (null remaining)', () => {
    const base = fit('fits', 0)
    const pools = base.results.pools.map((p) => ({ ...p, round1_remaining: null }))
    expect(fitWords({ ...base, results: { ...base.results, pools } }).pool).toBeNull()
  })

  it('names no pool when none is tightest, and never calls the figure the pools summed', () => {
    const none = fitWords({ ...fit('fits', 0), tightest_pool: null })
    expect(none.pool).toBeNull()
    expect(none.headline).not.toMatch(/pools/i)
  })
})
