import { describe, expect, it } from 'vitest'

import { results } from './scenarioFixtures'
import {
  belowParts,
  belowRows,
  byTierRows,
  ghostPct,
  moneyChange,
  poolCard,
  projectionWords,
  roughly,
  stripLead,
  stripPools,
} from './spendModel'

// results(r1): Pool A spends r1 − 50,000 in Round 1 + 20,500 + 950; Pool B 50,000; Remaining 1,000,000 − r1 − 21,450.
const DRAFT = results(735000, { allocated: 1000000 })
const FROM = results(735552, { allocated: 1000000 })
const PROJECTION = {
  share: 0.39,
  through: '2027-02-03',
  basis_year: 2026,
  aligned_on: 'application_deadline' as const,
  requests: 465,
  round1: 799600.4,
  round1_and_2: 850400,
  remaining: 120000,
  pools: [{ pool: 'pool_a', remaining: 305600 }],
}

describe('changes against the starting point (§S5 E; N9: green leaves more money, amber less)', () => {
  it('colours Remaining up and spend down green, the others amber', () => {
    expect(moneyChange(100552, 100000, 'remaining')).toEqual({ text: '+$552', tone: 'more' })
    expect(moneyChange(95752, 100000, 'remaining')).toEqual({ text: '−$4,248', tone: 'less' })
    expect(moneyChange(271006, 270454, 'spend')).toEqual({ text: '+$552', tone: 'less' })
    expect(moneyChange(270454, 271006, 'spend')).toEqual({ text: '−$552', tone: 'more' })
  })

  it('shows a change from $1, and none without a starting point', () => {
    expect(moneyChange(100000.99, 100000, 'spend')).toBeNull()
    expect(moneyChange(100001, 100000, 'spend')).toEqual({ text: '+$1', tone: 'less' })
    expect(moneyChange(100000, null, 'spend')).toBeNull()
  })

  it('rounds a projection to the nearest $1,000', () => {
    expect([roughly(799600.4), roughly(305499), roughly(-12600)]).toEqual([
      '$800,000',
      '$305,000',
      '−$13,000',
    ])
  })
})

describe('the pool cells (§S5 E)', () => {
  it('draws the bar from the pool and marks where the starting point sat', () => {
    const [a] = stripPools(DRAFT, FROM, false)
    expect(a?.card).toEqual(poolCard(DRAFT.pools[0]!))
    // Pool A's committed: 685,000 + 21,450 = 706,450 now, 707,002 at the start; its scale is max(720,000, 706,450).
    expect(a?.ghostPct).toBeCloseTo((100 * 707002) / 720000, 6)
    expect(ghostPct(poolCard(DRAFT.pools[0]!), 706450.5)).toBeNull()
    expect(a?.remainingChange).toEqual({ text: '+$552', tone: 'more' })
  })

  it('shows R1 with its change before the lock; after it R2 with its change and no R1 change (N10)', () => {
    const [before] = stripPools(DRAFT, FROM, false)
    expect(before?.legend.map((l) => [l.round, l.text, l.change?.text ?? null])).toEqual([
      [1, 'R1 $685,000', '−$552'],
      [3, 'R3 $950', null],
    ])
    const [after] = stripPools(DRAFT, FROM, true)
    expect(after?.legend.map((l) => [l.round, l.change?.text ?? null])).toEqual([
      [1, null],
      [2, null],
      [3, null],
    ])
  })

  it('says each pool’s projected Remaining, muted and rounded, and leaves No pool out of the cells', () => {
    const pools = stripPools({ ...DRAFT, projection: PROJECTION }, FROM, false)
    expect(pools.map((p) => [p.card.key, p.projected])).toEqual([
      ['pool_a', 'projected $306,000'],
      ['pool_b', null],
    ])
    const withNoPool = {
      ...DRAFT,
      pools: [...DRAFT.pools, { ...DRAFT.pools[1]!, pool: '', label: 'No pool' }],
    }
    expect(stripPools(withNoPool, null, false).map((p) => p.card.key)).toEqual(['pool_a', 'pool_b'])
  })

  it('marks a pool over its share, never the total', () => {
    const over = { ...DRAFT, pools: [{ ...DRAFT.pools[0]!, remaining: -1017 }, DRAFT.pools[1]!] }
    expect(stripPools(over, null, false)[0]?.card.overShare).toBe(true)
  })
})

describe('the lead column (§S5 E; N1: Remaining leads)', () => {
  it('leads with the total Remaining and its change, of the budget and the applications priced', () => {
    expect(stripLead(DRAFT, FROM, false)).toEqual({
      remaining: 1000000 - 735000 - 21450,
      overBudget: false,
      change: { text: '+$552', tone: 'more' },
      ofWords: 'of $1,000,000 · 420 applications',
    })
  })

  it('says posted Round 1 stands after the lock when Round 1 settings differ, and red below $0', () => {
    expect(stripLead(DRAFT, null, true).ofWords).toBe('of $1,000,000 · posted Round 1 stands')
    expect(stripLead({ ...DRAFT, remaining: -50 }, null, false).overBudget).toBe(true)
  })
})

