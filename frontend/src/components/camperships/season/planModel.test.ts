import { describe, expect, it } from 'vitest'

import { BUDGET } from './budgetFixtures'
import {
  allocationCents,
  draftPillWords,
  moved,
  planContent,
  planIssues,
  planOf,
  previewFigures,
  splitWords,
} from './planModel'

const RULES_BUDGET = {
  total: '1000000',
  pools: {
    pool_a: { label: 'Pool A', share_pct: '90' },
    pool_b: { label: 'Pool B', share_pct: '10' },
  },
}
const { plan: OPENED, pools: POOLS } = planOf(RULES_BUDGET)
const KEYS = POOLS.map((p) => p.key)

describe('Edit Plan… words (spec §5.2 B)', () => {
  it('says "No change yet" until something changes', () => {
    expect(planIssues(OPENED, OPENED, KEYS)).toEqual(['No change yet'])
  })

  it('asks for a total above $0', () => {
    for (const total of ['0', '', 'abc', '-5']) {
      expect(planIssues({ ...OPENED, total }, OPENED, KEYS)).toContain('Type a total above $0')
    }
  })

  it('asks for every share: blank, not a number, or negative', () => {
    for (const share of ['', 'x', '-1']) {
      expect(
        planIssues({ ...OPENED, shares: { ...OPENED.shares, pool_b: share } }, OPENED, KEYS)
      ).toContain('Every program needs a share')
    }
  })

  it('planIssues: thirds that sum exactly pass; 33.3 × 3 says 99.9% (Review Focus 3)', () => {
    const three = {
      ...RULES_BUDGET,
      pools: { ...RULES_BUDGET.pools, pool_c: { label: 'Pool C', share_pct: '0' } },
    }
    const { plan, pools } = planOf(three)
    const keys = pools.map((p) => p.key)
    const exact = { ...plan, shares: { pool_a: '33.34', pool_b: '33.33', pool_c: '33.33' } }
    expect(planIssues(exact, plan, keys)).toEqual([])
    const short = { ...plan, shares: { pool_a: '33.3', pool_b: '33.3', pool_c: '33.3' } }
    expect(planIssues(short, plan, keys)).toEqual(['Shares sum to 99.9%, not 100%'])
  })

  it('reads the split in dollars, cents half up, as the server rounds', () => {
    expect(splitWords(OPENED, POOLS)).toBe('sums to 100% · Pool A $900,000 · Pool B $100,000')
    expect(splitWords({ ...OPENED, shares: { pool_a: '50', pool_b: '40' } }, POOLS)).toBeNull()
    expect(allocationCents(10001, 500000)).toBe(5001) // $100.01 × 50% = $50.005 → $50.01
  })

  it('matches budget.py on the two golden cases, to the cent (test_decision_budget.py pins the same two)', () => {
    // 4.2% of $1,111,000 is exactly $46,662.00 (111,100,000 cents × 42,000 units ÷ 1,000,000).
    expect(allocationCents(111_100_000, 42_000)).toBe(4_666_200)
    const golden = { total: '1111000', shares: { pool_a: '4.2', pool_b: '95.8' } }
    expect(splitWords(golden, POOLS)).toBe('sums to 100% · Pool A $46,662 · Pool B $1,064,338')
    // 50% of $100.01 is $50.005: half up to $50.01 in each pool, never banker's $50.00.
    const half = { total: '100.01', shares: { pool_a: '50', pool_b: '50' } }
    expect(splitWords(half, POOLS)).toBe('sums to 100% · Pool A $50.01 · Pool B $50.01')
  })
})

describe('the preview (spec §5.2 B: the one exception to "the server did every sum")', () => {
  it('reproduces the server figures to the cent at the approved plan', () => {
    const preview = previewFigures(OPENED, BUDGET, KEYS)
    for (const pool of BUDGET.pools.filter((p) => KEYS.includes(p.pool))) {
      expect(preview?.pools[pool.pool]).toEqual({
        allocated: pool.total.allocated,
        remaining: pool.total.remaining,
      })
    }
    expect(preview?.total).toEqual({
      allocated: BUDGET.total.total.allocated,
      remaining: BUDGET.total.total.remaining,
    })
  })

  it('moves Allocated and Remaining, never Committed', () => {
    const preview = previewFigures(
      { ...OPENED, shares: { pool_a: '89', pool_b: '11' } },
      BUDGET,
      KEYS
    )
    expect(preview?.pools['pool_b']?.allocated).toBe(110000)
    expect(moved(BUDGET.pools[1]?.total.allocated, preview?.pools['pool_b']?.allocated)).toBe(true)
    expect(moved(BUDGET.pools[1]?.total.committed, BUDGET.pools[1]?.total.committed)).toBe(false)
  })

  it('has no preview while the plan has an issue', () => {
    expect(previewFigures({ ...OPENED, total: '' }, BUDGET, KEYS)).toBeNull()
  })
})

describe('saving (spec §5.2 B)', () => {
  it('writes {total, pools: {key: {label, share_pct}}} with the labels as stored', () => {
    expect(
      planContent({ total: '1010000', shares: { pool_a: '89', pool_b: '11' } }, POOLS)
    ).toEqual({
      total: '1010000',
      pools: {
        pool_a: { label: 'Pool A', share_pct: '89' },
        pool_b: { label: 'Pool B', share_pct: '11' },
      },
    })
  })

  it('names the draft on the Budget line', () => {
    expect(draftPillWords(5, 1)).toBe('rules draft v5: 1 budget change')
    expect(draftPillWords(5, 3)).toBe('rules draft v5: 3 budget changes')
  })
})
