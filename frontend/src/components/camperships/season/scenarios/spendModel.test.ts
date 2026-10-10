import { describe, expect, it } from 'vitest'

import { results } from './scenarioFixtures'
import {
  belowParts,
  belowRows,
  byTierRows,
  ghostPct,
  moneyChange,
  poolCard,
  roughly,
  kilo,
  projectedTitle,
  spendHeading,
  spendTable,
  tooEarlyWords,
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

describe('the Spend table (final mock: Pool · Round 1 · 2 · 3 · Spend · Remaining · vs · Projected · Used)', () => {
  it('has one row per pool and a total, each with its rounds, spend and Remaining', () => {
    const { pools, total } = spendTable(DRAFT, FROM)
    expect(pools.map((p) => [p.key, p.label, p.round1, p.round2, p.round3, p.spend])).toEqual([
      ['pool_a', 'Pool A', 685000, 20500, 950, 706450],
      ['pool_b', 'Pool B', 50000, 0, 0, 50000],
    ])
    expect(pools[0]?.remaining).toBe(DRAFT.pools[0]?.remaining)
    expect([total.label, total.round1, total.round2, total.round3, total.spend]).toEqual([
      'Total',
      735000,
      20500,
      950,
      756450,
    ])
    expect(total.remaining).toBe(1000000 - 735000 - 21450)
  })

  it('draws each pool bar from the pool and marks where the starting point sat; the total has no bar', () => {
    const { pools, total } = spendTable(DRAFT, FROM)
    expect(pools[0]?.card).toEqual(poolCard(DRAFT.pools[0]!))
    // Pool A's committed: 685,000 + 21,450 = 706,450 now, 707,002 at the start; its scale is max(720,000, 706,450).
    expect(pools[0]?.ghostPct).toBeCloseTo((100 * 707002) / 720000, 6)
    expect(ghostPct(poolCard(DRAFT.pools[0]!), 706450.5)).toBeNull()
    expect(pools[1]?.ghostPct).toBeNull()
    expect(total.card).toBeNull()
  })

  it('says each Remaining against the starting point, green for more and amber for less', () => {
    const { pools, total } = spendTable(DRAFT, FROM)
    expect(pools[0]?.vs).toEqual({ text: '+$552', tone: 'more' })
    expect(pools[1]?.vs).toBeNull()
    expect(total.vs).toEqual({ text: '+$552', tone: 'more' })
    expect(spendTable(DRAFT, null).total.vs).toBeNull()
  })

  it('marks a pool over its share, and the total over budget, separately', () => {
    const over = {
      ...DRAFT,
      remaining: -50,
      pools: [{ ...DRAFT.pools[0]!, remaining: -1017 }, DRAFT.pools[1]!],
    }
    const { pools, total } = spendTable(over, null)
    expect([pools[0]?.over, pools[1]?.over, total.over]).toEqual([true, false, true])
    expect(spendTable(DRAFT, null).total.over).toBe(false)
  })

  it('leaves No pool out of the rows (its money stays in the total)', () => {
    const withNoPool = {
      ...DRAFT,
      pools: [...DRAFT.pools, { ...DRAFT.pools[1]!, pool: '', label: 'No pool' }],
    }
    expect(spendTable(withNoPool, null).pools.map((p) => p.key)).toEqual(['pool_a', 'pool_b'])
  })

  it('says each pool’s projected Remaining and the total’s, and none without a projection', () => {
    const { pools, total } = spendTable({ ...DRAFT, projection: PROJECTION }, FROM)
    expect(pools.map((p) => p.projected)).toEqual([305600, null])
    expect(total.projected).toBe(120000)
    expect(spendTable(DRAFT, FROM).total.projected).toBeNull()
  })

  it('rounds a projection to $k for the table, with the minus sign', () => {
    expect([kilo(305600), kilo(-12600), kilo(499), kilo(1111000)]).toEqual([
      '$306k',
      '\u2212$13k',
      '$0k',
      '$1,111k',
    ])
  })

  it('heads the table with Remaining of the budget and what was priced', () => {
    expect(spendHeading(DRAFT, false, '420 applications held')).toBe(
      'Remaining $243,550 of $1,000,000 \u00b7 420 applications held'
    )
    expect(spendHeading(DRAFT, true, '420 applications held')).toBe(
      'Remaining $243,550 of $1,000,000 \u00b7 posted Round 1 stands'
    )
  })

  it('explains the projected figure in its title, from last year’s share', () => {
    expect(projectedTitle({ ...DRAFT, projection: PROJECTION })).toBe(
      "Projected Remaining: if the rest of the season's applications arrive like last year's (about 39% are in by this week)"
    )
    expect(
      projectedTitle({
        ...DRAFT,
        too_early: { share: 0.03, through: '2027-01-05', basis_year: 2026 },
      })
    ).toMatch(/^Too early to project/)
    expect(projectedTitle(DRAFT)).toBe('No projection yet')
  })
})

describe('the too-early words (§S5 E; N8)', () => {
  const early = (share: number) => tooEarlyWords({ share, through: '2027-01-05', basis_year: 2026 })

  it('is absent when the server sent no too-early share', () => {
    expect(tooEarlyWords(null)).toBeNull()
    expect(tooEarlyWords(undefined)).toBeNull()
  })

  it('says it is too early to project below a 5% share', () => {
    expect(early(0.03)).toBe(
      "Too early to project: about 3% of last year's applications had arrived by this point"
    )
  })

  it('rounds the too-early share to a whole percent', () => {
    expect(early(0.034)).toBe(
      "Too early to project: about 3% of last year's applications had arrived by this point"
    )
  })

  it('never reads 5% on a too-early line: the share rounds down', () => {
    expect(early(0.0499)).toBe(
      "Too early to project: about 4% of last year's applications had arrived by this point"
    )
  })

  it('says under 1% rather than about 0%', () => {
    expect(early(0.004)).toBe(
      "Too early to project: under 1% of last year's applications had arrived by this point"
    )
  })

  it('leaves the title to the projection when there is one', () => {
    expect(
      projectedTitle({
        ...DRAFT,
        projection: PROJECTION,
        too_early: { share: 0.03, through: '2027-01-05', basis_year: 2026 },
      })
    ).toMatch(/^Projected Remaining:/)
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
    expect(spendHeading(fractional, false, '420 applications held')).toBe(
      'Remaining $243,550 of $1,000,001 \u00b7 420 applications held'
    )
    expect(belowParts(fractional, false)[2]).toEqual({
      lead: 'unmet ask ',
      figure: '$50,921',
      tail: '',
    })
    expect(belowRows(fractional, null, false)[2]).toMatchObject({ draft: '$50,921' })
    expect(byTierRows(fractional, null, false)[0]?.round1).toBe('$535,001')
  })
})