describe('the projection line (§S5 E; N8: never amber or red)', () => {
  it('reads as last year’s share before the lock and dims after it', () => {
    expect(projectionWords(PROJECTION, false)).toEqual({
      text: 'Projected: by this point last year 39% had arrived → about 465 expected · if the rest arrive like last year: Round 1 ≈ $800,000',
      dimmed: false,
    })
    expect(projectionWords({ ...PROJECTION, share: 0.98 }, true)).toEqual({
      text: "≈98% of last year's applications had arrived by this point → about 465 expected · R1 + R2 ≈ $850,000",
      dimmed: true,
    })
  })

  it('is absent with no projection', () => {
    expect(projectionWords(null, false)).toBeNull()
    expect(projectionWords(undefined, true)).toBeNull()
    expect(projectionWords(null, false, null)).toBeNull()
  })

  it('says it is too early to project below a 5% share', () => {
    expect(
      projectionWords(null, false, { share: 0.03, through: '2027-01-05', basis_year: 2026 })
    ).toEqual({
      text: "Too early to project: about 3% of last year's applications had arrived by this point",
      dimmed: false,
    })
  })

  it('rounds the too-early share to a whole percent', () => {
    expect(
      projectionWords(null, false, { share: 0.034, through: '2027-01-05', basis_year: 2026 })?.text
    ).toBe("Too early to project: about 3% of last year's applications had arrived by this point")
  })

  it('shows a projection, never the too-early line, when there is one', () => {
    expect(
      projectionWords(PROJECTION, false, { share: 0.03, through: '2027-01-05', basis_year: 2026 })
        ?.text
    ).toMatch(/^Projected:/)
  })
})

describe('below the line and by tier (§S5 E)', () => {
  it('lists at the minimum, held, the appeals after the lock, and the unmet ask', () => {
    expect(belowParts(DRAFT, false)).toEqual([
      { lead: '', figure: '12', tail: ' at minimum' },
      { lead: '', figure: '9', tail: ' held' },
      { lead: 'unmet ask ', figure: '$50,920', tail: '' },
    ])
    const after = belowParts({ ...DRAFT, appeals: 2, appeals_asked: 1300 }, true)
    expect(after[2]).toEqual({ lead: '', figure: '2', tail: ' appeals keyed' })
  })

  it('tables each figure against the starting point', () => {
    const rows = belowRows({ ...DRAFT, at_minimum: 14 }, FROM, false)
    expect(rows).toEqual([
      { label: 'At the minimum', draft: '14', from: '12', change: '+2' },
      { label: 'Held: no amount yet', draft: '9', from: '9', change: '' },
      { label: 'Round 1 unmet ask', draft: '$50,920', from: '$50,920', change: '' },
    ])
    expect(
      belowRows({ ...DRAFT, appeals: 2, appeals_asked: 1300 }, FROM, true).map((r) => r.label)
    ).toEqual([
      'At the minimum',
      'Held: no amount yet',
      'Appeals keyed so far',
      '…asking',
      'Round 1 unmet ask, not yet appealed',
    ])
  })

  it('splits by tier with Round 2 after the lock and the change in the sign colours', () => {
    const rows = byTierRows(DRAFT, FROM, false)
    expect(rows[0]).toEqual({
      tier: 1,
      requests: 195,
      round1: '$535,000',
      round2: null,
      change: { text: '−$552', tone: 'more' },
    })
    expect(byTierRows(DRAFT, FROM, true)[1]?.round2).toBe('$0')
  })
})

describe('whole dollars everywhere the strip shows money (coordinator ruling 2026-10-07)', () => {
  it('rounds a fractional change, card value and was-figure to the whole dollar', () => {
    expect(moneyChange(100001.5, 100000, 'spend')).toEqual({ text: '+$2', tone: 'less' })
    expect(moneyChange(99998.4, 100000, 'remaining')).toEqual({ text: '\u2212$2', tone: 'less' })
    const fractional = {
      ...DRAFT,
      allocated: 1000000.5,
      round1_unmet: 50920.5,
      by_tier: [{ ...DRAFT.by_tier[0]!, round1: 535000.5 }, ...DRAFT.by_tier.slice(1)],
    }
    expect(stripLead(fractional, null, false).ofWords).toBe('of $1,000,001 \u00b7 420 applications')
    expect(belowParts(fractional, false)[2]).toEqual({
      lead: 'unmet ask ',
      figure: '$50,921',
      tail: '',
    })
    expect(belowRows(fractional, null, false)[2]).toMatchObject({ draft: '$50,921' })
    expect(byTierRows(fractional, null, false)[0]?.round1).toBe('$535,001')
    const pool = { ...DRAFT.pools[0]!, round1: 685000.4 }
    expect(
      stripPools({ ...DRAFT, pools: [pool, DRAFT.pools[1]!] }, null, false)[0]?.legend[0]?.text
    ).toBe('R1 $685,000')
  })
})
